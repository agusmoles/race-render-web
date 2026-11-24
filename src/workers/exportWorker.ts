import {
  Input,
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  StreamTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  CanvasSink,
  BlobSource,
  ALL_FORMATS,
  QUALITY_VERY_HIGH,
  getFirstEncodableVideoCodec,
  EncodedPacket,
  type StreamTargetChunk,
  type Target,
  type Quality,
} from "mediabunny";
import {
  buildTrackPath,
  drawCanvasHUD,
  type GPSPoint,
  type TelemetryPoint,
  type TrackMapProps,
  type HUDLayoutConfig,
} from "../utils/hud-draw";
import type { ReferenceLapTarget } from "../utils/telemetry-compare";

interface TelemetryRow {
  time: number;
  speed: number;
  rpm: number;
  latAcc: number;
  lonAcc: number;
  lat: number;
  lon: number;
  lap: number;
  distance: number;
}

interface WorkerInitPayload {
  videoFiles: File[];
  telemetryRows: TelemetryRow[];
  layoutConfig: HUDLayoutConfig;
  lapTimesStarts: Record<number, number>;
  lapTimesLaps: Record<number, number>;
  lapTimesStartDistances: Record<number, number>;
  lapTimesDistances: Record<number, number>;
  bestLapNum: number;
  bestLapRows: TelemetryRow[];
  gpsPoints: GPSPoint[];
  startFinishCoord: GPSPoint | null;
  maxSpeed: number;
  maxRpm: number;
  telemetryLaps: number[];
  syncOffset: number;
  speedScale: number;
  exportStart: number;
  exportEnd: number;
  canvasWidth: number;
  canvasHeight: number;
  videoDurations: number[];
  targetBitrate: number;
  writableStream?: WritableStream<StreamTargetChunk>;
  referenceLap?: ReferenceLapTarget | null;
  showGhostOnMap?: boolean;
}

const GOOGLE_FONTS_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Orbitron:wght@450;700;900&family=Inter:wght@350;500;700;900&display=swap";

let fontsLoadPromise: Promise<void> | null = null;
let cancelled = false;

async function ensureWorkerFonts(): Promise<void> {
  if (!("fonts" in self) || typeof FontFace === "undefined") return;
  if (fontsLoadPromise) return fontsLoadPromise;

  fontsLoadPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(GOOGLE_FONTS_CSS_URL, { signal: controller.signal });
      if (!res.ok) return;
      const css = await res.text();
      const blocks = css.match(/@font-face\s*\{[^}]+\}/g);
      if (!blocks) return;

      const workerFonts = (self as unknown as { fonts: FontFaceSet }).fonts;
      const faces: FontFace[] = [];

      for (const block of blocks) {
        const familyMatch = block.match(/font-family:\s*['"]?([^'";]+)['"]?/i);
        const weightMatch = block.match(/font-weight:\s*([^;]+)/i);
        const urlMatch = block.match(/src:\s*url\(([^)]+)\)/i);
        const rangeMatch = block.match(/unicode-range:\s*([^;]+)/i);

        if (!familyMatch || !urlMatch) continue;
        const family = familyMatch[1].trim();
        const url = urlMatch[1].trim().replace(/^['"]|['"]$/g, "");
        const descriptors: FontFaceDescriptors = {};
        if (weightMatch) descriptors.weight = weightMatch[1].trim();
        if (rangeMatch) descriptors.unicodeRange = rangeMatch[1].trim();

        faces.push(new FontFace(family, `url(${url})`, descriptors));
      }

      const settled = await Promise.allSettled(faces.map((face) => face.load()));
      for (const result of settled) {
        if (result.status === "fulfilled") {
          workerFonts.add(result.value);
        }
      }
    } catch {
      // Ignore network/offline errors and fall back to system fonts
    } finally {
      clearTimeout(timer);
    }
  })();

  return fontsLoadPromise;
}

function formatLapTime(secs: number): string {
  if (isNaN(secs) || secs <= 0) return "0:00.00";
  const mins = Math.floor(secs / 60);
  const remainingSecs = Math.floor(secs % 60);
  const centiseconds = Math.floor((secs % 1) * 100);
  return `${mins}:${remainingSecs.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

function interpolateTelemetry(rows: TelemetryRow[], telemetryTime: number): TelemetryPoint {
  const empty: TelemetryPoint = {
    time: 0,
    speed: 0,
    rpm: 0,
    latAcc: 0,
    lonAcc: 0,
    lat: 0,
    lon: 0,
    lap: 1,
    distance: 0,
  };
  if (rows.length === 0) return empty;

  let low = 0;
  let high = rows.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].time === telemetryTime) {
      const m = rows[mid];
      return {
        time: m.time,
        speed: m.speed,
        rpm: m.rpm,
        latAcc: m.latAcc,
        lonAcc: m.lonAcc,
        lat: m.lat,
        lon: m.lon,
        lap: Number.isFinite(m.lap) ? m.lap : 1,
        distance: m.distance || 0,
      };
    } else if (rows[mid].time < telemetryTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const idxB = Math.min(low, rows.length - 1);
  const idxA = Math.max(0, idxB - 1);
  const rA = rows[idxA];
  const rB = rows[idxB];

  if (!rA || !rB || rB.time === rA.time) {
    return {
      time: rA?.time ?? 0,
      speed: rA?.speed ?? 0,
      rpm: rA?.rpm ?? 0,
      latAcc: rA?.latAcc ?? 0,
      lonAcc: rA?.lonAcc ?? 0,
      lat: rA?.lat ?? 0,
      lon: rA?.lon ?? 0,
      lap: Number.isFinite(rA?.lap) ? rA.lap : 1,
      distance: rA?.distance ?? 0,
    };
  }

  const frac = Math.max(0, Math.min(1, (telemetryTime - rA.time) / (rB.time - rA.time)));
  const lapRow =
    low >= rows.length ||
    (rB.time - telemetryTime <= 1e-4 && telemetryTime >= rA.time)
      ? rB
      : rA;
  return {
    time: rA.time + frac * (rB.time - rA.time),
    speed: rA.speed + frac * (rB.speed - rA.speed),
    rpm: rA.rpm + frac * (rB.rpm - rA.rpm),
    latAcc: rA.latAcc + frac * (rB.latAcc - rA.latAcc),
    lonAcc: rA.lonAcc + frac * (rB.lonAcc - rA.lonAcc),
    lat: rA.lat + frac * (rB.lat - rA.lat),
    lon: rA.lon + frac * (rB.lon - rA.lon),
    lap: Number.isFinite(lapRow.lap) ? lapRow.lap : 1,
    distance: rA.distance + frac * (rB.distance - rA.distance),
  };
}

function disposeInputs(inputs: Input[]) {
  for (const input of inputs) {
    if (Symbol.dispose in input) {
      (input as Disposable)[Symbol.dispose]();
    }
  }
}

async function run(payload: WorkerInitPayload) {
  cancelled = false;
  await ensureWorkerFonts();

  const {
    videoFiles,
    telemetryRows,
    layoutConfig,
    lapTimesStarts,
    lapTimesLaps,
    lapTimesStartDistances,
    lapTimesDistances,
    bestLapNum,
    bestLapRows,
    gpsPoints,
    startFinishCoord,
    maxSpeed,
    maxRpm,
    telemetryLaps,
    syncOffset,
    speedScale,
    exportStart,
    exportEnd,
    canvasWidth,
    canvasHeight,
    videoDurations,
    targetBitrate,
    writableStream,
    referenceLap,
    showGhostOnMap,
  } = payload;

  const trackSourcePoints =
    gpsPoints.length > 0 ? gpsPoints : telemetryRows.map((r) => ({ lat: r.lat, lon: r.lon }));
  const trackMapBase = buildTrackPath(trackSourcePoints);
  const totalExportDuration = Math.max(0.001, exportEnd - exportStart);

  const evenWidth = Math.max(2, Math.floor(canvasWidth / 2) * 2);
  const evenHeight = Math.max(2, Math.floor(canvasHeight / 2) * 2);
  const pixelScale = Math.max(1, (evenWidth * evenHeight) / (1920 * 1080));
  const scaledBitrate = Math.min(120_000_000, Math.round((targetBitrate || 30_000_000) * pixelScale));

  const offscreen = new OffscreenCanvas(evenWidth, evenHeight);
  const ctx = offscreen.getContext("2d")!;

  const previewW = 640;
  const previewH = 360;
  const previewCanvas = new OffscreenCanvas(previewW, previewH);
  const previewCtx = previewCanvas.getContext("2d")!;
  const previewScale = Math.min(previewW / evenWidth, previewH / evenHeight);
  const previewDrawW = Math.round(evenWidth * previewScale);
  const previewDrawH = Math.round(evenHeight * previewScale);
  const previewDrawX = Math.round((previewW - previewDrawW) / 2);
  const previewDrawY = Math.round((previewH - previewDrawH) / 2);

  let videoCodec = await getFirstEncodableVideoCodec(["avc", "vp9", "vp8"], {
    width: evenWidth,
    height: evenHeight,
    bitrate: scaledBitrate,
  });
  let effectiveBitrate: number | Quality = scaledBitrate;

  if (!videoCodec) {
    videoCodec = await getFirstEncodableVideoCodec(["avc", "vp9", "vp8"]);
    effectiveBitrate = QUALITY_VERY_HIGH;
  }

  if (!videoCodec) {
    self.postMessage({
      type: "error",
      message: "No hardware-accelerated video codec found. Your browser may not support WebCodecs.",
    });
    return;
  }

  const usesMp4 = videoCodec === "avc";
  const outputFormat = usesMp4 ? new Mp4OutputFormat() : new WebMOutputFormat();
  const target: Target = writableStream
    ? new StreamTarget(writableStream, { chunked: true })
    : new BufferTarget();

  const output = new Output({ format: outputFormat, target });

  const canvasSource = new CanvasSource(offscreen, {
    codec: videoCodec,
    bitrate: effectiveBitrate,
    keyFrameInterval: 2,
    latencyMode: "quality",
  });
  output.addVideoTrack(canvasSource);

  const inputs: Input[] = videoFiles.map(
    (blob) => new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }),
  );

  let audioSource: EncodedAudioPacketSource | null = null;
  let audioCodecName: string | null = null;
  const supportedAudioCodecs = outputFormat.getSupportedAudioCodecs();

  if (inputs.length > 0) {
    const firstAudioTrack = await inputs[0].getPrimaryAudioTrack();
    if (firstAudioTrack) {
      const firstAudioCodec = await firstAudioTrack.getCodec();
      if (firstAudioCodec && supportedAudioCodecs.includes(firstAudioCodec)) {
        audioCodecName = firstAudioCodec;
        audioSource = new EncodedAudioPacketSource(firstAudioCodec);
        output.addAudioTrack(audioSource);
      }
    }
  }

  await output.start();

  const bestLapTimeStr = formatLapTime(lapTimesLaps[bestLapNum] || 0);
  const bestLapRowsTyped = bestLapRows as TelemetryPoint[];

  let globalFrameIndex = 0;
  let cumulativeVideoOffset = 0;
  const gHistory: { x: number; y: number }[] = [];
  let lastVideoOutTs = -1;
  let clipAudioMinTs = 0;
  let lastAudioEndTs = 0;
  let isFirstAudioChunk = true;
  let lastPercent = -1;

  for (let vi = 0; vi < inputs.length; vi++) {
    if (cancelled) {
      await output.cancel();
      disposeInputs(inputs);
      return;
    }

    const input = inputs[vi];
    const videoDuration = videoDurations[vi] ?? 0;
    const videoStartInGlobal = cumulativeVideoOffset;
    const videoTrack = await input.getPrimaryVideoTrack();

    if (!videoTrack) {
      cumulativeVideoOffset += videoDuration;
      continue;
    }

    const clipStart = Math.max(0, exportStart - videoStartInGlobal);
    const clipEnd = Math.min(videoDuration, exportEnd - videoStartInGlobal);

    if (clipEnd <= clipStart) {
      cumulativeVideoOffset += videoDuration;
      continue;
    }

    const canvasSink = new CanvasSink(videoTrack, {
      poolSize: 2,
      width: evenWidth,
      height: evenHeight,
      fit: "cover",
    });

    let audioPacketSink: EncodedPacketSink | null = null;
    let nextAudioPacket: EncodedPacket | null = null;
    let audioDecoderConfig: AudioDecoderConfig | null = null;

    if (audioSource && audioCodecName) {
      const audioTrack = await input.getPrimaryAudioTrack();
      if (audioTrack && (await audioTrack.getCodec()) === audioCodecName) {
        audioPacketSink = new EncodedPacketSink(audioTrack);
        nextAudioPacket = await audioPacketSink.getPacket(clipStart);
        if (!nextAudioPacket) {
          nextAudioPacket = await audioPacketSink.getFirstPacket();
        }
        audioDecoderConfig = await audioTrack.getDecoderConfig();
      }
    }

    const flushAudioPacket = async (pkt: EncodedPacket) => {
      if (!audioSource) return;
      const globalAudioTs = videoStartInGlobal + pkt.timestamp;
      const exportRelativeAudioTs = globalAudioTs - exportStart;
      const safeAudioTs = Math.max(clipAudioMinTs, exportRelativeAudioTs);
      clipAudioMinTs = safeAudioTs + 1e-6;
      lastAudioEndTs = Math.max(lastAudioEndTs, safeAudioTs + Math.max(0, pkt.duration || 0));

      const adjustedPacket = pkt.clone({ timestamp: safeAudioTs });
      if (isFirstAudioChunk) {
        await audioSource.add(adjustedPacket, { decoderConfig: audioDecoderConfig || undefined });
        isFirstAudioChunk = false;
      } else {
        await audioSource.add(adjustedPacket);
      }
    };

    for await (const wrappedCanvas of canvasSink.canvases(clipStart, clipEnd)) {
      if (cancelled) {
        await output.cancel();
        disposeInputs(inputs);
        return;
      }

      const localFrameTs = wrappedCanvas.timestamp;
      if (localFrameTs < clipStart) {
        continue;
      }

      const globalVideoTs = videoStartInGlobal + localFrameTs;
      const rawExportRelativeTs = globalVideoTs - exportStart;
      const exportRelativeTs =
        lastVideoOutTs < 0
          ? Math.max(0, rawExportRelativeTs)
          : Math.max(lastVideoOutTs + 1e-6, rawExportRelativeTs);
      lastVideoOutTs = exportRelativeTs;

      ctx.clearRect(0, 0, evenWidth, evenHeight);
      ctx.drawImage(wrappedCanvas.canvas, 0, 0, evenWidth, evenHeight);

      const telemetryTime = (globalVideoTs - syncOffset) * speedScale;
      const tel = interpolateTelemetry(telemetryRows, telemetryTime);

      if (
        gHistory.length === 0 ||
        gHistory[gHistory.length - 1].x !== tel.latAcc ||
        gHistory[gHistory.length - 1].y !== tel.lonAcc
      ) {
        gHistory.push({ x: tel.latAcc, y: tel.lonAcc });
        if (gHistory.length > 6) gHistory.shift();
      }

      const trackMapProps: TrackMapProps = {
        ...trackMapBase,
        telemetryTime,
        lapTimesStarts,
        lapTimesLaps,
        lapTimesStartDistances,
        lapTimesDistances,
        formatLapTime,
        bestLapTimeStr,
        bestLapNum,
        bestLapRows: bestLapRowsTyped,
        startFinishCoord,
        maxSpeed,
        maxRpm,
        telemetryLaps,
        referenceLap,
        showGhostOnMap,
      };

      drawCanvasHUD(ctx, evenWidth, evenHeight, tel, gHistory, trackMapProps, layoutConfig);

      const frameDuration = wrappedCanvas.duration ?? 1 / 60;

      if (audioSource && audioPacketSink && nextAudioPacket) {
        while (
          nextAudioPacket &&
          nextAudioPacket.timestamp <= localFrameTs &&
          nextAudioPacket.timestamp <= clipEnd
        ) {
          await flushAudioPacket(nextAudioPacket);
          nextAudioPacket = await audioPacketSink.getNextPacket(nextAudioPacket);
        }
      }

      await canvasSource.add(exportRelativeTs, frameDuration);

      const percent = Math.round(
        Math.min(100, Math.max(0, (exportRelativeTs / totalExportDuration) * 100)),
      );

      if (globalFrameIndex % 15 === 0) {
        previewCtx.clearRect(0, 0, previewW, previewH);
        previewCtx.drawImage(offscreen, previewDrawX, previewDrawY, previewDrawW, previewDrawH);
        const previewBitmap = previewCanvas.transferToImageBitmap();
        self.postMessage(
          { type: "progress", percent, previewBitmap },
          { transfer: [previewBitmap] },
        );
        lastPercent = percent;
      } else if (percent !== lastPercent) {
        self.postMessage({ type: "progress", percent });
        lastPercent = percent;
      }

      globalFrameIndex++;
    }

    if (audioSource && audioPacketSink && nextAudioPacket) {
      while (nextAudioPacket && nextAudioPacket.timestamp <= clipEnd) {
        await flushAudioPacket(nextAudioPacket);
        nextAudioPacket = await audioPacketSink.getNextPacket(nextAudioPacket);
      }
    }

    clipAudioMinTs = Math.max(clipAudioMinTs, lastAudioEndTs);
    cumulativeVideoOffset += videoDuration;
  }

  if (cancelled) {
    await output.cancel();
    disposeInputs(inputs);
    return;
  }

  await output.finalize();
  disposeInputs(inputs);

  const mimeType = usesMp4 ? "video/mp4" : "video/webm";
  const fileExt = usesMp4 ? "mp4" : "webm";

  if (target instanceof BufferTarget) {
    const { buffer } = target;
    if (!buffer) {
      self.postMessage({
        type: "error",
        message: "Export buffer is empty. Something went wrong during encoding.",
      });
      return;
    }
    self.postMessage({ type: "done", buffer, mimeType, fileExt }, { transfer: [buffer] });
  } else {
    self.postMessage({ type: "done", mimeType, fileExt });
  }
}

self.onmessage = (e: MessageEvent) => {
  if (e.data?.type === "cancel") {
    cancelled = true;
    return;
  }
  if (e.data?.type === "init") {
    run(e.data.payload as WorkerInitPayload).catch((err) => {
      if (!cancelled) {
        self.postMessage({ type: "error", message: String(err) });
      }
    });
  }
};
