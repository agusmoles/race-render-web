# Contributing to Open RaceRender Web

Thank you for your interest in contributing to **[Open RaceRender Web](https://openracerender.com/)**! Created by [Agustín Molés](https://agustinmoles.com.ar), this project is a 100% client-side, browser-based telemetry overlay and 3D lap comparison studio hosted at [github.com/agusmoles/race-render-web](https://github.com/agusmoles/race-render-web).

---

## Ground Rules & Tech Stack

Please follow these rules to keep the codebase fast, clean, and maintainable:

1. **Package Manager:** Use `pnpm` exclusively. Do not commit `package-lock.json` or `yarn.lock`.
2. **Client-Side Privacy First:** All video decoding, telemetry parsing, GPMF sync, 3D rendering, and video export must stay 100% client-side in the browser. Never send user video or telemetry files to external services.
3. **Core Stack:** Next.js (App Router, React 19, React Compiler enabled), TypeScript, Tailwind CSS v4, Lucide React, Three.js, and `mediabunny` / WebCodecs + WebGL2 + Canvas 2D.
4. **React Compiler Safety:** `reactCompiler: true` is enabled in `next.config.ts`. Avoid synchronous `setState` inside `useEffect`; trigger load, restore, and auto-sync flows from event handlers.
5. **No JSX Comments:** Never leave comments inside JSX/TSX markup.
6. **Self-Documenting Code:** Avoid unnecessary comments; prefer clear, descriptive names and small focused helpers.
7. **HUD & Export Parity:** Whenever you change HUD gauges, labels, or visuals, update all three rendering paths together:
   - React gauge components in `src/components/gauges/*`
   - Live canvas rendering (`drawCanvasHUD`) in `src/components/Workspace.tsx`
   - Worker export rendering in `src/utils/hud-draw.ts` (used by `src/workers/exportWorker.ts`)
8. **Responsive HUD Scaling:** Keep gauges scaled via `@container` + `cqw` or full-bleed SVG `viewBox` (avoid fixed pixel caps so fullscreen and high-resolution exports scale cleanly).

---

## Visual Design Guidelines (Carbon Core)

All UI changes must follow the Carbon Core design system documented in [DESIGN.md](./DESIGN.md):

- **Backgrounds:** Deep dark base (`bg-zinc-950`).
- **Cards & Panels:** Carbon Glass (`bg-zinc-900/80 backdrop-blur-md border border-zinc-800`).
- **Accents:** `rose-500` for redlines, warnings, and hot-lap highlights; `cyan-400` for active vectors, track tracers, and sync markers.
- **Typography:** Clean sans-serif (`Inter` / `Geist`) for controls and `monospace` / `Orbitron` style for live numeric telemetry readouts.

---

## Local Development Setup

Prerequisites: Node.js (v20+ recommended) and [pnpm](https://pnpm.io/).

```bash
git clone https://github.com/agusmoles/race-render-web.git
cd race-render-web
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Workflow & Verification

### 1. Create a Branch

Use a descriptive branch name:

```bash
git checkout -b feat/your-feature
# or
git checkout -b fix/your-bugfix
```

### 2. Run Tests, Lint & Build

Before opening a pull request, run the test suite, lint changed files, and confirm the production build succeeds:

```bash
pnpm test
pnpm lint
pnpm build
```

When adding or modifying telemetry parsing, GPMF sync, lap comparison, or export configuration logic, add or update unit tests (`src/**/*.test.ts`).

### 3. Open a Pull Request

- Clearly describe the problem your PR solves and how you verified it.
- Include screenshots or short recordings for any UI or HUD visual changes.
- Keep commits focused and rebased onto `main`.

---

Thank you for helping make Open RaceRender Web better!
