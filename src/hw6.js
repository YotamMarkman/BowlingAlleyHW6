// ============================================================================
//  HW06 — Interactive 3D Bowling Game
//  Three.js r160 (>= r150) via import map, WebGL renderer, OrbitControls.
//
//  Built directly on the HW05 static alley. The full HW05 infrastructure
//  (lane + markings, gutters, ten pins, ball, lighting/shadows, camera + orbit
//  controls, camera presets, UI scaffolding) is preserved, and the HW06
//  interactive layer is added on top:
//    1. Aiming & controls  — move/aim the ball, oscillating power meter, release
//    2. Simplified physics — hand-written velocity/delta-time rolling + gutters
//    3. Pin collision & toppling — ball↔pin and pin↔pin, topple animation
//    4. Ten-frame scoring  — strikes, spares, open frames, running total
//    5. Game flow & state  — frame advancement, pin/ball reset, new game
//
//  Coordinate system (unchanged from HW05, right-handed):
//    • Foul line at Z = 0; pins at negative Z (head pin ≈ Z = -57)
//    • Lane runs along Z, width along X, up is +Y
//    • Approach area is on the +Z side of the foul line (bowler stands there)
//
//  All physics is hand-written and integrated in animate() — no external
//  physics engine, per the assignment.
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ----------------------------------------------------------------------------
//  Scene constants — single source of truth for all dimensions.
// ----------------------------------------------------------------------------
const LANE_LENGTH    = 60;                 // foul line (Z=0) to pin end (Z=-60)
const LANE_WIDTH     = 3.5;                // ~17:1 length:width ratio
const LANE_HALF_W    = LANE_WIDTH / 2;     // 1.75
const LANE_THICKNESS = 0.3;                // slab depth in Y
const SURFACE_Y      = 0;                  // world Y of the playing surface (lane top)

const APPROACH_LENGTH = 15;                // run-up area on +Z side of foul line

const GUTTER_WIDTH = 0.6;                  // channel width on each side
const GUTTER_DROP  = 0.12;                 // how far gutter top sits below lane top

const PIN_HEIGHT = 1.25;                   // classic regulation-scaled pin height
const BALL_RADIUS = 0.45;                  // ~8.5" diameter scaled to lane

// Standard 1-2-3-4 triangular formation. Y = 0 base (sits on lane top).
const PIN_POSITIONS = [
  { id: 1,  x:  0.0, z: -57.000 },         // head pin (closest to bowler)
  { id: 2,  x: -0.5, z: -57.866 },
  { id: 3,  x:  0.5, z: -57.866 },
  { id: 4,  x: -1.0, z: -58.732 },
  { id: 5,  x:  0.0, z: -58.732 },
  { id: 6,  x:  1.0, z: -58.732 },
  { id: 7,  x: -1.5, z: -59.598 },
  { id: 8,  x: -0.5, z: -59.598 },
  { id: 9,  x:  0.5, z: -59.598 },
  { id: 10, x:  1.5, z: -59.598 },
];

// --- Gameplay tuning constants ----------------------------------------------
const BALL_START = new THREE.Vector3(0, SURFACE_Y + BALL_RADIUS, 0.6); // aim origin
const AIM_X_LIMIT = 1.5;                    // how far the ball can be aimed sideways
const SPIN_LIMIT  = 1.0;                    // max |spin| (hook strength input)
const SPIN_STEP   = 0.1;                    // spin change per Up/Down keypress
const AIM_STEP    = 0.06;                   // sideways aim change per Left/Right press

const POWER_SPEED = 1.35;                   // power-meter oscillation rate (per second)
const MIN_SPEED   = 30;                     // launch speed at 0% power (units/s) — clears the lane
const MAX_SPEED   = 56;                     // launch speed at 100% power (units/s)
const ROLL_DAMP   = 0.42;                   // exponential rolling-friction coefficient
const HOOK_ACCEL  = 2.4;                    // lateral accel per unit spin (curve/hook)
const STOP_SPEED  = 1.0;                    // below this the ball is "at rest"
const MAX_ROLL_T  = 12;                     // safety: force-resolve a roll after this

const PIN_RADIUS    = 0.18;                 // pin collision radius (belly)
// Pin→pin knock-on uses an energy-decay model so a cascade can't flood the whole
// (densely 1.0-spaced) rack from a single clip. A toppling pin only pushes an
// immediate neighbour that is within a tight forward cone of its fall, and the
// transferred energy halves-ish each hop; below PROP_MIN_ENERGY a pin still
// falls but can no longer knock anyone on. Tuned (via a headless roll sim) so a
// flush pocket hit strikes while a corner clip topples only a couple of pins.
const PROP_RADIUS     = 1.02;               // reach (just over the 1.0 pin spacing)
const PROP_DOT        = 0.6;                // neighbour must be within ~53° of the fall dir
const PROP_FALLOFF    = 0.55;               // energy retained per propagation hop
const PROP_MIN_ENERGY = 0.25;              // below this a falling pin stops propagating
const FALL_TARGET   = Math.PI / 2 * 1.05;   // topple a touch past flat
const RESOLVE_DELAY = 1.3;                  // pause (s) after a roll before scoring/reset
const MSG_TIME      = 1.7;                  // how long transient messages stay up (s)

// ----------------------------------------------------------------------------
//  Helper (kept for parity with starter code / rotation math).
// ----------------------------------------------------------------------------
function degrees_to_radians(degrees) {
  return degrees * (Math.PI / 180);
}

// ============================================================================
//  Renderer
// ============================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;                 // shadow maps ON
renderer.shadowMap.type = THREE.PCFSoftShadowMap;  // soft shadow edges
document.body.appendChild(renderer.domElement);

// ============================================================================
//  Scene
// ============================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);      // dark alley ambiance
scene.fog = new THREE.Fog(0x0e1116, 50, 130);      // subtle depth falloff down lane

// ============================================================================
//  Camera
// ============================================================================
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);
// Initial: bowler's perspective, standing on the approach looking down the lane.
camera.position.set(0, 5, 12);

// ============================================================================
//  Lighting (with shadow-casting key light)
// ============================================================================
function setupLights() {
  // Soft sky/ground fill so shadowed sides are not pure black.
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x202024, 0.55);
  scene.add(hemi);

  // Low ambient lift.
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambient);

  // Key directional light — casts the scene's shadows.
  const key = new THREE.DirectionalLight(0xfff2e0, 1.05);
  key.position.set(10, 28, 14);
  key.castShadow = true;

  // Aim the light down the middle of the lane.
  key.target.position.set(0, 0, -28);
  scene.add(key.target);

  // Shadow frustum must be generous: the lane is ~80 units along Z.
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 200;
  key.shadow.camera.left = -45;
  key.shadow.camera.right = 45;
  key.shadow.camera.top = 45;
  key.shadow.camera.bottom = -45;
  key.shadow.bias = -0.0004;                 // reduce shadow acne
  scene.add(key);

  // A warm overhead fill above the pin deck for that "alley glow".
  // decay=0: r160 uses physical lighting by default, so any decay>0 would make
  // this ~18-units-distant spot effectively invisible. No falloff keeps it visible.
  const pinSpot = new THREE.SpotLight(0xfff0d8, 0.7, 80, degrees_to_radians(50), 0.4, 0.0);
  pinSpot.position.set(0, 18, -58);
  pinSpot.target.position.set(0, 0, -58);
  scene.add(pinSpot.target);
  scene.add(pinSpot);
}

// ============================================================================
//  Lane surface (glossy light-maple)
// ============================================================================
function createLane() {
  const geo = new THREE.BoxGeometry(LANE_WIDTH, LANE_THICKNESS, LANE_LENGTH);
  const mat = new THREE.MeshPhongMaterial({
    color: 0xd9a564,        // light maple
    shininess: 90,          // glossy lane finish
    specular: 0x553311,
  });
  const lane = new THREE.Mesh(geo, mat);
  // Centered between Z=0 and Z=-60; top of slab flush with SURFACE_Y.
  lane.position.set(0, SURFACE_Y - LANE_THICKNESS / 2, -LANE_LENGTH / 2);
  lane.receiveShadow = true;
  scene.add(lane);
}

// ============================================================================
//  Approach area (+Z side, subtly different/darker shade than the lane)
// ============================================================================
function createApproach() {
  const geo = new THREE.BoxGeometry(LANE_WIDTH, LANE_THICKNESS, APPROACH_LENGTH);
  const mat = new THREE.MeshPhongMaterial({
    color: 0xb6884a,        // slightly darker maple
    shininess: 55,
    specular: 0x442a11,
  });
  const approach = new THREE.Mesh(geo, mat);
  approach.position.set(0, SURFACE_Y - LANE_THICKNESS / 2, APPROACH_LENGTH / 2);
  approach.receiveShadow = true;
  scene.add(approach);
}

// ============================================================================
//  Gutters (both sides, full lane length, recessed below lane top)
// ============================================================================
function createGutters() {
  const geo = new THREE.BoxGeometry(GUTTER_WIDTH, LANE_THICKNESS, LANE_LENGTH);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x33373d,        // dark recessed channel
    shininess: 25,
  });
  const offsetX = LANE_HALF_W + GUTTER_WIDTH / 2;
  const topY = SURFACE_Y - GUTTER_DROP;     // gutter top sits below lane top

  for (const side of [-1, 1]) {
    const gutter = new THREE.Mesh(geo, mat);
    gutter.position.set(side * offsetX, topY - LANE_THICKNESS / 2, -LANE_LENGTH / 2);
    gutter.receiveShadow = true;
    scene.add(gutter);
  }
}

// ============================================================================
//  Pin deck (distinct darker surface behind the pins)
// ============================================================================
function createPinDeck() {
  // Thin overlay slab covering the pin area, sitting a hair above the lane top
  // so it reads as a visually distinct surface.
  const deckDepth = 7;
  const geo = new THREE.BoxGeometry(LANE_WIDTH, 0.06, deckDepth);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x6e6157,        // muted, distinct from maple lane
    shininess: 40,
  });
  const deck = new THREE.Mesh(geo, mat);
  // Top face sits a hair above the lane (Y≈+0.003) so it reads as a distinct
  // surface while staying flush with the pin bases at Y=0 (no sunk-in pins).
  deck.position.set(0, SURFACE_Y - 0.027, -58.4);   // spans roughly Z=-55 to -62
  deck.receiveShadow = true;
  scene.add(deck);
}

// ============================================================================
//  Lane markings — all use unlit MeshBasicMaterial and float just above the
//  surface (Y small epsilon) to avoid z-fighting with the lane.
// ============================================================================
const MARK_Y = SURFACE_Y + 0.012;

// Foul line: thin bright band across the full lane width at Z = 0.
function createFoulLine() {
  const geo = new THREE.PlaneGeometry(LANE_WIDTH, 0.18);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3b30, side: THREE.DoubleSide });
  const line = new THREE.Mesh(geo, mat);
  line.rotation.x = -Math.PI / 2;           // lay flat
  line.position.set(0, MARK_Y, 0);
  scene.add(line);

  // A thin white edge just behind it for the classic white/red look.
  const whiteGeo = new THREE.PlaneGeometry(LANE_WIDTH, 0.06);
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const white = new THREE.Mesh(whiteGeo, whiteMat);
  white.rotation.x = -Math.PI / 2;
  white.position.set(0, MARK_Y, 0.13);
  scene.add(white);
}

// Approach dots: two rows of small guide dots on the approach (+Z) area.
function createApproachDots() {
  const dotGeo = new THREE.CircleGeometry(0.05, 16);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  // Standard arrangement: 7 dots per row, evenly spread across the lane width.
  const xs = [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5];
  const rowZ = [3, 6];                       // two rows on the approach

  for (const z of rowZ) {
    for (const x of xs) {
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(x, MARK_Y, z);
      scene.add(dot);
    }
  }
}

// Targeting arrows: 7 arrows embedded in the lane ~15 units from the foul line,
// fanning out in the classic chevron (center arrow deepest down the lane).
function createTargetingArrows() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x3a2a16 });

  // Build a small triangle pointing toward -Z (down the lane).
  function makeArrow() {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.30);                  // tip (toward pins, -Z after rotation)
    shape.lineTo(0.12, 0.18);
    shape.lineTo(-0.12, 0.18);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    const arrow = new THREE.Mesh(geo, mat);
    arrow.rotation.x = -Math.PI / 2;         // lay flat on the lane
    return arrow;
  }

  // Lateral offset, and how far down-lane each arrow sits (center is deepest).
  const arrows = [
    { x:  0.0, z: -15.0 },
    { x: -0.5, z: -14.4 },
    { x:  0.5, z: -14.4 },
    { x: -1.0, z: -13.8 },
    { x:  1.0, z: -13.8 },
    { x: -1.5, z: -13.2 },
    { x:  1.5, z: -13.2 },
  ];

  for (const a of arrows) {
    const arrow = makeArrow();
    arrow.position.set(a.x, MARK_Y, a.z);
    scene.add(arrow);
  }
}

// ============================================================================
//  Bowling pin — classic silhouette via LatheGeometry (wide body, narrow
//  neck, rounded top) plus red neck stripes. Returns a positioned Group.
// ============================================================================
// Pin profile: Vector2(radius, height) from base (y=0) to crown (y=PIN_HEIGHT).
const PIN_PROFILE = [
  [0.000, 0.000],
  [0.090, 0.000],   // base/foot edge
  [0.100, 0.040],
  [0.120, 0.110],
  [0.155, 0.250],
  [0.180, 0.380],   // widest belly
  [0.172, 0.480],
  [0.140, 0.580],
  [0.100, 0.680],
  [0.082, 0.760],   // narrowest neck
  [0.092, 0.840],
  [0.108, 0.930],   // head bulge
  [0.104, 1.010],
  [0.082, 1.110],
  [0.045, 1.200],
  [0.000, 1.250],   // rounded crown
].map(([r, y]) => new THREE.Vector2(r, y));

const pinBodyMat = new THREE.MeshPhongMaterial({
  color: 0xfafafa,
  shininess: 70,
  specular: 0x999999,
});
const pinStripeMat = new THREE.MeshPhongMaterial({
  color: 0xd11e1e,
  shininess: 70,
  specular: 0x661010,
});

// Build one pin Group whose origin sits at the base centre (so toppling pivots
// about the foot). Position is applied by the caller.
function buildPinMesh() {
  const pin = new THREE.Group();

  // Body via lathe (revolve the profile around the Y axis).
  const bodyGeo = new THREE.LatheGeometry(PIN_PROFILE, 32);
  const body = new THREE.Mesh(bodyGeo, pinBodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  pin.add(body);

  // Two classic red stripes around the neck.
  const stripeData = [
    { y: 0.86, r: 0.100 },
    { y: 0.98, r: 0.112 },
  ];
  for (const s of stripeData) {
    const stripeGeo = new THREE.CylinderGeometry(s.r, s.r, 0.05, 32, 1, true);
    const stripe = new THREE.Mesh(stripeGeo, pinStripeMat);
    stripe.position.y = s.y;
    stripe.castShadow = true;
    pin.add(stripe);
  }
  return pin;
}

// Pin runtime records — populated by createAllPins(), consumed by the game.
const pins = [];

function createAllPins() {
  for (const p of PIN_POSITIONS) {
    const group = buildPinMesh();
    group.position.set(p.x, SURFACE_Y, p.z);     // base sits on the lane top
    scene.add(group);
    pins.push({
      id: p.id,
      group,
      x: p.x,                 // home position (pins don't translate while standing)
      z: p.z,
      standing: true,
      falling: false,
      angle: 0,               // current topple angle
      speed: 0,               // topple angular speed
      delay: 0,               // stagger before this pin starts to fall
      axis: new THREE.Vector3(1, 0, 0),
    });
  }
}

function countStanding() {
  let n = 0;
  for (const p of pins) if (p.standing) n++;
  return n;
}

// Topple a pin in horizontal direction `dir` (THREE.Vector3 in the XZ plane)
// carrying `energy`, then propagate the knock-on to immediate neighbours that
// are within a tight forward cone of the fall. Energy decays each hop, so the
// cascade is naturally bounded. The `standing` flag is cleared before recursing,
// so the recursion always terminates.
function topplePin(pin, dir, delay, energy) {
  if (!pin.standing) return;
  pin.standing = false;
  pin.falling = true;
  pin.delay = delay;
  pin.speed = 7 + Math.random() * 3;             // rad/s — slight natural variance

  const d = dir.clone();
  d.y = 0;
  if (d.lengthSq() < 1e-6) d.set(0, 0, -1);      // degenerate → fall down-lane
  d.normalize();
  // Axis = up × d : rotating +Y about this axis tips the crown toward d.
  pin.axis.set(d.z, 0, -d.x).normalize();

  if (energy < PROP_MIN_ENERGY) return;          // too weak to knock anyone on

  for (const other of pins) {
    if (!other.standing) continue;
    const dx = other.x - pin.x;
    const dz = other.z - pin.z;
    const dist = Math.hypot(dx, dz);
    if (dist > PROP_RADIUS) continue;
    const toN = new THREE.Vector3(dx, 0, dz).normalize();
    if (d.dot(toN) >= PROP_DOT) {
      topplePin(other, toN, delay + 0.04 + Math.random() * 0.05, energy * PROP_FALLOFF);
    }
  }
}

// Advance topple animations. Pins that finish lie flat and stay down.
function updatePins(dt) {
  for (const p of pins) {
    if (!p.falling) continue;
    if (p.delay > 0) { p.delay -= dt; continue; }
    p.angle = Math.min(FALL_TARGET, p.angle + p.speed * dt);
    p.group.quaternion.setFromAxisAngle(p.axis, p.angle);
    if (p.angle >= FALL_TARGET) p.falling = false;   // rest on the lane
  }
}

// Restore the full rack to standing.
function resetRack() {
  for (const p of pins) {
    p.standing = true;
    p.falling = false;
    p.angle = 0;
    p.delay = 0;
    p.group.quaternion.identity();
    p.group.position.set(p.x, SURFACE_Y, p.z);
    p.group.visible = true;
  }
}

// ============================================================================
//  Bowling ball factory — glossy sphere with three finger holes (two adjacent
//  + one offset thumb), rendered as dark cylinders bored slightly into the
//  surface. Returns an UNpositioned Group reused for the play ball and the rack.
// ============================================================================
function makeBowlingBall(radius, color, shininess = 130) {
  const ball = new THREE.Group();

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 48),
    new THREE.MeshPhongMaterial({ color, shininess, specular: 0xffffff })
  );
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  ball.add(sphere);

  // Finger-hole directions (unit vectors from center toward the upper surface).
  const holeMat = new THREE.MeshPhongMaterial({ color: 0x060606, shininess: 20 });
  const holeDirs = [
    new THREE.Vector3( 0.18, 1.0,  0.30),    // index finger
    new THREE.Vector3(-0.18, 1.0,  0.30),    // middle finger (adjacent pair)
    new THREE.Vector3( 0.00, 1.0, -0.42),    // thumb (offset)
  ];
  const holeLen = radius * 0.36;             // scale hole depth with ball size
  const holeR = radius * 0.11;
  for (const dir of holeDirs) {
    dir.normalize();
    const hole = new THREE.Mesh(
      new THREE.CylinderGeometry(holeR, holeR, holeLen, 20),
      holeMat
    );
    // Cap a hair proud of the surface so the opaque sphere never occludes it.
    const capDistance = radius + 0.005;
    const seat = capDistance - holeLen / 2;
    hole.position.copy(dir.clone().multiplyScalar(seat));
    hole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    ball.add(hole);
  }

  return ball;
}

// The play ball — held as a module-level reference so the game can move it.
let ball;
function createBall() {
  ball = makeBowlingBall(BALL_RADIUS, 0x1c2c8c, 140);   // deep glossy blue
  ball.position.copy(BALL_START);
  scene.add(ball);
}

// ============================================================================
//  Aiming guide — a thin line down the lane showing the current aim (and a
//  small lean for spin). Visible only while aiming / charging power.
// ============================================================================
let aimLine;
function createAimGuide() {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, MARK_Y + 0.02, 0),
    new THREE.Vector3(0, MARK_Y + 0.02, -1),
  ]);
  const mat = new THREE.LineBasicMaterial({ color: 0x39d0ff });
  aimLine = new THREE.Line(geo, mat);
  scene.add(aimLine);
}

function updateAimGuide() {
  const show = gameState.phase === 'aiming' || gameState.phase === 'power';
  aimLine.visible = show;
  if (!show) return;
  // Project from the ball toward the pins, leaning sideways with spin.
  const x0 = gameState.aimX;
  const x1 = gameState.aimX + gameState.spin * 1.6;   // visual hook lean
  const pos = aimLine.geometry.attributes.position;
  pos.setXYZ(0, x0, MARK_Y + 0.02, BALL_START.z);
  pos.setXYZ(1, x1, MARK_Y + 0.02, -57);
  pos.needsUpdate = true;
}

// ============================================================================
//  BONUS infrastructure (no physics): back masking wall, ball-return rail,
//  a bench, the ball rack, and lane bumpers — all carried over from HW05.
// ============================================================================
function createBackWall() {
  const geo = new THREE.BoxGeometry(LANE_WIDTH + 2 * GUTTER_WIDTH + 1.5, 6, 0.4);
  const mat = new THREE.MeshPhongMaterial({ color: 0x161a22, shininess: 10 });
  const wall = new THREE.Mesh(geo, mat);
  wall.position.set(0, 3 - LANE_THICKNESS, -63);
  wall.receiveShadow = true;
  scene.add(wall);
}

function createBallReturn() {
  const railMat = new THREE.MeshPhongMaterial({ color: 0x2b2f36, shininess: 60 });
  const railGeo = new THREE.BoxGeometry(0.35, 0.4, LANE_LENGTH * 0.6);
  const rail = new THREE.Mesh(railGeo, railMat);
  const x = LANE_HALF_W + GUTTER_WIDTH + 0.5;
  rail.position.set(x, SURFACE_Y + 0.1, -LANE_LENGTH * 0.3);
  rail.castShadow = true;
  rail.receiveShadow = true;
  scene.add(rail);
}

function createBench() {
  const bench = new THREE.Group();
  const woodMat = new THREE.MeshPhongMaterial({ color: 0x5a3a1e, shininess: 30 });

  const seat = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 0.8), woodMat);
  seat.position.set(0, 0.6, 18.5);
  seat.castShadow = true;
  seat.receiveShadow = true;
  bench.add(seat);

  for (const sx of [-1.3, 1.3]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 0.6), woodMat);
    leg.position.set(sx, 0.3, 18.5);
    leg.castShadow = true;
    leg.receiveShadow = true;
    bench.add(leg);
  }
  scene.add(bench);
}

function createBallRack() {
  const rack = new THREE.Group();

  const rackX = -4.8;        // well left of the left gutter
  const rackZ = 5.0;         // alongside the approach, on the bowler's side
  const ballR = 0.4;
  const width = 1.2;
  const depth = 3.6;
  const lowerTop = 0.9;
  const upperTop = 1.9;

  const frameMat = new THREE.MeshPhongMaterial({ color: 0x3a3f47, shininess: 60 });
  const cradleMat = new THREE.MeshPhongMaterial({ color: 0x15171c, shininess: 30 });

  const postH = upperTop + 0.05;
  for (const px of [rackX - width / 2, rackX + width / 2]) {
    for (const pz of [rackZ - depth / 2, rackZ + depth / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, postH, 0.1), frameMat);
      post.position.set(px, postH / 2, pz);
      post.castShadow = true;
      post.receiveShadow = true;
      rack.add(post);
    }
  }

  for (const topY of [lowerTop, upperTop]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, depth), frameMat);
    shelf.position.set(rackX, topY - 0.04, rackZ);
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    rack.add(shelf);
  }

  const ballZ = [rackZ - 1.0, rackZ, rackZ + 1.0];
  const shelves = [
    { top: lowerTop, colors: [0xc0392b, 0x2980b9, 0x27ae60] }, // red, blue, green
    { top: upperTop, colors: [0xf1c40f, 0x8e44ad, 0xe67e22] }, // yellow, purple, orange
  ];
  for (const shelf of shelves) {
    for (let i = 0; i < ballZ.length; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 12, 24), cradleMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(rackX, shelf.top + 0.02, ballZ[i]);
      rack.add(ring);

      const b = makeBowlingBall(ballR, shelf.colors[i], 120);
      b.position.set(rackX, shelf.top + ballR, ballZ[i]);
      b.rotation.y = i * 1.3 + shelf.top;
      rack.add(b);
    }
  }

  scene.add(rack);
}

function createLaneBumpers() {
  const railR = 0.12;
  const railY = 0.55;
  const reach = 56;
  const mat = new THREE.MeshPhongMaterial({
    color: 0xcfd3d8,
    shininess: 45,
    specular: 0x555a60,
  });

  const railGeo = new THREE.CapsuleGeometry(railR, reach - 2 * railR, 8, 18);
  const xOffset = LANE_HALF_W + railR;
  const centerZ = -reach / 2;

  const base = SURFACE_Y - GUTTER_DROP;
  const postH = railY - base;
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, postH, 12);
  const numPosts = 8;

  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, mat);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(side * xOffset, railY, centerZ);
    rail.castShadow = true;
    rail.receiveShadow = true;
    scene.add(rail);

    for (let i = 0; i < numPosts; i++) {
      const t = (i + 0.5) / numPosts;
      const post = new THREE.Mesh(postGeo, mat);
      post.position.set(side * xOffset, base + postH / 2, -t * reach);
      post.castShadow = true;
      post.receiveShadow = true;
      scene.add(post);
    }
  }
}

// ============================================================================
//  Build the scene
// ============================================================================
setupLights();
createLane();
createApproach();
createGutters();
createPinDeck();
createFoulLine();
createApproachDots();
createTargetingArrows();
createAllPins();
createBall();
createAimGuide();
// Bonus elements:
createBackWall();
createBallReturn();
createBench();
createBallRack();
createLaneBumpers();

// ============================================================================
//  Orbit controls + camera presets
// ============================================================================
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, -28);            // look toward the pins by default
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();
// NOTE: OrbitControls does not listen for key events unless listenToKeyEvents()
// is called, so the arrow keys are free for aiming.

let isOrbitEnabled = true;
let followCam = false;                        // bonus: follow-the-ball camera

// Named camera presets (BONUS): position + look-at target.
const CAMERA_PRESETS = {
  bowler:   { pos: [0, 5, 12],     target: [0, 0.5, -28] },
  overhead: { pos: [0, 48, -26],   target: [0, 0, -28] },
  pinEnd:   { pos: [0, 2, -63],    target: [0, 1, -50] },
  side:     { pos: [14, 7, -28],   target: [0, 1, -28] },
  rack:     { pos: [-2.6, 2.5, 11], target: [-4.8, 1.3, 5.0] },
};

function applyPreset(name) {
  const p = CAMERA_PRESETS[name];
  if (!p) return;
  followCam = false;
  camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
  controls.target.set(p.target[0], p.target[1], p.target[2]);
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
}

// ============================================================================
//  HW06 GAME STATE
// ============================================================================
// Phase state machine: aiming → power → rolling → resolving → (aiming | gameover)
const gameState = {
  phase: 'aiming',
  aimX: 0,                 // ball lateral aim along the foul line
  spin: 0,                 // hook input (−1..1)
  power: 0,                // current power-meter value (0..1)
  powerDir: 1,             // oscillation direction
  velocity: new THREE.Vector3(),
  rollTime: 0,
  gutterBall: false,
  standingBefore: 10,      // pins standing when the current ball was released
  resolveTimer: 0,
  msgTimer: 0,
};

// Ten-frame scorecard model. Each frame holds the raw pins knocked per ball.
let frames = [];
let currentFrame = 0;
let gameOver = false;

function newGame() {
  frames = Array.from({ length: 10 }, () => ({ rolls: [] }));
  currentFrame = 0;
  gameOver = false;
  resetRack();
  resetBallForAim();
  setMessage('');
  renderScorecard();
  updateStatus();
}

function resetBallForAim() {
  gameState.phase = 'aiming';
  gameState.aimX = 0;
  gameState.spin = 0;
  gameState.power = 0;
  gameState.powerDir = 1;
  gameState.velocity.set(0, 0, 0);
  gameState.rollTime = 0;
  gameState.gutterBall = false;
  ball.position.copy(BALL_START);
  ball.quaternion.identity();
  ball.visible = true;
  updatePowerMeter();
}

// ============================================================================
//  Scoring — pure ten-frame logic (strikes, spares, open frames + bonuses).
//  Returns a length-10 array of cumulative totals (null where not yet scorable).
// ============================================================================
function computeFrameTotals(frameData) {
  // Flatten to a per-ball list, remembering where each frame starts.
  const flat = [];
  const start = [];
  for (let i = 0; i < 10; i++) {
    start[i] = flat.length;
    for (const r of frameData[i].rolls) flat.push(r);
  }

  const totals = new Array(10).fill(null);
  let cum = 0;
  for (let f = 0; f < 10; f++) {
    const s = start[f];
    if (s >= flat.length) break;             // this frame hasn't been rolled yet

    if (f < 9) {
      const first = flat[s];
      if (first === 10) {                     // strike: 10 + next two balls
        if (s + 2 < flat.length) { cum += 10 + flat[s + 1] + flat[s + 2]; totals[f] = cum; }
        else break;                           // bonus balls not thrown yet
      } else if (flat.length > s + 1) {
        const sum = first + flat[s + 1];
        if (sum === 10) {                     // spare: 10 + next one ball
          if (s + 2 < flat.length) { cum += 10 + flat[s + 2]; totals[f] = cum; }
          else break;
        } else {                              // open frame
          cum += sum; totals[f] = cum;
        }
      } else break;                           // only one ball so far, open & incomplete
    } else {
      // 10th frame: needs 3 balls on a strike/spare, otherwise 2.
      const fr = frameData[9].rolls;
      const need = (fr[0] === 10 || (fr.length >= 2 && fr[0] + fr[1] === 10)) ? 3 : 2;
      if (fr.length >= need) { cum += fr.reduce((a, b) => a + b, 0); totals[f] = cum; }
      else break;
    }
  }
  return totals;
}

// Per-frame roll symbols for frames 1-9 → ['', ''] | [n, '/'] | [n, m].
function formatFrame(rolls) {
  if (rolls.length === 0) return ['', ''];
  if (rolls[0] === 10) return ['', 'X'];                 // strike
  const a = rolls[0] === 0 ? '-' : String(rolls[0]);
  if (rolls.length < 2) return [a, ''];
  const spare = rolls[0] + rolls[1] === 10;
  const b = spare ? '/' : (rolls[1] === 0 ? '-' : String(rolls[1]));
  return [a, b];
}

// 10th-frame symbols (up to 3 balls, each box can be a strike/spare). A strike
// is only the FIRST ball of a fresh rack; clearing a rack on a later ball is a
// spare (so a gutter-then-10 reads '-', '/', not '-', 'X').
function formatTenth(rolls) {
  const syms = ['', '', ''];
  let remaining = 10;
  let firstOfRack = true;
  for (let k = 0; k < rolls.length; k++) {
    const v = rolls[k];
    if (v === 10 && firstOfRack) syms[k] = 'X';                // strike (full fresh rack)
    else if (remaining - v === 0) syms[k] = '/';               // spare (cleared the rack)
    else syms[k] = v === 0 ? '-' : String(v);
    if (remaining - v === 0) { remaining = 10; firstOfRack = true; }   // fresh rack
    else { remaining -= v; firstOfRack = false; }
  }
  return syms;
}

// ============================================================================
//  Frame / game flow — fold one resolved roll into the scorecard model.
//  Sets gameOver, advances currentFrame, and returns whether the rack must be
//  reset before the next roll.
// ============================================================================
function recordRoll(knocked) {
  const f = frames[currentFrame];
  f.rolls.push(knocked);
  const isTenth = currentFrame === 9;

  let frameDone = false;
  if (!isTenth) {
    if (f.rolls[0] === 10 || f.rolls.length === 2) frameDone = true;  // strike, or two balls
  } else {
    if (f.rolls.length === 3) frameDone = true;
    else if (f.rolls.length === 2) {
      const bonus = f.rolls[0] === 10 || f.rolls[0] + f.rolls[1] === 10; // strike or spare → 3rd ball
      if (!bonus) frameDone = true;
    }
  }

  let resetNeeded;
  if (frameDone) {
    if (isTenth) gameOver = true;
    else currentFrame++;
    resetNeeded = true;                  // fresh rack for the next frame / end
  } else {
    // Same frame, another ball: reset only if the rack was just cleared
    // (a strike or spare inside the 10th frame).
    resetNeeded = countStanding() === 0;
  }
  return resetNeeded;
}

// ============================================================================
//  HW06 UI — controls panel, status banner, power meter, scorecard, messages.
// ============================================================================
const scoreRollCells = document.querySelectorAll('#scorecard .frame-rolls td');
const scoreTotalCells = document.querySelectorAll('#scorecard .frame-total td');
const statusEl = document.getElementById('status-banner');
const messageEl = document.getElementById('message');
const powerFillEl = document.getElementById('power-fill');
const powerMeterEl = document.getElementById('power-meter');

function renderScorecard() {
  const totals = computeFrameTotals(frames);
  for (let f = 0; f < 10; f++) {
    const spans = scoreRollCells[f].querySelectorAll('span');
    const syms = f < 9 ? formatFrame(frames[f].rolls) : formatTenth(frames[9].rolls);
    for (let i = 0; i < spans.length; i++) spans[i].textContent = syms[i] || '';
    scoreTotalCells[f].textContent = totals[f] == null ? '' : totals[f];
    scoreRollCells[f].classList.toggle('active-frame', f === currentFrame && !gameOver);
  }
}

function updateStatus() {
  if (!statusEl) return;
  if (gameOver) {
    const totals = computeFrameTotals(frames);
    const final = totals[9] != null ? totals[9] : (totals.filter(t => t != null).pop() || 0);
    statusEl.innerHTML = `<b>GAME OVER</b> — Final score: ${final}. Press <kbd>R</kbd> for a new game.`;
    return;
  }
  const frameNo = currentFrame + 1;
  let hint;
  switch (gameState.phase) {
    case 'aiming':
      hint = 'Aim <kbd>←</kbd><kbd>→</kbd> · Spin <kbd>↑</kbd><kbd>↓</kbd> · <kbd>Space</kbd> power';
      break;
    case 'power':
      hint = '<kbd>Space</kbd> to lock power &amp; release';
      break;
    case 'rolling':
      hint = 'Rolling…';
      break;
    default:
      hint = 'Resolving…';
  }
  statusEl.innerHTML = `<b>Frame ${frameNo}</b> &nbsp; ${hint}`;
}

function updatePowerMeter() {
  if (powerFillEl) powerFillEl.style.width = `${Math.round(gameState.power * 100)}%`;
  if (powerMeterEl) {
    powerMeterEl.classList.toggle('charging', gameState.phase === 'power');
    powerMeterEl.classList.toggle('locked', gameState.phase === 'rolling');
  }
}

function setMessage(text, sticky = false) {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.style.opacity = text ? '1' : '0';
  gameState.msgTimer = sticky ? Infinity : (text ? MSG_TIME : 0);
}

// ============================================================================
//  HW06 INPUT HANDLING
// ============================================================================
function handleKeyDown(e) {
  const k = e.key.toLowerCase();

  // Always-available controls.
  switch (k) {
    case 'o': isOrbitEnabled = !isOrbitEnabled; return;
    case 'c': followCam = !followCam; return;
    case 'r': newGame(); return;
    case '1': applyPreset('bowler');   return;
    case '2': applyPreset('overhead'); return;
    case '3': applyPreset('pinEnd');   return;
    case '4': applyPreset('side');     return;
    case '5': applyPreset('rack');     return;
  }

  if (gameOver) return;

  // Aiming controls (only while aiming).
  if (gameState.phase === 'aiming') {
    if (e.key === 'ArrowLeft')  { gameState.aimX = Math.max(-AIM_X_LIMIT, gameState.aimX - AIM_STEP); ball.position.x = gameState.aimX; e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { gameState.aimX = Math.min( AIM_X_LIMIT, gameState.aimX + AIM_STEP); ball.position.x = gameState.aimX; e.preventDefault(); return; }
    if (e.key === 'ArrowUp')    { gameState.spin = Math.max(-SPIN_LIMIT, gameState.spin - SPIN_STEP); e.preventDefault(); return; }
    if (e.key === 'ArrowDown')  { gameState.spin = Math.min( SPIN_LIMIT, gameState.spin + SPIN_STEP); e.preventDefault(); return; }
  }

  // Space drives the power meter / release.
  if (e.key === ' ' || k === 'spacebar') {
    e.preventDefault();
    if (gameState.phase === 'aiming') {
      gameState.phase = 'power';
      gameState.power = 0;
      gameState.powerDir = 1;
      updateStatus();
    } else if (gameState.phase === 'power') {
      releaseBall();
    }
  }
}
document.addEventListener('keydown', handleKeyDown);

function releaseBall() {
  const speed = MIN_SPEED + gameState.power * (MAX_SPEED - MIN_SPEED);
  gameState.velocity.set(0, 0, -speed);        // straight down-lane; spin curves it
  gameState.standingBefore = countStanding();
  gameState.rollTime = 0;
  gameState.gutterBall = false;
  gameState.phase = 'rolling';
  updatePowerMeter();
  updateStatus();
}

// ============================================================================
//  HW06 PHYSICS, COLLISION & RESOLUTION (driven each frame from animate)
// ============================================================================
function updateGame(dt) {
  // Tick down any transient on-screen message.
  if (gameState.msgTimer !== Infinity && gameState.msgTimer > 0) {
    gameState.msgTimer -= dt;
    if (gameState.msgTimer <= 0) setMessage('');
  }

  // Always advance pin topple animations.
  updatePins(dt);

  switch (gameState.phase) {
    case 'power':
      // Oscillate the power meter between 0 and 1 (triangle wave).
      gameState.power += gameState.powerDir * POWER_SPEED * dt;
      if (gameState.power >= 1) { gameState.power = 1; gameState.powerDir = -1; }
      else if (gameState.power <= 0) { gameState.power = 0; gameState.powerDir = 1; }
      updatePowerMeter();
      break;

    case 'rolling':
      stepRoll(dt);
      break;

    case 'resolving':
      gameState.resolveTimer -= dt;
      if (gameState.resolveTimer <= 0) finalizeRoll();
      break;
  }
}

// Integrate the roll with small sub-steps so a fast ball can't tunnel a pin.
function stepRoll(dt) {
  gameState.rollTime += dt;
  const v = gameState.velocity;

  const STEP = 0.008;
  let remaining = dt;
  while (remaining > 1e-5) {
    const h = Math.min(STEP, remaining);
    remaining -= h;

    // Rolling friction (exponential) + lateral hook acceleration from spin.
    const damp = Math.exp(-ROLL_DAMP * h);
    v.multiplyScalar(damp);
    if (!gameState.gutterBall) v.x += gameState.spin * HOOK_ACCEL * h;

    ball.position.x += v.x * h;
    ball.position.z += v.z * h;

    // Roll spin for visual flair (rotate about X as it travels along Z).
    ball.rotateX((-v.z * h) / BALL_RADIUS);

    // Collide at the true (pre-snap) position first, so a ball that clips a
    // corner pin on its way off the lane still registers that hit.
    if (!gameState.gutterBall) collideBallPins();

    // Gutter detection: ball crosses the lane edge → drop into the channel.
    if (!gameState.gutterBall && Math.abs(ball.position.x) > LANE_HALF_W) {
      gameState.gutterBall = true;
      const side = Math.sign(ball.position.x);
      ball.position.x = side * (LANE_HALF_W + GUTTER_WIDTH / 2);
      ball.position.y = SURFACE_Y - GUTTER_DROP + BALL_RADIUS * 0.5;
      v.x = 0;                                  // slide straight down the gutter
    }

    if (ball.position.z <= -LANE_LENGTH) { ball.position.z = -LANE_LENGTH; break; }
  }

  const speed = Math.hypot(v.x, v.z);
  const stopped = speed < STOP_SPEED;
  const offEnd = ball.position.z <= -LANE_LENGTH;
  const timeout = gameState.rollTime > MAX_ROLL_T;
  if (stopped || offEnd || timeout) beginResolve();
}

// Ball ↔ pin collision: topple any standing pin whose footprint the ball reaches.
function collideBallPins() {
  const reach = BALL_RADIUS + PIN_RADIUS;
  for (const p of pins) {
    if (!p.standing) continue;
    const dx = ball.position.x - p.x;
    const dz = ball.position.z - p.z;
    if (dx * dx + dz * dz <= reach * reach) {
      // Fall direction = from the ball toward the pin (the push), with a small
      // bias down-lane so head-on hits still topple forward. The ball seeds the
      // cascade with full energy (1.0).
      const dir = new THREE.Vector3(p.x - ball.position.x, 0, (p.z - ball.position.z) - 0.2);
      topplePin(p, dir, 0, 1.0);
    }
  }
}

function beginResolve() {
  gameState.phase = 'resolving';
  gameState.resolveTimer = RESOLVE_DELAY;
  updateStatus();
}

// After the resolve pause: count pins, score, advance the frame, reset.
function finalizeRoll() {
  const knocked = gameState.standingBefore - countStanding();

  // Transient feedback message.
  if (gameState.gutterBall) setMessage('GUTTER BALL');
  else if (knocked === 10) setMessage(currentFrame === 9 ? 'STRIKE!' : (frames[currentFrame].rolls.length === 0 ? 'STRIKE!' : 'SPARE!'));
  else if (gameState.standingBefore < 10 && knocked === gameState.standingBefore) setMessage('SPARE!');
  else if (knocked === 0) setMessage('MISS');

  const resetNeeded = recordRoll(knocked);
  renderScorecard();

  if (gameOver) {
    gameState.phase = 'gameover';
    ball.visible = false;
    updateStatus();
    const totals = computeFrameTotals(frames);
    setMessage(`GAME OVER — ${totals[9] ?? ''} pts`, true);
    return;
  }

  if (resetNeeded) resetRack();   // otherwise the standing pins remain for the next ball
  resetBallForAim();
  updateStatus();
}

// ============================================================================
//  Camera follow (bonus) — gently track the ball while it rolls.
// ============================================================================
function updateFollowCam() {
  if (!followCam || gameState.phase !== 'rolling') return;
  controls.target.lerp(ball.position, 0.1);
  const desired = new THREE.Vector3(ball.position.x, 3.2, ball.position.z + 7);
  camera.position.lerp(desired, 0.05);
}

// ============================================================================
//  Responsive resize
// ============================================================================
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onWindowResize);

// ============================================================================
//  Render loop — hand-written physics integrated with delta time.
// ============================================================================
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);  // clamp to avoid huge catch-up steps
  updateGame(dt);
  updateAimGuide();
  updateFollowCam();

  controls.enabled = isOrbitEnabled;
  controls.update();                            // needed for damping
  renderer.render(scene, camera);
}

// Kick everything off.
newGame();
animate();
