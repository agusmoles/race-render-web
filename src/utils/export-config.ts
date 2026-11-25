import type { VideoCodec } from "mediabunny";

export type ExportMode = "composite" | "overlay-alpha";
export type ExportQualityPreset = "standard" | "high" | "ultra" | "original";
export type ExportContainer = "mp4" | "webm";

export interface SourceVideoProfile {
  codec: VideoCodec | null;
  bitrate: number | null;
  width: number;
  height: number;
  fps: number | null;
}

export interface ExportEncodingInfo {
  mode: ExportMode;
  quality: ExportQualityPreset;
  codec: VideoCodec;
  container: ExportContainer;
  bitrate: number | "auto";
  width: number;
  height: number;
  streamingToDisk: boolean;
  sourceBitrate: number | null;
  sourceCodec: VideoCodec | null;
}

export interface FrameTimingSample {
  timestamp: number;
  duration: number;
}

export const PRESET_BASE_BITRATES: Record<Exclude<ExportQualityPreset, "original">, number> = {
  standard: 15_000_000,
  high: 30_000_000,
  ultra: 50_000_000,
};

export const ALPHA_PRESET_BASE_BITRATES: Record<ExportQualityPreset, number> = {
  standard: 10_000_000,
  high: 20_000_000,
  ultra: 35_000_000,
  original: 35_000_000,
};

const MAX_PRESET_BITRATE = 120_000_000;
const MAX_ORIGINAL_BITRATE = 500_000_000;
const MAX_ALPHA_BITRATE = 80_000_000;
const MIN_SAFE_BITRATE = 1_000_000;
const ORIGINAL_FALLBACK_BASE_BITRATE = 80_000_000;
const HIGH_EFFICIENCY_TO_AVC_MULTIPLIER = 1.35;

export function normalizeEvenDimension(value: number, fallback: number): number {
  const safe = Number.isFinite(value) && value >= 2 ? value : fallback;
  return Math.max(2, Math.floor(safe / 2) * 2);
}

export function computePixelScale(width: number, height: number): number {
  const w = normalizeEvenDimension(width, 1920);
  const h = normalizeEvenDimension(height, 1080);
  return Math.max(1, (w * h) / (1920 * 1080));
}

export function sanitizeBitrate(bitrate: number | null | undefined, maxCap: number): number | null {
  if (typeof bitrate !== "number" || !Number.isFinite(bitrate) || bitrate <= 0) {
    return null;
  }
  return Math.round(Math.max(MIN_SAFE_BITRATE, Math.min(maxCap, bitrate)));
}

export function getContainerForCodec(codec: VideoCodec): ExportContainer {
  return codec === "avc" || codec === "hevc" || codec === "av1" ? "mp4" : "webm";
}

export function getCandidateCodecs(
  mode: ExportMode,
  quality: ExportQualityPreset,
  sourceCodec: VideoCodec | null,
  preferredContainer?: ExportContainer | null,
): VideoCodec[] {
  if (mode === "overlay-alpha") {
    return ["vp9", "vp8"];
  }

  let candidates: VideoCodec[];
  if (quality === "original") {
    if (sourceCodec === "hevc") {
      candidates = ["hevc", "avc", "vp9", "vp8"];
    } else if (sourceCodec === "av1") {
      candidates = ["av1", "hevc", "avc", "vp9", "vp8"];
    } else if (sourceCodec === "vp9") {
      candidates = ["vp9", "avc", "hevc", "vp8"];
    } else {
      candidates = ["avc", "hevc", "vp9", "vp8"];
    }
  } else {
    candidates = ["avc", "vp9", "vp8"];
  }

  if (preferredContainer === "mp4") {
    const mp4Only = candidates.filter((c) => getContainerForCodec(c) === "mp4");
    return mp4Only.length > 0 ? mp4Only : ["avc", "hevc"];
  }
  if (preferredContainer === "webm") {
    const webmOnly = candidates.filter((c) => getContainerForCodec(c) === "webm");
    return webmOnly.length > 0 ? webmOnly : ["vp9", "vp8"];
  }

  return candidates;
}

export function computeTargetBitrateForCodec(params: {
  mode: ExportMode;
  quality: ExportQualityPreset;
  targetCodec: VideoCodec;
  sourceCodec: VideoCodec | null;
  sourceBitrate: number | null;
  width: number;
  height: number;
}): number {
  const { mode, quality, targetCodec, sourceCodec, sourceBitrate, width, height } = params;
  const pixelScale = computePixelScale(width, height);

  if (mode === "overlay-alpha") {
    const base = ALPHA_PRESET_BASE_BITRATES[quality] ?? ALPHA_PRESET_BASE_BITRATES.high;
    return Math.min(MAX_ALPHA_BITRATE, Math.round(base * pixelScale));
  }

  if (quality === "original") {
    const cleanSourceBitrate = sanitizeBitrate(sourceBitrate, MAX_ORIGINAL_BITRATE);
    const baseTarget =
      cleanSourceBitrate ?? Math.round(ORIGINAL_FALLBACK_BASE_BITRATE * pixelScale);
    const needsAvcHeadroom =
      targetCodec === "avc" &&
      (sourceCodec === "hevc" || sourceCodec === "av1" || sourceCodec === "vp9");
    const adjusted = needsAvcHeadroom
      ? Math.round(baseTarget * HIGH_EFFICIENCY_TO_AVC_MULTIPLIER)
      : baseTarget;
    return Math.max(MIN_SAFE_BITRATE, Math.min(MAX_ORIGINAL_BITRATE, adjusted));
  }

  const base = PRESET_BASE_BITRATES[quality] ?? PRESET_BASE_BITRATES.high;
  return Math.min(MAX_PRESET_BITRATE, Math.round(base * pixelScale));
}

export function buildBitrateFallbackLadder(targetBitrate: number): number[] {
  const safeTarget = Math.max(
    MIN_SAFE_BITRATE,
    Math.round(Number.isFinite(targetBitrate) ? targetBitrate : PRESET_BASE_BITRATES.high),
  );
  const ladder: number[] = [safeTarget];

  for (const factor of [0.85, 0.7, 0.55]) {
    const candidate = Math.round(safeTarget * factor);
    if (candidate >= MIN_SAFE_BITRATE && candidate < ladder[ladder.length - 1]) {
      ladder.push(candidate);
    }
  }

  for (const floor of [120_000_000, 80_000_000, 50_000_000, 25_000_000]) {
    if (floor < ladder[ladder.length - 1]) {
      ladder.push(floor);
    }
  }

  return ladder;
}

export interface CodecProbeResult {
  codec: VideoCodec;
  bitrate: number | null;
}

export async function selectBestVideoEncoder(params: {
  mode: ExportMode;
  quality: ExportQualityPreset;
  sourceCodec: VideoCodec | null;
  sourceBitrate: number | null;
  width: number;
  height: number;
  preferredContainer?: ExportContainer | null;
  canEncode: (codec: VideoCodec, bitrate?: number) => Promise<boolean>;
}): Promise<CodecProbeResult | null> {
  const {
    mode,
    quality,
    sourceCodec,
    sourceBitrate,
    width,
    height,
    preferredContainer,
    canEncode,
  } = params;

  const candidates = getCandidateCodecs(mode, quality, sourceCodec, preferredContainer);

  for (const codec of candidates) {
    const targetBitrate = computeTargetBitrateForCodec({
      mode,
      quality,
      targetCodec: codec,
      sourceCodec,
      sourceBitrate,
      width,
      height,
    });
    const ladder = buildBitrateFallbackLadder(targetBitrate);

    for (const candidateBitrate of ladder) {
      if (await canEncode(codec, candidateBitrate)) {
        return { codec, bitrate: candidateBitrate };
      }
    }
  }

  for (const codec of candidates) {
    if (await canEncode(codec, undefined)) {
      return { codec, bitrate: null };
    }
  }

  return null;
}

export function buildPresentationFrameTimings(
  rawSamples: FrameTimingSample[],
  clipStart: number,
  clipEnd: number,
  fallbackFps: number | null,
): FrameTimingSample[] {
  const safeFps =
    typeof fallbackFps === "number" && Number.isFinite(fallbackFps) && fallbackFps >= 1 && fallbackFps <= 240
      ? fallbackFps
      : 60;
  const defaultDuration = 1 / safeFps;

  const filtered = rawSamples
    .filter(
      (sample) =>
        Number.isFinite(sample.timestamp) &&
        sample.timestamp >= clipStart - 1e-4 &&
        sample.timestamp <= clipEnd + 1e-4,
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  if (filtered.length > 0) {
    return filtered.map((sample, index) => {
      let duration =
        Number.isFinite(sample.duration) && sample.duration > 0 ? sample.duration : 0;
      if (duration <= 0 && index + 1 < filtered.length) {
        const delta = filtered[index + 1].timestamp - sample.timestamp;
        if (delta > 0 && delta < 1) {
          duration = delta;
        }
      }
      if (duration <= 0) {
        duration = defaultDuration;
      }
      return {
        timestamp: Math.max(clipStart, sample.timestamp),
        duration,
      };
    });
  }

  const synthetic: FrameTimingSample[] = [];
  if (clipEnd <= clipStart) return synthetic;

  const frameCount = Math.max(1, Math.ceil((clipEnd - clipStart) * safeFps));
  for (let i = 0; i < frameCount; i++) {
    const ts = clipStart + i * defaultDuration;
    if (ts > clipEnd + 1e-6) break;
    const remaining = clipEnd - ts;
    synthetic.push({
      timestamp: ts,
      duration: remaining > 0 ? Math.min(defaultDuration, remaining) : defaultDuration,
    });
  }
  return synthetic;
}

export function formatBitrateMbps(bitrate: number | null): string {
  if (!bitrate || !Number.isFinite(bitrate) || bitrate <= 0) return "";
  const mbps = bitrate / 1_000_000;
  return mbps >= 10 ? `${Math.round(mbps)} Mbps` : `${mbps.toFixed(1)} Mbps`;
}

export function formatCodecLabel(codec: VideoCodec | null): string {
  if (!codec) return "Unknown";
  if (codec === "hevc") return "HEVC";
  if (codec === "avc") return "H.264";
  if (codec === "vp9") return "VP9";
  if (codec === "vp8") return "VP8";
  if (codec === "av1") return "AV1";
  return codec;
}

export function formatResolutionTag(width: number, height: number): string {
  if (width >= 5000 || height >= 2800) return "5.3K";
  if (width >= 3800 || height >= 2100) return "4K";
  if (width >= 2500 || height >= 1400) return "2.7K";
  if (width >= 1900 || height >= 1000) return "1080p";
  if (width >= 1200 || height >= 700) return "720p";
  return `${width}×${height}`;
}

export function premultiplyRgbaOverBlack(data: Uint8ClampedArray | Uint8Array): void {
  const pixelCount = Math.floor(data.length / 4);
  const canUseU32 = data.byteOffset % 4 === 0 && data.byteLength >= pixelCount * 4;
  const u32 = canUseU32
    ? new Uint32Array(data.buffer, data.byteOffset, pixelCount)
    : null;

  for (let p = 0; p < pixelCount; p++) {
    if (u32 && u32[p] === 0) continue;
    const i = p * 4;
    const a = data[i + 3];
    if (a === 255) continue;
    if (a === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      continue;
    }
    data[i] = ((data[i] * a + 127) / 255) | 0;
    data[i + 1] = ((data[i + 1] * a + 127) / 255) | 0;
    data[i + 2] = ((data[i + 2] * a + 127) / 255) | 0;
  }
}
