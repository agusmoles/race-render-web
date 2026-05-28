# Contributing to Open RaceRender Web (Carbon Core)

Welcome, fellow developer, to the **Open RaceRender Web** codebase. We build high-performance, browser-based telemetry overlay tools. To keep the fire burning bright and the dashboard running fast, please follow these guidelines when contributing!

---

## 🛠️ Tech Stack & Ground Rules

To keep our code clean, strong, and highly performant, all contributors must strictly adhere to the following setup rules:

1. **Package Manager**: Use `pnpm` exclusively. Do not commit `package-lock.json` or `yarn.lock`.
   - Install dependencies: `pnpm install`
   - Run dev server: `pnpm dev`
   - Build project: `pnpm build`
2. **UI & Components**: Use [shadcn/ui](https://ui.shadcn.com/) for UI components.
3. **Database & ORM**: Use **Prisma** as the Object-Relational Mapper (ORM).
4. **Data Fetching & APIs**: Use **Server Actions** instead of API routes for data operations.
5. **No JSX Comments**: Never include comments inside JSX/TSX layout blocks.
6. **Self-Documenting Code**: Avoid adding code comments unless absolutely necessary. Write clear, expressive, and self-documenting variable/function names.

---

## 🎨 Visual Design Guidelines (Carbon Core)

Every interface modification or new feature must match our premium dashboard design. Before doing any UI work, review [DESIGN.md](file:///root/race-render-web/DESIGN.md).

### 🌟 Key Styling Directives:

- **Backgrounds**: Deep, rich dark base (`bg-zinc-950`).
- **Cards/Panels**: Carbon Glass aesthetic (`bg-zinc-900/80 backdrop-blur-md`).
- **Accent Colors**:
  - `rose-500` for redlines, high warnings, and speed hot zones.
  - `cyan-400` for active path tracers, current sync markers, and active vectors.
- **Micro-animations**: Make transitions fluid. Speedometers, sliders, and buttons should react dynamically to hover and active states.
- **Typography**: Clean sans-serif (`Inter` or `Geist`) for settings, and `monospace` / `Orbitron` style for fast-updating telemetry numbers to avoid layout shifts.

---

## 🚀 Step-by-Step Development Process

### 1. Set Up Your Environment

Ensure you have Node.js (v20+ recommended) and `pnpm` installed on your machine.

```bash
# Clone the repository
git clone git@github.com:agusmoles/race-render-web.git
cd race-render-web

# Install dependencies
pnpm install

# Start the dev server
pnpm dev
```

### 2. Create a Feature Branch

Use descriptive branch names:

```bash
git checkout -b feature/cool-new-gauge
# or
git checkout -b bugfix/trimmer-seek-issue
```

### 3. Verification & Linting

Before opening a pull request, verify that the application compiles without warnings and the linter passes successfully:

```bash
# Run lint check
pnpm lint

# Test the build locally
pnpm build
```

### 4. Open a Pull Request (PR)

When submitting a PR, make sure to:

- Explain what problem the changes solve.
- Include screenshots or visual walkthroughs for any UI modifications.
- Ensure the branch is fully rebased onto `main`.

---

Thank you for making our racing tools stronger and faster! 🏎️💨
