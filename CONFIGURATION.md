# Project Configuration

## Commands
- `node index.js` - Start the application (serves on port 8000)
- Access via browser at `http://localhost:8000`

## Project Structure
- WebGL 3D graphics application using THREE.js r160 (loaded via import map)
- Interactive bowling game implemented in `/src/hw6.js`
- OrbitControls (r160 addons) for camera manipulation

## Code Style Guidelines
- ES modules (import/export)
- Use consistent spacing (2-space indentation)
- Descriptive variable names (e.g., `cameraTranslate` not `ct`)
- THREE.js objects follow conventions:
  - Scene, Camera, Renderer, Geometry, Material, Mesh
- Animation frame handling via requestAnimationFrame
- Event listeners for keyboard controls
- Camera/view controls through OrbitControls
- Functions use camelCase (e.g., `degreesToRadians`)
- Comments for explaining complex sections or calculations

## Implementation Notes
- Toggle orbit camera with 'o' key; aim with arrows, charge/release with Space, reset with 'r'
- Main rendering and hand-written physics happen in the animate() function (delta-time integration)
- Scene interactions should follow THREE.js patterns