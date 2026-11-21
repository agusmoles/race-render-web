<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# General considerations

- Use `pnpm` as package manager and for running commands.
- Use `shadcn` for UI components.
- Use server actions instead of API routes.
- Use `prisma` as ORM.
- Dont add code comments unless necessary, make sure your code is self-documenting.
- When you are not sure about something, ask me.
- No JSX comments.
- Always follow the design system documented in `DESIGN.md` for any UI work.

# Telemetry & Auto-Sync Architecture

- **Sync model:** `telemetryTime = (globalVideoTime - syncOffset) * speedScale`.
- **Session load cascade (`src/components/Workspace.tsx`):** `initializeSessionSync` runs from `handleVideoChange` and `handleCSVChange` once both video metadata (`videoDurations`) and parsed CSV telemetry (`localTelemetry`) are ready:
  1. Checks `localStorage` (`race_render_sync_${videoNames}_${csvName}`); if found, restores `{ syncOffset, speedScale }` and skips auto-sync.
  2. Otherwise calls `autoSyncWithGpmf(videoFiles, videoDurations, telemetry.rows)` from `src/utils/gpmf-sync.ts`.
- **GoPro GPMF Auto-Sync (`src/utils/gpmf-sync.ts`):**
  - Zero-dependency client-side MP4 parser scans top-level boxes for `moov` and reads `gpmd` chunks via bounded `File.slice()` calls (`MAX_MOOV_BYTES` / `MAX_GPMD_BYTES` = 64 MB, `MAX_SAMPLES` = 100,000, KLV recursion capped at depth 8).
  - Extracts channels in priority order:
    1. `gopro-gps-speed`: `GPS5` / `GPS9` 2D speed vs AiM `speed` (`matched` if `r >= 0.72`).
    2. `gopro-gyro`: `GYRO` magnitude (deg/s) vs AiM `|gyro|` (if non-trivial) or `|latAcc|` (`matched` if `r >= 0.65`).
    3. `gopro-accl`: gravity-subtracted dynamic `ACCL` magnitude (G) vs AiM `hypot(latAcc, lonAcc)` (`matched` if `r >= 0.65`).
  - Resamples signals to 10 Hz (`movingAverage` 5-sample filter on IMU channels), runs radix-2 FFT overlap-normalized Pearson cross-correlation with parabolic peak interpolation, and refines `speedScale` + `syncOffset` across split windows for clock drift when overlap `>= 120s` and `r >= 0.8`.
- **Sync UI behavior:** `matched` auto-applies; `low-confidence` (`r >= 0.45`) shows a status pill with a one-click **Apply** button; `no-gpmd` / `no-signal` or manual fine-tuning goes through the **Sync Wizard** modal (no inline offset/scale controls on the main page).

# Notes for Future Sessions

- **Multi-clip timeline:** Uploaded `videoFiles` are sorted by filename and concatenated into a single global timeline via `videoDurations` and `resolveVideoClipPosition` (used by main playback, keyboard seeking, export, and the Sync Wizard).
- **Home player shortcuts (disabled inside inputs/modals):** `Space` play/pause, `←`/`→` ±3s, `Shift+←`/`→` ±10s, `,`/`.` ±1 frame (`1/60s`).
- **CSV parser (`src/utils/csv-helper.ts`):** Supports AiM RS2/RS3 exports (`docs/example-rs3-export.csv`), detects `gyro` (`gyro`/`yaw`), shifts `beaconMarkers` when `rows[0].time > 0`, and falls back to `metadata["Sample Rate"]` on short files.
- **HUD & Fullscreen scaling:** Fullscreen wraps `<video>` and overlays inside a centered 16:9 stage (`width: min(100vw, calc(100vh * 16 / 9))`). Keep gauges in `src/components/gauges/*` scaled via `@container` + `cqw` or full-bleed SVG `viewBox` (avoid fixed `w-*`/`h-*` or `max-w-*`/`max-h-*` caps).
- **HUD export parity:** When updating HUD labels or visuals, update the React gauge components (`src/components/gauges/*`), `drawCanvasHUD` in `src/components/Workspace.tsx`, and `src/utils/hud-draw.ts` together (`src/workers/exportWorker.ts` uses `mediabunny` WebCodecs + `hud-draw.ts`, while `Workspace.tsx` currently exports via `MediaRecorder`).
- **React Compiler (`reactCompiler: true` in `next.config.ts`):** Avoid calling `setState` synchronously inside `useEffect` (`react-hooks/set-state-in-effect`); trigger load/restore/auto-sync logic from event handlers. Note that `pnpm lint` currently reports pre-existing errors in untouched lines of `Workspace.tsx` and `exportWorker.ts` (including `preserve-manual-memoization`, `prefer-const`, and `no-explicit-any`).
