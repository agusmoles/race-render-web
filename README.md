# Open RaceRender Web

A free, open-source, browser-based motorsport telemetry studio for synchronizing CSV telemetry data with POV/GoPro racing footage and comparing laps in 3D. Everything runs 100% client-side in your browser — no desktop software to install and your footage never leaves your device.

👉 **Start using it right now at [openracerender.com](https://openracerender.com/)**

## Example Render

Watch an example HUD render created with Open RaceRender Web: [YouTube Example Render](https://youtu.be/5IOPWy-HYgY?t=1336)

## Features

### POV Video HUD Studio

- **100% Client-Side & Private:** Videos and CSV files are processed locally using WebCodecs, WebGL2, and Canvas — nothing is uploaded to a server.
- **Automatic GoPro GPMF Sync:** Automatically aligns GoPro video with AiM RaceStudio (RS2/RS3) CSV telemetry using embedded GPMF GPS speed, gyro, and accelerometer signals, with clock-drift refinement and saved per-session sync settings.
- **Interactive Sync Wizard:** Fine-tune offset and speed scale visually when working with non-GoPro cameras or manual alignments.
- **Multi-Clip Timeline:** Queue multiple GoPro chapter files into a single seamless timeline with keyboard playback shortcuts (`Space`, `←`/`→`, `Shift+←`/`→`, `,`/`.`).
- **Customizable Carbon Core HUD:** Drag, resize, scale, and persist your preferred layout across sessions:
  - **Speedometer & RPM Bar** with shift lights
  - **Lap Timer** (current, best, and last lap)
  - **Delta Bar & Lap/Racer Comparison** against your best lap, another lap, or another driver's CSV — complete with a live ghost dot on the track map
  - **GPS Track Map** auto-generated from latitude/longitude telemetry
  - **G-Force Radar** displaying lateral and longitudinal acceleration
- **Flexible Video Export:**
  - Lap-based trimming and custom range selection
  - Full composite exports (MP4 / WebM) with quality presets up to original source bitrate
  - Transparent alpha overlay exports (VP9 WebM) ready to drop into external video editors
  - Stop-and-save support for keeping partial renders

### 3D Lap Compare

- **Multi-Session 3D Comparison:** Open [openracerender.com/compare](https://openracerender.com/compare) to load multiple AiM RaceStudio CSV files and compare racing lines, speeds, and time deltas in an interactive 3D Three.js track viewer with synchronized telemetry charts.

## How to Use

1. Open **[openracerender.com](https://openracerender.com/)** in a modern desktop browser (Chrome or Edge recommended for hardware-accelerated WebCodecs export).
2. **Load Video & Telemetry:** Drop in your POV/GoPro video file(s) and your AiM RaceStudio `.csv` export.
3. **Sync:** GoPro footage with GPMF data auto-syncs automatically, or open the **Sync Wizard** to align manually.
4. **Customize & Compare:** Adjust gauge positions and scales in **Edit Layout**, and optionally add extra CSV sessions to compare laps or race against a ghost.
5. **Trim & Export:** Pick the laps or time range you want and render directly to your computer.

## Contributing

Open RaceRender Web is open source and contributions are welcome — bug reports, feature ideas, new telemetry format parsers, HUD widgets, and pull requests are all appreciated!

- **Repository:** [github.com/agusmoles/race-render-web](https://github.com/agusmoles/race-render-web)
- **Local Development & Contribution Rules:** See [CONTRIBUTING.md](./CONTRIBUTING.md)

## Credits

Created by **[Agustín Molés](https://agustinmoles.com.ar)**.
