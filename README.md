# Race Render Web

A high-performance, browser-based telemetry overlay tool designed to synchronize CSV telemetry data with POV/GoPro footage. Running entirely client-side, it allows you to visualize and export professional motorsport HUD overlays without relying on heavy desktop software or server-side rendering.

## Features

- **Client-Side Rendering:** Uses HTML5 Canvas and `MediaRecorder` for 60FPS, high-quality video exports directly from your browser.
- **Customizable HUD:** Drag, drop, and resize widgets via an intuitive Edit Layout mode.
- **Real-time Synchronization:** Built-in Sync Wizard with offset scaling to perfectly align your telemetry data with the video footage.
- **Dynamic Gauges:**
  - ⏱️ **Lap Timer:** Tracks current, best, and last lap times automatically from CSV.
  - 🏎️ **Speedometer & RPM:** Smooth interpolation for buttery visual feedback.
  - 🛰️ **Track Map:** Auto-generated GPS track maps showing current position.
  - ⭕ **G-Force Radar:** Visualizes longitudinal and lateral acceleration.
- **Trim & Export:** Crop your favorite laps and render them into standalone, duration-fixed `.webm` files that are fully seekable in VLC and other media players.

## Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) (App Router, React 19)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/)
- **Icons:** [Lucide React](https://lucide.dev/)
- **Video Export:** Canvas API, Web Audio API, and native `MediaRecorder` with `fix-webm-duration` for metadata-compliant WebM files.

## Getting Started

### Prerequisites

Ensure you have [pnpm](https://pnpm.io/) and Node.js installed.

### Installation

1. Clone the repository:

   ```bash
   git clone git@github.com:agusmoles/race-render-web.git
   cd race-render-web
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Start the development server:

   ```bash
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## How to Use

1. **Upload Video:** Click "Upload Video" to load your GoPro or POV footage. Multiple video files can be queued.
2. **Upload Telemetry:** Load your corresponding `.csv` telemetry file (supports latitude, longitude, speed, rpm, lap time markers, and g-forces).
3. **Synchronize:** Click the `Sync Wizard` button. Find a specific corner or event in your video, select the corresponding moment in the telemetry data, and apply the sync offset.
4. **Edit HUD:** Toggle the `Edit Layout` mode to reposition or resize your gauges across the screen.
5. **Trim & Export:** Click `Export Overlay Video` to trim the exact section of footage you want to save, and render it with the overlaid HUD in real-time right from your browser.
