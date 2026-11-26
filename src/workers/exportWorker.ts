import {
  Input,
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  StreamTarget,
  CanvasSource,
  VideoSampleSource,
  VideoSample,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  CanvasSink,
  BlobSource,
  ALL_FORMATS,
  QUALITY_VERY_HIGH,
  canEncodeVideo,
  EncodedPacket,
  type StreamTargetChunk,
  type Target,
  type Quality,
  type VideoCodec,
  type InputVideoTrack,
} from "mediabunny";
import {
  buildTrackPath,
  drawCanvasHUD,
  type GPSPoint,
  type TelemetryPoint,
  type TrackMapProps,
  type HUDLayoutConfig,
} from "../utils/hud-draw";
import {
  buildPresentationFrameTimings,
  getContainerForCodec,
  normalizeEvenDimension,
  premultiplyRgbaOverBlack,
  sanitizeBitrate,
  selectBestVideoEncoder,
  type ExportContainer,
  type ExportEncodingInfo,
  type ExportMode,
  type ExportQualityPreset,
  type FrameTimingSample,
  type SourceVideoProfile,
} from "../utils/export-config";
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
  exportMode?: ExportMode;
  exportQuality?: ExportQualityPreset;
  preferredContainer?: ExportContainer | null;
  sourceProfile?: SourceVideoProfile | null;
  fileHandle?: FileSystemFileHandle;
  writableStream?: WritableStream<StreamTargetChunk>;
  referenceLap?: ReferenceLapTarget | null;
  showGhostOnMap?: boolean;
}

const GOOGLE_FONTS_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Orbitron:wght@450;700;900&family=Inter:wght@350;500;700;900&display=swap";

const MAX_SOURCE_BITRATE_CAP = 500_000_000;

let fontsLoadPromise: Promise<void> | null = null;
let cancelled = false;
let stopRequested = false;

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
      return;
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

function drawPreviewCheckerboard(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const tile = 12;
  ctx.fillStyle = "#18181b";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#27272a";
  for (let row = 0; row * tile < h; row++) {
    for (let col = (row % 2 === 0 ? 0 : 1); col * tile < w; col += 2) {
      const rx = x + col * tile;
      const ry = y + row * tile;
      ctx.fillRect(rx, ry, Math.min(tile, x + w - rx), Math.min(tile, y + h - ry));
    }
  }
}

class GpuAlphaPremultiplier {
  readonly canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext | null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;

  constructor(width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      throw new Error("WebGL2 unavailable");
    }
    this.gl = gl;

    const vertSrc = `#version 300 es
      in vec2 a_pos;
      in vec2 a_uv;
      out vec2 v_uv;
      void main() {
        gl_Position = vec4(a_pos, 0.0, 1.0);
        v_uv = a_uv;
      }`;
    const fragSrc = `#version 300 es
      precision highp float;
      uniform sampler2D u_tex;
      in vec2 v_uv;
      out vec4 fragColor;
      void main() {
        vec4 c = texture(u_tex, v_uv);
        fragColor = c.a > 0.0 ? c : vec4(0.0);
      }`;

    const vs = this.compileShader(gl, gl.VERTEX_SHADER, vertSrc);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error("Failed to create WebGL2 program");
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      throw new Error("Failed to link WebGL2 premultiply program");
    }
    this.program = program;

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const texture = gl.createTexture();
    if (!vao || !vbo || !texture) {
      this.dispose();
      throw new Error("Failed to allocate WebGL2 resources");
    }
    this.vao = vao;
    this.vbo = vbo;
    this.texture = texture;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 0, 1,
        1, -1, 1, 1,
        -1, 1, 0, 0,
        1, 1, 1, 0,
      ]),
      gl.STATIC_DRAW,
    );

    const posLoc = gl.getAttribLocation(program, "a_pos");
    const uvLoc = gl.getAttribLocation(program, "a_uv");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "u_tex"), 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, width, height);
  }

  private compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create WebGL2 shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error("Failed to compile WebGL2 shader");
    }
    return shader;
  }

  update(source: OffscreenCanvas): void {
    const gl = this.gl;
    if (!gl || !this.texture || !this.program || !this.vao) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.texture = null;
    this.vbo = null;
    this.vao = null;
    this.program = null;
    this.gl = null;
  }
}

function tryCreateGpuPremultiplier(width: number, height: number): GpuAlphaPremultiplier | null {
  try {
    return new GpuAlphaPremultiplier(width, height);
  } catch {
    return null;
  }
}

async function inspectSourceTrack(
  track: InputVideoTrack,
  fallbackWidth: number,
  fallbackHeight: number,
  fallbackProfile: SourceVideoProfile | null | undefined,
): Promise<SourceVideoProfile> {
  const codec: VideoCodec | null = (await track.getCodec()) ?? fallbackProfile?.codec ?? null;

  let displayW = fallbackWidth;
  let displayH = fallbackHeight;
  try {
    const trackW = await track.getDisplayWidth();
    const trackH = await track.getDisplayHeight();
    if (trackW >= 2 && trackH >= 2) {
      displayW = trackW;
      displayH = trackH;
    }
  } catch {
    displayW = fallbackProfile?.width || fallbackWidth;
    displayH = fallbackProfile?.height || fallbackHeight;
  }

  let measuredBitrate: number | null = null;
  let measuredFps: number | null = null;
  try {
    const stats = await track.computePacketStats(240);
    measuredBitrate = sanitizeBitrate(stats.averageBitrate, MAX_SOURCE_BITRATE_CAP);
    if (Number.isFinite(stats.averagePacketRate) && stats.averagePacketRate >= 1 && stats.averagePacketRate <= 240) {
      measuredFps = stats.averagePacketRate;
    }
  } catch {
    measuredBitrate = null;
  }

  if (measuredBitrate === null) {
    try {
      const avg = await track.getAverageBitrate();
      measuredBitrate = sanitizeBitrate(avg, MAX_SOURCE_BITRATE_CAP);
    } catch {
      measuredBitrate = null;
    }
  }

  if (measuredBitrate === null) {
    try {
      const peak = await track.getBitrate();
      measuredBitrate = sanitizeBitrate(peak, MAX_SOURCE_BITRATE_CAP);
    } catch {
      measuredBitrate = null;
    }
  }

  return {
    codec,
    bitrate: measuredBitrate ?? sanitizeBitrate(fallbackProfile?.bitrate, MAX_SOURCE_BITRATE_CAP),
    width: normalizeEvenDimension(displayW, 1920),
    height: normalizeEvenDimension(displayH, 1080),
    fps: measuredFps ?? fallbackProfile?.fps ?? null,
  };
}

async function collectClipFrameTimings(
  videoTrack: InputVideoTrack,
  clipStart: number,
  clipEnd: number,
  fallbackFps: number | null,
): Promise<FrameTimingSample[]> {
  const rawSamples: FrameTimingSample[] = [];
  try {
    const packetSink = new EncodedPacketSink(videoTrack);
    const startPacket =
      clipStart > 1
        ? await packetSink.getKeyPacket(Math.max(0, clipStart - 1), { metadataOnly: true })
        : null;
    for await (const pkt of packetSink.packets(startPacket ?? undefined, undefined, {
      metadataOnly: true,
    })) {
      if (cancelled || stopRequested) return [];
      if (pkt.timestamp >= clipStart - 1 && pkt.timestamp <= clipEnd + 1) {
        rawSamples.push({
          timestamp: pkt.timestamp,
          duration: pkt.duration || 0,
        });
      } else if (pkt.timestamp > clipEnd + 2 && rawSamples.length > 0) {
        break;
      }
    }
  } catch {
    rawSamples.length = 0;
  }

  return buildPresentationFrameTimings(rawSamples, clipStart, clipEnd, fallbackFps);
}

async function run(payload: WorkerInitPayload) {
  cancelled = false;
  stopRequested = false;
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
    exportMode = "composite",
    exportQuality = "high",
    preferredContainer = null,
    sourceProfile: incomingProfile = null,
    fileHandle,
    writableStream,
    referenceLap,
    showGhostOnMap,
  } = payload;

  const isAlphaOverlay = exportMode === "overlay-alpha";
  const inputs: Input[] = videoFiles.map(
    (blob) => new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }),
  );

  let ownedWritable: FileSystemWritableFileStream | null = null;
  let shouldCommitFile = false;
  let output: Output | null = null;
  let outputStarted = false;
  let gpuPremultiplier: GpuAlphaPremultiplier | null = null;

  const abortAndDispose = async (sendCancelled: boolean) => {
    try {
      if (output && outputStarted) {
        await output.cancel();
      } else if (ownedWritable) {
        await ownedWritable.abort();
      }
    } catch {
      // ignore cleanup errors on cancel
    } finally {
      gpuPremultiplier?.dispose();
      gpuPremultiplier = null;
      disposeInputs(inputs);
    }
    if (sendCancelled) {
      self.postMessage({ type: "cancelled" });
    }
  };

  try {
    let sourceProfile: SourceVideoProfile = {
      codec: incomingProfile?.codec ?? null,
      bitrate: sanitizeBitrate(incomingProfile?.bitrate, MAX_SOURCE_BITRATE_CAP),
      width: normalizeEvenDimension(incomingProfile?.width || canvasWidth, 1280),
      height: normalizeEvenDimension(incomingProfile?.height || canvasHeight, 720),
      fps: incomingProfile?.fps ?? null,
    };

    for (const input of inputs) {
      const firstTrack = await input.getPrimaryVideoTrack();
      if (firstTrack) {
        sourceProfile = await inspectSourceTrack(
          firstTrack,
          canvasWidth,
          canvasHeight,
          incomingProfile,
        );
        break;
      }
    }

    const evenWidth = sourceProfile.width;
    const evenHeight = sourceProfile.height;

    const chosenEncoder = await selectBestVideoEncoder({
      mode: exportMode,
      quality: exportQuality,
      sourceCodec: sourceProfile.codec,
      sourceBitrate: sourceProfile.bitrate,
      width: evenWidth,
      height: evenHeight,
      preferredContainer: isAlphaOverlay ? "webm" : preferredContainer,
      canEncode: (codec, bitrate) =>
        canEncodeVideo(codec, {
          width: evenWidth,
          height: evenHeight,
          bitrate: bitrate ?? QUALITY_VERY_HIGH,
          latencyMode: "quality",
        }),
    });

    if (!chosenEncoder) {
      await abortAndDispose(false);
      self.postMessage({
        type: "error",
        message: isAlphaOverlay
          ? "Your browser does not support WebCodecs VP9/VP8 encoding required for transparent HUD overlays."
          : "No hardware-accelerated video codec found. Your browser may not support WebCodecs.",
      });
      return;
    }

    const videoCodec = chosenEncoder.codec;
    const effectiveBitrate: number | Quality = chosenEncoder.bitrate ?? QUALITY_VERY_HIGH;
    const container: ExportContainer = isAlphaOverlay
      ? "webm"
      : getContainerForCodec(videoCodec);
    const usesMp4 = container === "mp4";

    gpuPremultiplier = isAlphaOverlay
      ? tryCreateGpuPremultiplier(evenWidth, evenHeight)
      : null;

    const offscreen = new OffscreenCanvas(evenWidth, evenHeight);
    const ctx = offscreen.getContext("2d", {
      alpha: isAlphaOverlay,
      willReadFrequently: isAlphaOverlay && !gpuPremultiplier,
    })!;

    const previewW = 640;
    const previewH = 360;
    const previewCanvas = new OffscreenCanvas(previewW, previewH);
    const previewCtx = previewCanvas.getContext("2d")!;
    const previewScale = Math.min(previewW / evenWidth, previewH / evenHeight);
    const previewDrawW = Math.round(evenWidth * previewScale);
    const previewDrawH = Math.round(evenHeight * previewScale);
    const previewDrawX = Math.round((previewW - previewDrawW) / 2);
    const previewDrawY = Math.round((previewH - previewDrawH) / 2);

    const outputFormat = usesMp4 ? new Mp4OutputFormat() : new WebMOutputFormat();
    let target: Target;
    let streamingToDisk = false;

    if (fileHandle) {
      const diskWritable = await fileHandle.createWritable();
      ownedWritable = diskWritable;
      const managedWritable = new WritableStream<StreamTargetChunk>({
        async write(chunk) {
          await diskWritable.write(chunk);
        },
        async close() {
          if (shouldCommitFile) {
            await diskWritable.close();
          } else {
            await diskWritable.abort();
          }
        },
        async abort(reason) {
          await diskWritable.abort(reason);
        },
      });
      target = new StreamTarget(managedWritable, { chunked: true });
      streamingToDisk = true;
    } else if (writableStream) {
      target = new StreamTarget(writableStream, { chunked: true });
      streamingToDisk = true;
    } else {
      target = new BufferTarget();
    }

    output = new Output({ format: outputFormat, target });

    const useCpuAlphaFallback = isAlphaOverlay && !gpuPremultiplier;
    const videoSampleSource = useCpuAlphaFallback
      ? new VideoSampleSource({
          codec: videoCodec,
          bitrate: effectiveBitrate,
          keyFrameInterval: 2,
          latencyMode: "quality",
          alpha: "keep",
        })
      : null;
    const canvasSource = useCpuAlphaFallback
      ? null
      : new CanvasSource(gpuPremultiplier ? gpuPremultiplier.canvas : offscreen, {
          codec: videoCodec,
          bitrate: effectiveBitrate,
          keyFrameInterval: 2,
          latencyMode: "quality",
          ...(isAlphaOverlay ? { alpha: "keep" as const } : {}),
        });

    if (videoSampleSource) {
      output.addVideoTrack(videoSampleSource);
    } else if (canvasSource) {
      output.addVideoTrack(canvasSource);
    }

    let audioSource: EncodedAudioPacketSource | null = null;
    let audioCodecName: string | null = null;

    if (!isAlphaOverlay && inputs.length > 0) {
      const supportedAudioCodecs = outputFormat.getSupportedAudioCodecs();
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

    const encodingInfo: ExportEncodingInfo = {
      mode: exportMode,
      quality: exportQuality,
      codec: videoCodec,
      container,
      bitrate: chosenEncoder.bitrate ?? "auto",
      width: evenWidth,
      height: evenHeight,
      streamingToDisk,
      sourceBitrate: sourceProfile.bitrate,
      sourceCodec: sourceProfile.codec,
    };
    self.postMessage({ type: "info", info: encodingInfo });

    await output.start();
    outputStarted = true;

    const trackSourcePoints =
      gpsPoints.length > 0 ? gpsPoints : telemetryRows.map((r) => ({ lat: r.lat, lon: r.lon }));
    const trackMapBase = buildTrackPath(trackSourcePoints);
    const totalExportDuration = Math.max(0.001, exportEnd - exportStart);
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

    const encodeHudFrame = async (
      globalVideoTs: number,
      frameDuration: number,
      drawSourceFrame?: () => void,
      flushPendingAudio?: () => Promise<void>,
    ) => {
      const rawExportRelativeTs = globalVideoTs - exportStart;
      const exportRelativeTs =
        lastVideoOutTs < 0
          ? Math.max(0, rawExportRelativeTs)
          : Math.max(lastVideoOutTs + 1e-6, rawExportRelativeTs);
      lastVideoOutTs = exportRelativeTs;

      ctx.clearRect(0, 0, evenWidth, evenHeight);
      if (drawSourceFrame) {
        drawSourceFrame();
      }

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

      if (flushPendingAudio) {
        await flushPendingAudio();
      }

      if (videoSampleSource) {
        const imageData = ctx.getImageData(0, 0, evenWidth, evenHeight);
        premultiplyRgbaOverBlack(imageData.data);
        const sample = new VideoSample(imageData.data, {
          format: "RGBA",
          codedWidth: evenWidth,
          codedHeight: evenHeight,
          timestamp: exportRelativeTs,
          duration: frameDuration,
        });
        try {
          await videoSampleSource.add(sample);
        } finally {
          sample.close();
        }
      } else if (canvasSource) {
        if (gpuPremultiplier) {
          gpuPremultiplier.update(offscreen);
        }
        await canvasSource.add(exportRelativeTs, frameDuration);
      }

      const percent = Math.round(
        Math.min(100, Math.max(0, (exportRelativeTs / totalExportDuration) * 100)),
      );

      if (globalFrameIndex % 15 === 0) {
        previewCtx.clearRect(0, 0, previewW, previewH);
        if (isAlphaOverlay) {
          drawPreviewCheckerboard(
            previewCtx,
            previewDrawX,
            previewDrawY,
            previewDrawW,
            previewDrawH,
          );
        }
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
    };

    for (let vi = 0; vi < inputs.length; vi++) {
      if (cancelled) {
        await abortAndDispose(true);
        return;
      }
      if (stopRequested) {
        break;
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

      if (isAlphaOverlay) {
        const frameTimings = await collectClipFrameTimings(
          videoTrack,
          clipStart,
          clipEnd,
          sourceProfile.fps,
        );
        if (cancelled) {
          await abortAndDispose(true);
          return;
        }
        if (stopRequested) {
          break;
        }

        for (const frame of frameTimings) {
          if (cancelled) {
            await abortAndDispose(true);
            return;
          }
          if (stopRequested) {
            break;
          }
          await encodeHudFrame(videoStartInGlobal + frame.timestamp, frame.duration);
        }

        if (stopRequested) {
          break;
        }
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
          await abortAndDispose(true);
          return;
        }
        if (stopRequested) {
          break;
        }

        const localFrameTs = wrappedCanvas.timestamp;
        if (localFrameTs < clipStart) {
          continue;
        }

        const frameDuration = wrappedCanvas.duration ?? 1 / (sourceProfile.fps || 60);

        await encodeHudFrame(
          videoStartInGlobal + localFrameTs,
          frameDuration,
          () => {
            ctx.drawImage(wrappedCanvas.canvas, 0, 0, evenWidth, evenHeight);
          },
          audioSource && audioPacketSink && nextAudioPacket
            ? async () => {
                while (
                  nextAudioPacket &&
                  nextAudioPacket.timestamp <= localFrameTs &&
                  nextAudioPacket.timestamp <= clipEnd
                ) {
                  await flushAudioPacket(nextAudioPacket);
                  nextAudioPacket = await audioPacketSink!.getNextPacket(nextAudioPacket);
                }
              }
            : undefined,
        );
      }

      if (stopRequested) {
        break;
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

    if (cancelled || (stopRequested && globalFrameIndex === 0)) {
      await abortAndDispose(true);
      return;
    }

    if (stopRequested) {
      self.postMessage({ type: "finalizing" });
    }

    shouldCommitFile = true;
    await output.finalize();
    gpuPremultiplier?.dispose();
    gpuPremultiplier = null;
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
      self.postMessage(
        { type: "done", buffer, mimeType, fileExt, savedToDisk: false, partial: stopRequested },
        { transfer: [buffer] },
      );
    } else {
      self.postMessage({
        type: "done",
        mimeType,
        fileExt,
        savedToDisk: true,
        partial: stopRequested,
      });
    }
  } catch (err) {
    shouldCommitFile = false;
    await abortAndDispose(false);
    if (!cancelled) {
      const message =
        err instanceof Error && err.message ? err.message : "Video export failed.";
      self.postMessage({ type: "error", message });
    }
  }
}

self.onmessage = (e: MessageEvent) => {
  if (e.data?.type === "cancel") {
    cancelled = true;
    return;
  }
  if (e.data?.type === "stop-and-save") {
    stopRequested = true;
    return;
  }
  if (e.data?.type === "init") {
    run(e.data.payload as WorkerInitPayload).catch((err) => {
      if (!cancelled) {
        const message =
          err instanceof Error && err.message ? err.message : "Video export failed.";
        self.postMessage({ type: "error", message });
      }
    });
  }
};
