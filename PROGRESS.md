# SURF — progress

Built from `~/Development/SURF_PROMPT.md`, starting from a copy of POND (`~/Development/pond`), milestone by milestone. The reference photograph sits in `references/` locally; it is gitignored and never committed.

## Milestones

| | What | State |
|---|---|---|
| 0 | Copy of POND, renamed, port 5404; art direction from the reference (`docs/ART_DIRECTION.md`) | done |
| 1 | The painted sea: light-cell network, swell, camera solved to cover any screen, bounds from the view | done |
| 2 | Waves as functions with CPU/GLSL twins; foam, face shadow, stipple; wave field with big sets and calm | done |
| 3 | Surfers: lens boards (short/long), capsule rider rig, look from seed, one painted shader, separate board and rider roots | done |
| 4 | Behaviours and state machine: wait, paddle, duck-dive, catch, ride, wipeout, swim, climb; escaped waves; spacing | done |
| 5 | Drawing: stroke reading (facing and size), board picker, refusals, watercolour bloom | done |
| 6 | UI, undo/redo, persistence and validation, keys, PNG capture, recording with the pen line, mobile | done |
| 7 | Scripted demo, gallery, README, CASE_STUDY, this file | done |

## Verification (latest run, 2026-10-31)

- `npm run typecheck`, `npm run lint`: clean. `npm run build` passes (three.js dominates the bundle, as in POND).
- `npm test`: 33 unit tests pass.
- `npm run test:e2e`: 14 Playwright tests pass against the dev server; `E2E_PROD=1 npm run test:e2e`: the same 14 against the production build.
- `scripts/verify-recording.mjs`: H.264 MP4, 1280×720, 238 frames in 3.98 s (≈59.5 fps).
- `scripts/demo.mjs 1600 900`: H.264 MP4, 23.0 s. Story:
  1. A surfer blooms in, then two more.
  2. A wave rolls in: one surfer catches it and rides, one paddles out and ducks under, the third is swept off.
  3. A big set sweeps everyone.
  4. They swim back, climb on and paddle out.

  720p copy in `docs/media/surf-demo.mp4`, contact sheet `docs/media/demo-sheet.png`.
- `scripts/perf.mjs` (load average ≈ 7 during the run):
  - DPR 1: 5.5 ms/frame with 12 surfers at 1440×900; 7.3 ms at 1920×1080.
  - DPR 2: 16.2 ms and 25.5 ms. The adaptive pixel ratio steps down when needed.

## Not done

- No public GitHub repository or deploy yet; both wait for the author's go-ahead.
- Only Chromium has been tested (desktop and emulated mobile).
- No sound.
