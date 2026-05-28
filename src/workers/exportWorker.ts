import {
  Input,
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  CanvasSink,
  BlobSource,
  ALL_FORMATS,
  QUALITY_HIGH,
  getFirstEncodableVideoCodec,
  EncodedPacket,
} from "mediabunny";
import { drawCanvasHUD, type TelemetryPoint, type TrackMapProps, type HUDLayoutConfig } from "../utils/hud-draw";

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
  syncOffset: number;
  speedScale: number;
  exportStart: number;
  exportEnd: number;
  canvasWidth: number;
  canvasHeight: number;
  videoDurations: number[];
}

function formatLapTime(secs: number): string {
  if (isNaN(secs) || secs <= 0) return "0:00.00";
  const mins = Math.floor(secs / 60);
  const remainingSecs = Math.floor(secs % 60);
  const centiseconds = Math.floor((secs % 1) * 100);
  return `${mins}:${remainingSecs.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

function interpolateTelemetry(rows: TelemetryRow[], telemetryTime: number): TelemetryPoint & { time: number } {
  const empty = { time: 0, speed: 0, rpm: 0, latAcc: 0, lonAcc: 0, lat: 0, lon: 0, lap: 1, distance: 0 };
  if (rows.length === 0) return empty;

  let low = 0;
  let high = rows.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].time === telemetryTime) {
      const m = rows[mid];
      return { time: m.time, speed: m.speed, rpm: m.rpm, latAcc: m.latAcc, lonAcc: m.lonAcc, lat: m.lat, lon: m.lon, lap: m.lap || 1, distance: m.distance || 0 };
    } else if (rows[mid].time < telemetryTime) low = mid + 1;
    else high = mid - 1;
  }

  const idxB = Math.min(low, rows.length - 1);
  const idxA = Math.max(0, idxB - 1);
  const rA = rows[idxA];
  const rB = rows[idxB];

  if (!rA || !rB || rB.time === rA.time) {
    return { time: rA?.time ?? 0, speed: rA?.speed ?? 0, rpm: rA?.rpm ?? 0, latAcc: rA?.latAcc ?? 0, lonAcc: rA?.lonAcc ?? 0, lat: rA?.lat ?? 0, lon: rA?.lon ?? 0, lap: rA?.lap || 1, distance: rA?.distance ?? 0 };
  }

  const frac = Math.max(0, Math.min(1, (telemetryTime - rA.time) / (rB.time - rA.time)));
  return {
    time: rA.time + frac * (rB.time - rA.time),
    speed: rA.speed + frac * (rB.speed - rA.speed),
    rpm: rA.rpm + frac * (rB.rpm - rA.rpm),
    latAcc: rA.latAcc + frac * (rB.latAcc - rA.latAcc),
    lonAcc: rA.lonAcc + frac * (rB.lonAcc - rA.lonAcc),
    lat: rA.lat + frac * (rB.lat - rA.lat),
    lon: rA.lon + frac * (rB.lon - rA.lon),
    lap: rA.lap || 1,
    distance: rA.distance + frac * (rB.distance - rA.distance),
  };
}

function buildTrackPath(rows: TelemetryRow[]): {
  cachedPath2D: Path2D | null;
  trackScale: number;
  trackMinLon: number;
  trackMaxLat: number;
  trackHasGPS: boolean;
  tSvgW: number;
  tSvgH: number;
  tPadding: number;
  trackLonSpan: number;
  trackLatSpan: number;
} {
  const tPadding = 20;
  const tSvgW = 200;
  const tSvgH = 200;

  const validPoints = rows.filter((p) => p.lat !== 0 && p.lon !== 0);
  if (validPoints.length <= 5) {
    return { cachedPath2D: null, trackScale: 1, trackMinLon: 0, trackMaxLat: 0, trackHasGPS: false, tSvgW, tSvgH, tPadding, trackLonSpan: 0, trackLatSpan: 0 };
  }

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of validPoints) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  const trackLatSpan = maxLat - minLat;
  const trackLonSpan = maxLon - minLon;

  if (trackLatSpan <= 0 || trackLonSpan <= 0) {
    return { cachedPath2D: null, trackScale: 1, trackMinLon: 0, trackMaxLat: 0, trackHasGPS: false, tSvgW, tSvgH, tPadding, trackLonSpan, trackLatSpan };
  }

  const scaleX = (tSvgW - tPadding * 2) / trackLonSpan;
  const scaleY = (tSvgH - tPadding * 2) / trackLatSpan;
  const trackScale = Math.min(scaleX, scaleY);

  let trackPath = "";
  validPoints.forEach((p, idx) => {
    const x = tPadding + (p.lon - minLon) * trackScale + (tSvgW - tPadding * 2 - trackLonSpan * trackScale) / 2;
    const y = tPadding + (maxLat - p.lat) * trackScale + (tSvgH - tPadding * 2 - trackLatSpan * trackScale) / 2;
    if (idx === 0) trackPath += `M ${x.toFixed(2)} ${y.toFixed(2)}`;
    else trackPath += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  trackPath += " Z";

  return {
    cachedPath2D: new Path2D(trackPath),
    trackScale,
    trackMinLon: minLon,
    trackMaxLat: maxLat,
    trackHasGPS: true,
    tSvgW,
    tSvgH,
    tPadding,
    trackLonSpan,
    trackLatSpan,
  };
}

async function run(payload: WorkerInitPayload) {
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
    syncOffset,
    speedScale,
    exportStart,
    exportEnd,
    canvasWidth,
    canvasHeight,
    videoDurations,
  } = payload;

  const trackMapBase = buildTrackPath(telemetryRows);
  const totalExportDuration = exportEnd - exportStart;

  const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = offscreen.getContext("2d")!;

  const videoCodec = await getFirstEncodableVideoCodec(["avc", "vp9", "vp8"]);

  if (!videoCodec) {
    self.postMessage({ type: "error", message: "No hardware-accelerated video codec found. Your browser may not support WebCodecs." });
    return;
  }

  const usesMp4 = videoCodec === "avc";
  const outputFormat = usesMp4 ? new Mp4OutputFormat() : new WebMOutputFormat();
  const bufferTarget = new BufferTarget();

  const output = new Output({ format: outputFormat, target: bufferTarget });

  const canvasSource = new CanvasSource(offscreen, {
    codec: videoCodec,
    bitrate: QUALITY_HIGH,
  });
  output.addVideoTrack(canvasSource, { frameRate: 60 });

  const inputs: Input[] = [];
  for (let vi = 0; vi < videoFiles.length; vi++) {
    const blob = videoFiles[vi];
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    inputs.push(input);
  }

  let audioSource: EncodedAudioPacketSource | null = null;
  if (videoFiles.length > 0) {
    const firstAudioTrack = await inputs[0].getPrimaryAudioTrack();
    if (firstAudioTrack) {
      const firstAudioCodec = await firstAudioTrack.getCodec() as "aac" | "opus" | "mp3";
      audioSource = new EncodedAudioPacketSource(firstAudioCodec);
      output.addAudioTrack(audioSource);
    }
  }

  await output.start();

  let globalFrameIndex = 0;
  let cumulativeVideoOffset = 0;
  let gHistory: { x: number; y: number }[] = [];
  let audioTimestampOffset = 0;
  let isFirstAudioChunk = true;

  for (let vi = 0; vi < inputs.length; vi++) {
    const input = inputs[vi];
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      cumulativeVideoOffset += videoDurations[vi];
      continue;
    }

    const videoDuration = videoDurations[vi];
    const videoStartInGlobal = cumulativeVideoOffset;

    const clipStart = Math.max(0, exportStart - videoStartInGlobal);
    const clipEnd = Math.min(videoDuration, exportEnd - videoStartInGlobal);

    if (clipEnd <= clipStart) {
      cumulativeVideoOffset += videoDuration;
      continue;
    }

    const canvasSink = new CanvasSink(videoTrack);
    
    let audioPacketSink: EncodedPacketSink | null = null;
    let nextAudioPacket: EncodedPacket | null = null;
    let audioDecoderConfig: AudioDecoderConfig | null = null;

    if (audioSource) {
      const audioTrack = await input.getPrimaryAudioTrack();
      if (audioTrack) {
        audioPacketSink = new EncodedPacketSink(audioTrack);
        nextAudioPacket = await audioPacketSink.getPacket(clipStart);
        audioDecoderConfig = await audioTrack.getDecoderConfig();
      }
    }

    for await (const wrappedCanvas of canvasSink.canvases(clipStart, clipEnd)) {
      const localFrameTs = wrappedCanvas.timestamp;
      if (localFrameTs < clipStart) {
        continue; // Skip pre-roll frames! They ruin sync.
      }
      const exportRelativeTs = videoStartInGlobal + localFrameTs - clipStart;
      const globalVideoTs = exportRelativeTs + exportStart;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      ctx.drawImage(wrappedCanvas.canvas, 0, 0, canvasWidth, canvasHeight);

      const telemetryTime = (globalVideoTs - syncOffset) * speedScale;
      const tel = interpolateTelemetry(telemetryRows, telemetryTime);

      if (gHistory.length === 0 || gHistory[gHistory.length - 1].x !== tel.latAcc || gHistory[gHistory.length - 1].y !== tel.lonAcc) {
        gHistory.push({ x: tel.latAcc, y: tel.lonAcc });
        if (gHistory.length > 6) gHistory.shift();
      }

      const bestLapRowsAsTelemetryPoints: (TelemetryPoint & { time: number })[] = bestLapRows as (TelemetryPoint & { time: number })[];

      const trackMapProps: TrackMapProps = {
        ...trackMapBase,
        telemetryTime,
        lapTimesStarts,
        lapTimesLaps,
        lapTimesStartDistances,
        lapTimesDistances,
        formatLapTime,
        bestLapTimeStr: formatLapTime(lapTimesLaps[bestLapNum] || 0),
        bestLapNum,
        bestLapRows: bestLapRowsAsTelemetryPoints,
      };

      drawCanvasHUD(ctx, canvasWidth, canvasHeight, tel, gHistory, trackMapProps, layoutConfig);

      const frameDuration = wrappedCanvas.duration ?? (1 / 60);

      // Pump audio up to this video frame
      if (audioSource && audioPacketSink && nextAudioPacket) {
        while (nextAudioPacket && nextAudioPacket.timestamp <= localFrameTs && nextAudioPacket.timestamp <= clipEnd) {
          const exportRelativeAudioTs = videoStartInGlobal + nextAudioPacket.timestamp - clipStart;
          if (exportRelativeAudioTs >= 0) {
            const adjustedPacket = nextAudioPacket.clone({ timestamp: Math.max(0, exportRelativeAudioTs + audioTimestampOffset) });
            if (isFirstAudioChunk) {
              await audioSource.add(adjustedPacket, { decoderConfig: audioDecoderConfig || undefined });
              isFirstAudioChunk = false;
            } else {
              await audioSource.add(adjustedPacket);
            }
          }
          nextAudioPacket = await audioPacketSink.getNextPacket(nextAudioPacket);
        }
      }

      await canvasSource.add(exportRelativeTs, frameDuration);

      const percent = Math.round(Math.min(100, Math.max(0, (exportRelativeTs / totalExportDuration) * 100)));
      self.postMessage({ type: "progress", percent });

      globalFrameIndex++;
    }

    // Pump any remaining audio for this clip
    if (audioSource && audioPacketSink && nextAudioPacket) {
      while (nextAudioPacket && nextAudioPacket.timestamp <= clipEnd) {
        const exportRelativeAudioTs = videoStartInGlobal + nextAudioPacket.timestamp - clipStart;
        if (exportRelativeAudioTs >= 0) {
          const adjustedPacket = nextAudioPacket.clone({ timestamp: Math.max(0, exportRelativeAudioTs + audioTimestampOffset) });
          if (isFirstAudioChunk) {
            await audioSource.add(adjustedPacket, { decoderConfig: audioDecoderConfig || undefined });
            isFirstAudioChunk = false;
          } else {
            await audioSource.add(adjustedPacket);
          }
        }
        nextAudioPacket = await audioPacketSink.getNextPacket(nextAudioPacket);
      }
    }

    cumulativeVideoOffset += videoDuration;
    audioTimestampOffset += clipEnd - clipStart;
  }

  await output.finalize();

  for (const input of inputs) {
    if (Symbol.dispose in input) {
      (input as Disposable)[Symbol.dispose]();
    }
  }

  const { buffer } = bufferTarget;
  if (!buffer) {
    self.postMessage({ type: "error", message: "Export buffer is empty. Something went wrong during encoding." });
    return;
  }

  const mimeType = usesMp4 ? "video/mp4" : "video/webm";
  const fileExt = usesMp4 ? "mp4" : "webm";
  self.postMessage({ type: "done", buffer, mimeType, fileExt }, { transfer: [buffer] });
}

self.onmessage = (e: MessageEvent) => {
  if (e.data?.type === "init") {
    run(e.data.payload as WorkerInitPayload).catch((err) => {
      self.postMessage({ type: "error", message: String(err) });
    });
  }
};
