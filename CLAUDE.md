# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Computer Graphics course Exercise 6: an interactive WebGL bowling game built with THREE.js (r160 via import map). It extends the static HW05 alley with a full playable game — aim/spin controls, an oscillating power meter, hand-written ball physics, ball↔pin and pin↔pin collision with topple animation, and a ten-frame scoring system. All physics is hand-written in `animate()` (no external physics engine), per the assignment.

## Running the Application

```bash
node index.js
# Open http://localhost:8000 in browser
```

No build step. Express serves `index.html` at root and static files from `/src`.

## Architecture

- `index.js` — Express server (port 8000), serves `index.html`, `/style.css`, and static files from `/src`
- `index.html` — Import map for THREE.js r160 + addons, the UI overlays (scorecard, status banner, power meter, controls panel, message), then loads `src/hw6.js` as an ES module
- `src/hw6.js` — The whole game: static scene (lane, markings, gutters, pins, ball, lights, bonus props) plus the HW06 interactive layer (state machine, input, physics, collision/toppling, scoring, UI rendering, render loop)
- `style.css` — UI overlay styling
- `src/OrbitControls.js` — legacy r128 vendored controls, kept for reference but UNUSED (the game imports OrbitControls from the r160 addons via the import map)

THREE.js is imported as an ES module (`import * as THREE from 'three'`); there is no global `THREE`. OrbitControls comes from `three/addons/controls/OrbitControls.js`.

## Game architecture (src/hw6.js)

- Phase state machine: `aiming → power → rolling → resolving → (aiming | gameover)` held in `gameState.phase`
- Physics is integrated each frame in `animate()` via a `THREE.Clock` delta, sub-stepped in `stepRoll()` to prevent tunnelling
- Pins are runtime records in the `pins[]` array (`standing`/`falling`/topple `axis`+`angle`); `topplePin()` handles ball→pin and pin→pin propagation
- Scoring lives in pure, testable functions: `recordRoll()` (frame flow), `computeFrameTotals()` (cumulative totals), `formatFrame()`/`formatTenth()` (X / `/` / `-` notation)

## Code Style

- ES modules (`import`/`export`)
- 2-space indentation
- camelCase for functions
- THREE.js naming conventions for objects (Scene, Camera, Mesh, etc.)
- Helper: `degrees_to_radians()` exists in hw6.js

## Key Interactions

- `← →` aim, `↑ ↓` spin, `Space` power-then-release, `R` new game, `O` toggle orbit, `C` follow-cam, `1`–`5` camera presets
- All 3D objects cast/receive shadows; the scene is responsive to window resize
