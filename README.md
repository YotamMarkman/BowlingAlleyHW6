# Computer Graphics — Exercise 6 — Interactive Bowling Game

A fully playable 3D bowling game built with **Three.js r160** (ES modules via
import map), WebGL, and OrbitControls. It extends the static **HW05** alley
(lane, markings, pins, ball, lighting, camera, UI scaffolding) with the **HW06**
interactive layer: aiming, an oscillating power meter, hand-written ball
physics, pin collision and toppling, and a complete ten-frame scoring system.
All physics is hand-written in the render loop — **no external physics engine**.

## Group Members
- Yotam Markman (ID: 322632266)

## How to Run
1. Make sure you have Node.js installed.
2. Install dependencies (first time only):
   ```bash
   npm install
   ```
3. Start the local web server:
   ```bash
   node index.js
   ```
4. Open your browser at **http://localhost:8000**.

> Three.js and OrbitControls load from a CDN (`unpkg.com`) via an import map,
> so an internet connection is required on first load.

## How to Play
1. **Aim** the ball left/right along the foul line with the arrow keys.
2. Optionally add **spin/hook** with the up/down arrows (the aim guide leans to
   preview the curve).
3. Press **Space** to start the **power meter** — it sweeps up and down.
4. Press **Space** again to **lock the power and release** the ball.
5. The ball rolls with simplified physics, knocks down pins (with pin-to-pin
   chain reactions), or falls into a gutter. The scorecard updates automatically.
6. Press **R** at any time to reset the pins and start a fresh game.

## Controls
| Key | Action |
| --- | --- |
| `←` / `→` | Aim the ball along the foul line |
| `↑` / `↓` | Adjust spin / hook (curve) |
| `Space` | Start the power meter, then press again to lock power & release |
| `R` | Reset pins / start a new game |
| `O` | Toggle orbit camera controls on/off |
| `C` | Toggle the follow-the-ball camera (bonus) |
| `1`–`5` | Camera presets: bowler / overhead / pin-end / side / ball-rack |

## Coordinate System
- Foul line at **Z = 0**; pins at **negative Z** (head pin at Z = -57); approach on the **+Z** side.
- Lane runs along **Z**, width along **X**, up is **+Y**.
- The playing surface (lane top) is at **Y = 0**; pin bases sit at Y = 0.

## Project Structure
```
index.html      Page shell, import map, UI overlays (scorecard, status, power meter, controls, message)
style.css       UI overlay styling
index.js        Express static server (port 8000)
src/hw6.js      The full game: static scene + interactive layer (physics, collision, scoring)
src/OrbitControls.js   Legacy r128 vendored controls (unused — kept for reference)
```

## Implemented Features

### Required (HW06)
- **Aiming & power** — move the ball along the foul line, an oscillating power
  meter you lock with Space, and a release whose speed/direction come from the
  aim and chosen power, all driven by a small `aiming → power → rolling →
  resolving` state machine. The `O` orbit toggle from HW05 still works.
- **Hand-written physics** — the ball is integrated from a velocity vector each
  frame using `Clock` delta time, with rolling friction and optional hook
  curvature. The step is sub-divided so a fast ball never tunnels through a pin.
  **Gutter detection**: crossing the lane edge drops the ball into the channel
  and knocks down zero pins. The ball comes to rest at the pin end, on a gutter
  ball, or when it effectively stops.
- **Pin collision & toppling** — ball↔pin collision (sphere vs. pin cylinder)
  and pin↔pin propagation (a falling pin knocks neighbours roughly ahead of its
  fall). Knocked pins visibly topple over and lie flat; the set of standing pins
  is tracked exactly for scoring.
- **Ten-frame scoring** — 10 frames, strike (`X`), spare (`/`), and open-frame
  scoring with the correct bonus rules, a third ball in the 10th frame on a
  strike/spare, and a running cumulative total in the scorecard. (A perfect game
  scores 300; the scoring logic is unit-tested against 300/150/90 and the
  standard worked example of 133.)
- **Game flow** — end-of-roll detection counts the fallen pins, updates the
  score, advances the roll/frame, resets pins between frames (and inside the
  10th frame after a strike/spare), returns the ball to the approach, and shows
  a clear **GAME OVER** with the final score. `R` starts a new game.

### Bonus
- **Follow-the-ball camera** (`C`) plus five camera presets (`1`–`5`).
- **Spin / hook** dynamics driven by the up/down arrows, with an on-lane aim guide.
- Carried over from HW05: a left-side **ball rack** with six coloured balls,
  **lane bumpers**, a **ball-return rail**, a **seating bench**, and a back
  masking wall.

## Known Limitations
- Physics is intentionally simplified (no angular momentum, no pin-to-ball
  deflection); pins topple by a kinematic animation rather than rigid-body
  dynamics.
- Pin-to-pin propagation uses a distance + fall-direction heuristic, so very
  glancing hits resolve pin action a little more readily than real life.
- Finger holes are visually embedded dark cylinders (no CSG), so they read as
  holes only from the upper hemisphere.
- Three.js loads from a CDN; the scene will not render fully offline.

## Asset Sources
- **Three.js r160** and **OrbitControls** — https://unpkg.com/three@0.160.0/
- No external textures, models, or images are used; all geometry and materials
  are generated procedurally in code.
