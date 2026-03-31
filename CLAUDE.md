# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev        # Start dev server with HMR
pnpm build      # Build for production (output: dist/)
pnpm preview    # Preview production build locally
```

No test runner is configured.

## Architecture

**Terror Three** is a browser-based 3D horror game using Three.js, TypeScript, and Vite, deployed on Netlify.

### Entry flow

`main.ts` → mounts DOM references and creates `Game` → `game.start()` → `initWorld()` (async loading pipeline) → `loop()` (rAF game loop)

### Loading pipeline (`Game.ts → initWorld`)

1. Download level GLB with progress tracking (0–60%)
2. Parse GLB blob → extract collision boxes and spawn point
3. Load HDRI environment (`sky.ts`)
4. Initialize entities: Player, Enemy, Flashlight, Pickups
5. Register colliders, place player at spawn, set up HUD

### Layer structure

| Directory | Purpose |
|---|---|
| `src/core/` | Three.js setup — renderer, camera, scene, input, asset loading |
| `src/game/` | `Game.ts` orchestrator, types, state helpers, constants |
| `src/entities/` | Stateful game objects (Player, Enemy, Flashlight, Pickup) |
| `src/systems/` | Decoupled mechanics — collision, controls, AI, inventory, UI, post-FX |
| `src/world/` | Level loading (`Level1.ts`), hardcoded collider/spawn data (`levelData.ts`), sky/HDRI |
| `src/utils/` | Math, raycasting, collision helpers, debug visualization, scene optimization |

### Key systems

**ControlsSystem** — pointer lock, yaw/pitch camera hierarchy, mouse delta clamped at 60px/frame, 1.6× speed on Shift.

**CollisionSystem** — sphere-vs-AABB with a sliding algorithm (try X-only, then Z-only on collision). Ignores colliders named with "floor"/"ground"/"terrain" and those with volume > 800 units³. Player height fixed at 1.7 units.

**EnemySystem** — enemy freezes when the flashlight is on and the player looks at it (dot product > 0.1). Speed lerps between 0.35 (close) and 1.5 (far), boosted up to 50% as the player collects more items. Catch distance: < 1.0 unit.

**Flashlight** — nested hierarchy: root → muzzle → SpotLight target. Battery drains 1%/sec; flickers with a sine wave below 15%. Mounts to camera on pickup.

**PostFXSystem** — EffectComposer with FilmPass (grain intensity 0.8).

**UISystem** — F3 toggles FPS counter + player position + camera direction.

### Path aliases (tsconfig + vite.config)

`@core`, `@game`, `@entities`, `@systems`, `@world`, `@utils` resolve to the corresponding `src/` subdirectories.

### Game states

`LOADING` → `PLAYING` → `GAME_OVER`

### Asset notes

GLB models live in `public/models/`; HDRI in `public/hdri/`. `netlify.toml` sets 3-day cache headers for both. Assets target 1k texture sizes to keep bundle size down.
