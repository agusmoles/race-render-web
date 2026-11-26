"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Play,
  Pause,
  Upload,
  Layers,
  RefreshCw,
  Sliders,
  Download,
  Video,
  FileText,
  X,
  Zap,
  MapPin,
  Flag,
  Maximize,
  Volume2,
  VolumeX,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { parseTelemetryCSV, ParsedTelemetry } from "@/utils/csv-helper";
import { autoSyncWithGpmf, AutoSyncResult } from "@/utils/gpmf-sync";
import {
  formatBitrateMbps,
  formatCodecLabel,
  formatResolutionTag,
  normalizeEvenDimension,
  sanitizeBitrate,
  type ExportContainer,
  type ExportEncodingInfo,
  type ExportMode,
  type ExportQualityPreset,
  type SourceVideoProfile,
} from "@/utils/export-config";
import {
  analyzeSessionLaps,
  areTracksCompatible,
  buildReferenceLapTarget,
  COMPARISON_ACCENT_COLORS,
  evaluateGhostPosition,
  evaluateReferenceAtProgress,
  extractRacerDisplayName,
  formatLapTime,
  MAX_COMPARISON_SESSIONS,
  MAX_CSV_BYTES,
  PRIMARY_REFERENCE_ACCENT,
  PRIMARY_SESSION_ID,
  sanitizeDisplayLabel,
  type ComparisonSelection,
  type ComparisonSession,
  type LiveComparisonMetric,
  type ReferenceLapTarget,
} from "@/utils/telemetry-compare";
import ComparisonPanel from "./ComparisonPanel";
import Speedometer from "./gauges/Speedometer";
import RpmGauge from "./gauges/RpmGauge";
import GForceRadar from "./gauges/GForceRadar";
import TrackMap from "./gauges/TrackMap";
import LapTimer from "./gauges/LapTimer";
import DeltaBar from "./gauges/DeltaBar";

interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}

type WidgetId =
  | "speedometer"
  | "rpmGauge"
  | "gForceRadar"
  | "trackMap"
  | "lapTimer"
  | "deltaBar";

type ResizeCorner = "nw" | "ne" | "sw" | "se";

const HUD_LAYOUT_STORAGE_KEY = "race_render_hud_layout_v1";
const MIN_WIDGET_SCALE = 0.5;
const MAX_WIDGET_SCALE = 2.0;

const DEFAULT_LAYOUT_CONFIG: Record<WidgetId, WidgetLayout> = {
  speedometer: { x: 3, y: 70, w: 20, h: 25, visible: true },
  rpmGauge: { x: 20, y: 72, w: 18, h: 23, visible: true },
  gForceRadar: { x: 77, y: 68, w: 20, h: 27, visible: true },
  trackMap: { x: 70, y: 2, w: 28, h: 38, visible: true },
  lapTimer: { x: 3, y: 3, w: 26, h: 16, visible: true },
  deltaBar: { x: 35, y: 3, w: 30, h: 8, visible: true },
};

const RESIZE_CORNERS: {
  corner: ResizeCorner;
  posClass: string;
  cursorClass: string;
}[] = [
  { corner: "nw", posClass: "-top-2 -left-2", cursorClass: "cursor-nwse-resize" },
  { corner: "ne", posClass: "-top-2 -right-2", cursorClass: "cursor-nesw-resize" },
  { corner: "sw", posClass: "-bottom-2 -left-2", cursorClass: "cursor-nesw-resize" },
  { corner: "se", posClass: "-bottom-2 -right-2", cursorClass: "cursor-nwse-resize" },
];

function createDefaultLayoutConfig(): Record<WidgetId, WidgetLayout> {
  return {
    speedometer: { ...DEFAULT_LAYOUT_CONFIG.speedometer },
    rpmGauge: { ...DEFAULT_LAYOUT_CONFIG.rpmGauge },
    gForceRadar: { ...DEFAULT_LAYOUT_CONFIG.gForceRadar },
    trackMap: { ...DEFAULT_LAYOUT_CONFIG.trackMap },
    lapTimer: { ...DEFAULT_LAYOUT_CONFIG.lapTimer },
    deltaBar: { ...DEFAULT_LAYOUT_CONFIG.deltaBar },
  };
}

function isDefaultLayoutConfig(config: Record<WidgetId, WidgetLayout>): boolean {
  return (Object.keys(DEFAULT_LAYOUT_CONFIG) as WidgetId[]).every((id) => {
    const current = config[id];
    const def = DEFAULT_LAYOUT_CONFIG[id];
    return (
      current.x === def.x &&
      current.y === def.y &&
      current.w === def.w &&
      current.h === def.h &&
      current.visible === def.visible
    );
  });
}

function loadSavedLayoutConfig(): Record<WidgetId, WidgetLayout> {
  const defaults = createDefaultLayoutConfig();
  if (typeof window === "undefined") return defaults;

  try {
    const raw = window.localStorage.getItem(HUD_LAYOUT_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaults;

    const record = parsed as Record<string, unknown>;
    for (const id of Object.keys(DEFAULT_LAYOUT_CONFIG) as WidgetId[]) {
      const candidate = record[id];
      if (!candidate || typeof candidate !== "object") continue;
      const item = candidate as Partial<Record<keyof WidgetLayout, unknown>>;
      const def = DEFAULT_LAYOUT_CONFIG[id];

      const minW = def.w * MIN_WIDGET_SCALE;
      const maxW = Math.min(100, def.w * MAX_WIDGET_SCALE);
      const rawW =
        typeof item.w === "number" && Number.isFinite(item.w) ? item.w : def.w;
      const w = parseFloat(Math.max(minW, Math.min(maxW, rawW)).toFixed(1));
      const h = parseFloat(((w / def.w) * def.h).toFixed(1));

      const rawX =
        typeof item.x === "number" && Number.isFinite(item.x) ? item.x : def.x;
      const x = parseFloat(
        Math.max(0, Math.min(Math.max(0, 100 - w), rawX)).toFixed(1),
      );

      const rawY =
        typeof item.y === "number" && Number.isFinite(item.y) ? item.y : def.y;
      const y = parseFloat(
        Math.max(0, Math.min(Math.max(0, 100 - Math.min(100, h)), rawY)).toFixed(1),
      );

      const visible =
        typeof item.visible === "boolean" ? item.visible : def.visible;

      defaults[id] = { x, y, w, h, visible };
    }
  } catch {
    return defaults;
  }

  return defaults;
}

interface HudWidgetFrameProps {
  widgetId: WidgetId;
  layout: WidgetLayout;
  isEditMode: boolean;
  isResizing: boolean;
  fitHeight?: boolean;
  containerQuery?: boolean;
  onDragStart: (
    e: React.PointerEvent<HTMLDivElement>,
    widgetId: WidgetId,
  ) => void;
  onResizeStart: (
    e: React.PointerEvent<HTMLButtonElement>,
    widgetId: WidgetId,
    corner: ResizeCorner,
  ) => void;
  children: React.ReactNode;
}

function HudWidgetFrame({
  widgetId,
  layout,
  isEditMode,
  isResizing,
  fitHeight = false,
  containerQuery = false,
  onDragStart,
  onResizeStart,
  children,
}: HudWidgetFrameProps) {
  const scalePct = Math.round(
    (layout.w / DEFAULT_LAYOUT_CONFIG[widgetId].w) * 100,
  );

  return (
    <div
      className={`absolute select-none${containerQuery ? " @container" : ""}${
        isEditMode
          ? " pointer-events-auto outline-2 outline-dashed outline-cyan-400 bg-cyan-400/10 cursor-move touch-none"
          : " transition-all duration-75"
      }`}
      style={{
        left: `${layout.x}%`,
        top: `${layout.y}%`,
        width: `${layout.w}%`,
        height: fitHeight ? "fit-content" : `${layout.h}%`,
      }}
      onPointerDown={(e) => onDragStart(e, widgetId)}
    >
      {children}
      {isEditMode &&
        RESIZE_CORNERS.map(({ corner, posClass, cursorClass }) => (
          <button
            key={corner}
            type="button"
            aria-label={`Resize ${widgetId}`}
            className={`absolute ${posClass} w-4 h-4 flex items-center justify-center z-20 touch-none ${cursorClass}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onResizeStart(e, widgetId, corner);
            }}
          >
            <span className="w-2.5 h-2.5 rounded-[3px] bg-cyan-400 border border-zinc-950 shadow-[0_0_6px_rgba(34,211,238,0.85)]" />
          </button>
        ))}
      {isEditMode && isResizing && (
        <span className="absolute -top-6 left-1/2 -translate-x-1/2 pointer-events-none z-20 bg-zinc-950/90 border border-cyan-400/50 text-cyan-300 font-mono text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
          {scalePct}%
        </span>
      )}
    </div>
  );
}

function resolveVideoClipPosition(globalTime: number, durations: number[]) {
  if (durations.length === 0) {
    return { index: 0, localTime: Math.max(0, globalTime) };
  }
  let t = 0;
  for (let i = 0; i < durations.length; i++) {
    const end = t + durations[i];
    if (globalTime <= end || i === durations.length - 1) {
      return {
        index: i,
        localTime: Math.max(0, Math.min(durations[i], globalTime - t)),
      };
    }
    t = end;
  }
  return { index: 0, localTime: 0 };
}

interface SaveFilePickerAcceptType {
  description: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: SaveFilePickerAcceptType[];
}

interface WindowWithSavePicker extends Window {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions,
  ) => Promise<FileSystemFileHandle>;
}

function formatSyncMethodLabel(method: AutoSyncResult["method"]): string {
  if (method === "gopro-gps-speed") return "GoPro GPS";
  if (method === "gopro-gyro") return "GoPro Gyro";
  if (method === "gopro-accl") return "GoPro Accel";
  return "GoPro Telemetry";
}

export default function Workspace() {
  // Local File Loading
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [videoDurations, setVideoDurations] = useState<number[]>([]);
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const [csvFile, setCsvFile] = useState<File | null>(null);

  // High-performance Parsed Telemetry stored entirely in memory
  const [localTelemetry, setLocalTelemetry] = useState<ParsedTelemetry | null>(
    null,
  );

  // Statuses
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [hasRenderedExportFrame, setHasRenderedExportFrame] = useState(false);
  const [isFinalizingExport, setIsFinalizingExport] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>("composite");
  const [exportQuality, setExportQuality] = useState<ExportQualityPreset>("high");
  const [sourceVideoProfile, setSourceVideoProfile] =
    useState<SourceVideoProfile | null>(null);
  const [canEncodeMp4, setCanEncodeMp4] = useState(true);
  const [activeExportInfo, setActiveExportInfo] =
    useState<ExportEncodingInfo | null>(null);
  const [uploadError, setUploadError] = useState("");

  // Sync Parameters
  const [syncOffset, setSyncOffset] = useState<number>(0.0);
  const [speedScale, setSpeedScale] = useState<number>(1.0);
  const [channelMapping, setChannelMapping] = useState<Record<string, string>>({
    time: "",
    speed: "",
    rpm: "",
    latAcc: "",
    lonAcc: "",
    lat: "",
    lon: "",
    lap: "",
  });

  // HUD layout config
  const [isEditMode, setIsEditMode] = useState(false);
  const [layoutConfig, setLayoutConfig] = useState<
    Record<WidgetId, WidgetLayout>
  >(loadSavedLayoutConfig);
  const [resizingWidgetId, setResizingWidgetId] = useState<WidgetId | null>(
    null,
  );

  // Video Ref & Playback state
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const exportWorkerRef = useRef<Worker | null>(null);
  const exportCancelTimerRef = useRef<number | null>(null);
  const videoInspectRunIdRef = useRef(0);
  const currentSessionKeyRef = useRef<string | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const overlayStageRef = useRef<HTMLDivElement>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [volume, setVolume] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Export trim range
  const [prevVideoDuration, setPrevVideoDuration] = useState(0);
  const [exportStart, setExportStart] = useState<number>(0);
  const [exportEnd, setExportEnd] = useState<number>(0);
  const [exportStartLap, setExportStartLap] = useState<number | null>(null);
  const [exportEndLap, setExportEndLap] = useState<number | null>(null);
  const [exportRangeAnchorLap, setExportRangeAnchorLap] = useState<number | null>(
    null,
  );

  if (videoDuration !== prevVideoDuration) {
    setPrevVideoDuration(videoDuration);
    if (exportEnd === 0) {
      setExportEnd(videoDuration);
    }
  }

  const formatTimeMinutes = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = Math.floor(secs % 60);
    return `${mins}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  // High performance telemetry interpolation state
  const [currentTelemetry, setCurrentTelemetry] = useState({
    speed: 0,
    rpm: 0,
    latAcc: 0,
    lonAcc: 0,
    lat: 0,
    lon: 0,
    lap: 1,
    distance: 0,
  });

  // Telemetry Sync Wizard Modal State
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportPreviewTime, setExportPreviewTime] = useState(0);
  const [exportActiveVideoIndex, setExportActiveVideoIndex] = useState(0);
  const exportPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const [modalVideoTime, setModalVideoTime] = useState(0);
  const [modalActiveVideoIndex, setModalActiveVideoIndex] = useState(0);
  const [modalTelemetryIdx, setModalTelemetryIdx] = useState(0);
  const modalVideoRef = useRef<HTMLVideoElement>(null);
  const [autoSyncState, setAutoSyncState] = useState<{
    phase: "idle" | "running" | "matched" | "low-confidence" | "unavailable";
    result: AutoSyncResult | null;
  }>({ phase: "idle", result: null });
  const autoSyncRunIdRef = useRef(0);
  const latestVideoRef = useRef<{ files: File[]; durations: number[] }>({
    files: [],
    durations: [],
  });
  const latestCsvRef = useRef<{ file: File; telemetry: ParsedTelemetry } | null>(
    null,
  );
  const pendingMainSeekRef = useRef<{ time: number; autoPlay: boolean } | null>(
    null,
  );
  const pendingModalSeekRef = useRef<number | null>(null);

  const [comparisonSessions, setComparisonSessions] = useState<
    ComparisonSession[]
  >([]);
  const [comparisonSelection, setComparisonSelection] =
    useState<ComparisonSelection>({
      sourceId: PRIMARY_SESSION_ID,
      lapNum: null,
    });
  const [showGhostOnMap, setShowGhostOnMap] = useState(true);
  const [comparisonError, setComparisonError] = useState("");
  const [isParsingComparison, setIsParsingComparison] = useState(false);
  const comparisonCounterRef = useRef(0);

  const telemetryMeta = useMemo(() => {
    if (!localTelemetry)
      return { totalDuration: 0, sampleRate: 0, timeUnitCorrected: false };
    return {
      totalDuration: localTelemetry.totalDuration,
      sampleRate: localTelemetry.detectedSampleRate,
      timeUnitCorrected: localTelemetry.timeUnitCorrected,
    };
  }, [localTelemetry]);

  const telemetryMaxSpeed = useMemo(() => {
    if (!localTelemetry?.rows || localTelemetry.rows.length === 0) return 260;
    let max = 0;
    for (const r of localTelemetry.rows) {
      if (r.speed > max) max = r.speed;
    }
    return Math.ceil(max / 10) * 10 || 260;
  }, [localTelemetry]);

  const telemetryMaxRpm = useMemo(() => {
    if (!localTelemetry?.rows || localTelemetry.rows.length === 0) return 15000;
    let max = 0;
    for (const r of localTelemetry.rows) {
      if (r.rpm > max) max = r.rpm;
    }
    return Math.ceil(max / 500) * 500 || 15000;
  }, [localTelemetry]);

  const primaryLapAnalysis = useMemo(
    () => analyzeSessionLaps(localTelemetry?.rows ?? []),
    [localTelemetry],
  );

  const lapTimes = primaryLapAnalysis;
  const bestLapInfo = primaryLapAnalysis.bestLap;

  const bestLapRows = useMemo(() => {
    if (!localTelemetry?.rows || bestLapInfo.lap === 0) return [];
    return localTelemetry.rows.filter((r) => r.lap === bestLapInfo.lap);
  }, [localTelemetry, bestLapInfo.lap]);

  const seekToTelemetryTime = (targetSeconds: number) => {
    if (!localTelemetry?.rows || localTelemetry.rows.length === 0) return;
    const rows = localTelemetry.rows;
    let lo = 0,
      hi = rows.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (rows[mid].time < targetSeconds) lo = mid + 1;
      else hi = mid;
    }
    setModalTelemetryIdx(lo);
  };

  const telemetryLaps = primaryLapAnalysis.lapNumbers;

  const firstTimedLapNum = telemetryLaps.length > 1 ? telemetryLaps[1] : -1;

  const firstLapStartIdx = useMemo(() => {
    if (!localTelemetry?.rows || localTelemetry.rows.length < 2) return -1;

    if (firstTimedLapNum !== -1) {
      const targetIdx = localTelemetry.rows.findIndex(
        (row) => row.lap === firstTimedLapNum,
      );
      if (targetIdx !== -1) return targetIdx;
    }

    for (let i = 1; i < localTelemetry.rows.length; i++) {
      if (
        localTelemetry.rows[i].segmentTime <
        localTelemetry.rows[i - 1].segmentTime - 1
      ) {
        return i;
      }
    }

    return -1;
  }, [localTelemetry, firstTimedLapNum]);

  const firstLaunchIdx = useMemo(() => {
    if (!localTelemetry?.rows || localTelemetry.rows.length === 0) return 0;
    const idx = localTelemetry.rows.findIndex(
      (row) => row.speed > 5 || row.rpm > 2000,
    );
    if (idx !== -1) return idx;
    return firstLapStartIdx !== -1 ? firstLapStartIdx : 0;
  }, [localTelemetry, firstLapStartIdx]);

  // Track map coordinates list
  const gpsPoints = useMemo(() => {
    if (!localTelemetry?.rows) return [];

    let filteredRows = localTelemetry.rows;

    if (firstLapStartIdx > 0) {
      filteredRows = filteredRows.slice(firstLapStartIdx);
    } else if (telemetryLaps.length >= 2) {
      const outLapNum = telemetryLaps[0];
      filteredRows = filteredRows.filter((row) => row.lap !== outLapNum);
    }

    if (telemetryLaps.length >= 3) {
      const inLapNum = telemetryLaps[telemetryLaps.length - 1];
      filteredRows = filteredRows.filter((row) => row.lap !== inLapNum);
    }

    return filteredRows.map((row) => ({
      lat: Number(row.lat) || 0,
      lon: Number(row.lon) || 0,
    }));
  }, [localTelemetry, firstLapStartIdx, telemetryLaps]);

  const firstLapStartCoord = useMemo(() => {
    if (
      !localTelemetry?.rows ||
      firstLapStartIdx === -1 ||
      !localTelemetry.rows[firstLapStartIdx]
    ) {
      return null;
    }

    const row = localTelemetry.rows[firstLapStartIdx];
    if (row.lat !== 0 && row.lon !== 0) {
      return { lat: row.lat, lon: row.lon };
    }

    return null;
  }, [localTelemetry, firstLapStartIdx]);

  const startFinishCoord = firstLapStartCoord;

  const handleJumpToLapNumber = (lapNum: number) => {
    if (!localTelemetry?.rows || localTelemetry.rows.length === 0) return;
    const targetIdx = localTelemetry.rows.findIndex((r) => r.lap === lapNum);
    if (targetIdx !== -1) {
      setModalTelemetryIdx(targetIdx);
    }
  };

  const runAutoSync = async (
    files: File[],
    durations: number[],
    telemetry: ParsedTelemetry,
  ) => {
    if (files.length === 0 || telemetry.rows.length < 10) return;
    const runId = ++autoSyncRunIdRef.current;
    setAutoSyncState({ phase: "running", result: null });

    try {
      const res = await autoSyncWithGpmf(files, durations, telemetry.rows);
      if (runId !== autoSyncRunIdRef.current) return;

      if (res.status === "matched") {
        setSyncOffset(res.syncOffset);
        setSpeedScale(res.speedScale);
        setAutoSyncState({ phase: "matched", result: res });
      } else if (res.status === "low-confidence") {
        setAutoSyncState({ phase: "low-confidence", result: res });
      } else {
        setAutoSyncState({ phase: "unavailable", result: res });
      }
    } catch {
      if (runId !== autoSyncRunIdRef.current) return;
      setAutoSyncState({
        phase: "unavailable",
        result: {
          status: "no-signal",
          syncOffset: 0,
          speedScale: 1.0,
          confidence: 0,
          method: null,
          reason: "Could not inspect video telemetry track",
        },
      });
    }
  };

  const initializeSessionSync = (
    files: File[],
    durations: number[],
    csv: File,
    telemetry: ParsedTelemetry,
  ) => {
    const vidNames = files.map((f) => f.name).join(",");
    const key = `race_render_sync_${vidNames}_${csv.name}`;
    currentSessionKeyRef.current = key;

    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const { syncOffset: savedOffset, speedScale: savedScale } =
          JSON.parse(saved);
        if (typeof savedOffset === "number") setSyncOffset(savedOffset);
        if (typeof savedScale === "number") setSpeedScale(savedScale);
        setAutoSyncState({ phase: "idle", result: null });
        return;
      } catch {
        // ignore malformed saved sync config
      }
    }

    setSyncOffset(0);
    setSpeedScale(1.0);
    void runAutoSync(files, durations, telemetry);
  };

  const inspectLoadedVideoProfile = async (file: File) => {
    const runId = ++videoInspectRunIdRef.current;
    try {
      const { Input, BlobSource, ALL_FORMATS, canEncodeVideo } = await import("mediabunny");
      if (runId !== videoInspectRunIdRef.current) return;

      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track || runId !== videoInspectRunIdRef.current) return;

        const [codec, rawW, rawH] = await Promise.all([
          track.getCodec(),
          track.getDisplayWidth().catch(() => 0),
          track.getDisplayHeight().catch(() => 0),
        ]);

        let bitrate: number | null = null;
        let fps: number | null = null;
        try {
          const stats = await track.computePacketStats(120);
          bitrate = sanitizeBitrate(stats.averageBitrate, 500_000_000);
          if (
            Number.isFinite(stats.averagePacketRate) &&
            stats.averagePacketRate >= 1 &&
            stats.averagePacketRate <= 240
          ) {
            fps = stats.averagePacketRate;
          }
        } catch {
          bitrate = null;
        }

        if (bitrate === null) {
          const avg = await track.getAverageBitrate().catch(() => null);
          bitrate = sanitizeBitrate(avg, 500_000_000);
        }
        if (bitrate === null) {
          const peak = await track.getBitrate().catch(() => null);
          bitrate = sanitizeBitrate(peak, 500_000_000);
        }

        const width = normalizeEvenDimension(rawW, 1920);
        const height = normalizeEvenDimension(rawH, 1080);

        const [avcOk, hevcOk] = await Promise.all([
          canEncodeVideo("avc", { width, height }).catch(() => false),
          canEncodeVideo("hevc", { width, height }).catch(() => false),
        ]);

        if (runId !== videoInspectRunIdRef.current) return;
        setSourceVideoProfile({ codec, bitrate, width, height, fps });
        setCanEncodeMp4(avcOk || hevcOk);
      } finally {
        if (Symbol.dispose in input) {
          (input as Disposable)[Symbol.dispose]();
        }
      }
    } catch {
      if (runId === videoInspectRunIdRef.current) {
        setSourceVideoProfile(null);
      }
    }
  };

  const handleVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      videoUrls.forEach((url) => URL.revokeObjectURL(url));

      const files = Array.from(e.target.files).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      autoSyncRunIdRef.current++;
      currentSessionKeyRef.current = null;
      pendingMainSeekRef.current = null;
      latestVideoRef.current = { files, durations: [] };

      setVideoFiles(files);
      setVideoDurations([]);
      setVideoDuration(0);
      setSourceVideoProfile(null);
      setAutoSyncState({ phase: "idle", result: null });
      void inspectLoadedVideoProfile(files[0]);
      const urls = files.map((f) => URL.createObjectURL(f));
      setVideoUrls(urls);
      setActiveVideoIndex(0);
      setIsPlaying(false);
      setCurrentTime(0);
      setExportStart(0);
      setExportEnd(0);
      setExportStartLap(null);
      setExportEndLap(null);
      setExportRangeAnchorLap(null);

      const durations = await Promise.all(
        urls.map(
          (url) =>
            new Promise<number>((resolve) => {
              const video = document.createElement("video");
              video.preload = "metadata";
              video.onloadedmetadata = () => resolve(video.duration);
              video.src = url;
            }),
        ),
      );
      if (latestVideoRef.current.files !== files) return;

      latestVideoRef.current = { files, durations };
      setVideoDurations(durations);
      const total = durations.reduce((a, b) => a + b, 0);
      setVideoDuration(total);

      if (latestCsvRef.current) {
        initializeSessionSync(
          files,
          durations,
          latestCsvRef.current.file,
          latestCsvRef.current.telemetry,
        );
      }
    }
  };

  // Parse CSV telemetry in client-side memory
  const handleCSVChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      autoSyncRunIdRef.current++;
      currentSessionKeyRef.current = null;
      latestCsvRef.current = null;

      setCsvFile(file);
      setIsProcessing(true);
      setUploadError("");
      setAutoSyncState({ phase: "idle", result: null });
      setExportStartLap(null);
      setExportEndLap(null);
      setExportRangeAnchorLap(null);

      try {
        const csvText = await file.text();
        const parsed = parseTelemetryCSV(csvText);
        latestCsvRef.current = { file, telemetry: parsed };
        setLocalTelemetry(parsed);
        setChannelMapping(parsed.channelMapping);
        setComparisonSelection((prev) =>
          prev.sourceId === PRIMARY_SESSION_ID
            ? { sourceId: PRIMARY_SESSION_ID, lapNum: null }
            : prev,
        );
        setComparisonSessions((prev) =>
          prev.map((session) => ({
            ...session,
            trackCompatible: areTracksCompatible(
              parsed.rows,
              session.telemetry.rows,
            ),
          })),
        );

        const { files, durations } = latestVideoRef.current;
        if (files.length > 0 && durations.length === files.length) {
          initializeSessionSync(files, durations, file, parsed);
        }
      } catch (err) {
        const error = err as Error;
        setUploadError("Error reading telemetry: " + error.message);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleAddComparisonCSVs = async (fileList: FileList) => {
    const remainingSlots = MAX_COMPARISON_SESSIONS - comparisonSessions.length;
    if (remainingSlots <= 0) {
      setComparisonError(
        `Maximum of ${MAX_COMPARISON_SESSIONS} comparison CSV sessions reached.`,
      );
      return;
    }

    const incoming = Array.from(fileList);
    const errors: string[] = [];
    const added: ComparisonSession[] = [];
    const primaryCoords =
      gpsPoints.length >= 5 ? gpsPoints : (localTelemetry?.rows ?? []);

    setComparisonError("");
    setIsParsingComparison(true);

    try {
      for (const file of incoming) {
        if (added.length >= remainingSlots) {
          errors.push(
            `Skipped ${sanitizeDisplayLabel(file.name, 28)}: limit of ${MAX_COMPARISON_SESSIONS} sessions reached.`,
          );
          break;
        }
        if (!file.name.toLowerCase().endsWith(".csv")) {
          errors.push(
            `Skipped ${sanitizeDisplayLabel(file.name, 28)}: only .csv files are supported.`,
          );
          continue;
        }
        if (file.size > MAX_CSV_BYTES) {
          errors.push(
            `Skipped ${sanitizeDisplayLabel(file.name, 28)}: file exceeds 50 MB limit.`,
          );
          continue;
        }

        try {
          const text = await file.text();
          const parsed = parseTelemetryCSV(text);
          if (parsed.rows.length < 2) {
            errors.push(
              `Skipped ${sanitizeDisplayLabel(file.name, 28)}: no telemetry rows found.`,
            );
            continue;
          }

          const analysis = analyzeSessionLaps(parsed.rows);
          if (analysis.selectableLaps.length === 0) {
            errors.push(
              `Skipped ${sanitizeDisplayLabel(file.name, 28)}: no valid timed laps found.`,
            );
            continue;
          }

          const idx = comparisonCounterRef.current++;
          const color =
            COMPARISON_ACCENT_COLORS[idx % COMPARISON_ACCENT_COLORS.length];

          added.push({
            id: `cmp_${idx}_${Date.now()}`,
            fileName: sanitizeDisplayLabel(file.name, 60),
            racerName: extractRacerDisplayName(parsed.metadata, file.name),
            sessionName: sanitizeDisplayLabel(
              parsed.metadata["Session"] || "",
              40,
            ),
            vehicle: sanitizeDisplayLabel(
              parsed.metadata["Vehicle"] || "",
              40,
            ),
            color,
            telemetry: parsed,
            analysis,
            selectedLapNum: null,
            trackCompatible: areTracksCompatible(primaryCoords, parsed.rows),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Invalid CSV";
          errors.push(
            `Failed ${sanitizeDisplayLabel(file.name, 28)}: ${sanitizeDisplayLabel(msg, 60)}`,
          );
        }
      }

      if (added.length > 0) {
        setComparisonSessions((prev) =>
          [...prev, ...added].slice(0, MAX_COMPARISON_SESSIONS),
        );
        setComparisonSelection({ sourceId: added[0].id, lapNum: null });
      }
      if (errors.length > 0) {
        setComparisonError(errors[0]);
      }
    } finally {
      setIsParsingComparison(false);
    }
  };

  const handleRemoveComparisonSession = (sessionId: string) => {
    setComparisonSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setComparisonSelection((prev) =>
      prev.sourceId === sessionId
        ? { sourceId: PRIMARY_SESSION_ID, lapNum: null }
        : prev,
    );
  };

  const handleRenameComparisonSession = (
    sessionId: string,
    nextName: string,
  ) => {
    const clean = sanitizeDisplayLabel(nextName, 40) || "Racer";
    setComparisonSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, racerName: clean } : s)),
    );
  };

  const handleSelectComparison = (sourceId: string, lapNum: number | null) => {
    setComparisonSelection({ sourceId, lapNum });
    if (sourceId !== PRIMARY_SESSION_ID) {
      setComparisonSessions((prev) =>
        prev.map((s) =>
          s.id === sourceId ? { ...s, selectedLapNum: lapNum } : s,
        ),
      );
    }
  };

  // Save sync config on change
  useEffect(() => {
    if (!currentSessionKeyRef.current) return;
    const hasExisting = localStorage.getItem(currentSessionKeyRef.current) !== null;
    if (syncOffset !== 0 || speedScale !== 1.0 || hasExisting) {
      localStorage.setItem(
        currentSessionKeyRef.current,
        JSON.stringify({ syncOffset, speedScale }),
      );
    }
  }, [syncOffset, speedScale]);

  // Real-time animation loop for high-frequency telemetry gauge updates (60 FPS)
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = -1;

    const updateInterpolatedTelemetry = () => {
      if (
        !videoRef.current ||
        pendingMainSeekRef.current !== null ||
        !localTelemetry?.rows ||
        localTelemetry.rows.length === 0
      ) {
        animationFrameId = requestAnimationFrame(updateInterpolatedTelemetry);
        return;
      }

      const localVideoTime = videoRef.current.currentTime;
      const globalVideoTime =
        videoDurations.slice(0, activeVideoIndex).reduce((a, b) => a + b, 0) +
        localVideoTime;

      // OPTIMIZATION: Only update states and trigger re-renders if the video play clock actually advanced
      if (globalVideoTime !== lastTime) {
        lastTime = globalVideoTime;
        setCurrentTime(globalVideoTime);

        // Align telemetry timestamp and apply time scaling (playback speed scaling)
        const telemetryTime = (globalVideoTime - syncOffset) * speedScale;
        const rows = localTelemetry.rows;

        // Binary search for surrounding logs
        let low = 0;
        let high = rows.length - 1;
        let matchIdx = -1;

        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          if (rows[mid].time === telemetryTime) {
            matchIdx = mid;
            break;
          } else if (rows[mid].time < telemetryTime) {
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }

        if (matchIdx !== -1) {
          const match = rows[matchIdx];
          setCurrentTelemetry({
            speed: Number(match.speed) || 0,
            rpm: Number(match.rpm) || 0,
            latAcc: Number(match.latAcc) || 0,
            lonAcc: Number(match.lonAcc) || 0,
            lat: Number(match.lat) || 0,
            lon: Number(match.lon) || 0,
            lap: Number.isFinite(Number(match.lap)) ? Number(match.lap) : 1,
            distance: Number((match as any).distance) || 0,
          });
        } else {
          // `low` is the first index where rows[low].time >= telemetryTime after binary search
          const idxB = Math.min(low, rows.length - 1);
          const idxA = Math.max(0, idxB - 1);

          const rowA = rows[idxA];
          const rowB = rows[idxB];

          if (rowA && rowB) {
            const tA = rowA.time;
            const tB = rowB.time;

            let fraction = 0;
            if (tB !== tA) {
              fraction = Math.max(
                0,
                Math.min(1, (telemetryTime - tA) / (tB - tA)),
              );
            }

            const lapRow =
              low >= rows.length ||
              (tB - telemetryTime <= 1e-4 && telemetryTime >= tA)
                ? rowB
                : rowA;

            setCurrentTelemetry({
              speed: isNaN(rowA.speed + fraction * (rowB.speed - rowA.speed))
                ? 0
                : rowA.speed + fraction * (rowB.speed - rowA.speed),
              rpm: isNaN(rowA.rpm + fraction * (rowB.rpm - rowA.rpm))
                ? 0
                : rowA.rpm + fraction * (rowB.rpm - rowA.rpm),
              latAcc: isNaN(
                rowA.latAcc + fraction * (rowB.latAcc - rowA.latAcc),
              )
                ? 0
                : rowA.latAcc + fraction * (rowB.latAcc - rowA.latAcc),
              lonAcc: isNaN(
                rowA.lonAcc + fraction * (rowB.lonAcc - rowA.lonAcc),
              )
                ? 0
                : rowA.lonAcc + fraction * (rowB.lonAcc - rowA.lonAcc),
              lat: isNaN(rowA.lat + fraction * (rowB.lat - rowA.lat))
                ? 0
                : rowA.lat + fraction * (rowB.lat - rowA.lat),
              lon: isNaN(rowA.lon + fraction * (rowB.lon - rowA.lon))
                ? 0
                : rowA.lon + fraction * (rowB.lon - rowA.lon),
              lap: Number.isFinite(Number(lapRow.lap)) ? Number(lapRow.lap) : 1,
              distance: isNaN(
                rowA.distance + fraction * (rowB.distance - rowA.distance),
              )
                ? 0
                : rowA.distance + fraction * (rowB.distance - rowA.distance),
            });
          }
        }
      }

      animationFrameId = requestAnimationFrame(updateInterpolatedTelemetry);
    };

    animationFrameId = requestAnimationFrame(updateInterpolatedTelemetry);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    localTelemetry,
    syncOffset,
    speedScale,
    activeVideoIndex,
    videoDurations,
  ]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted, activeVideoIndex]);

  // Prevent closing the tab during export
  useEffect(() => {
    if (!isExporting) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        "Render in progress. Are you sure you want to close this page?";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isExporting]);

  useEffect(() => {
    return () => {
      if (exportCancelTimerRef.current !== null) {
        window.clearTimeout(exportCancelTimerRef.current);
        exportCancelTimerRef.current = null;
      }
      exportWorkerRef.current?.terminate();
      exportWorkerRef.current = null;
    };
  }, []);

  // Video play controllers
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((err) => console.error("Error playing video:", err));
    }
  };

  const interactionCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    try {
      if (isDefaultLayoutConfig(layoutConfig)) {
        window.localStorage.removeItem(HUD_LAYOUT_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          HUD_LAYOUT_STORAGE_KEY,
          JSON.stringify(layoutConfig),
        );
      }
    } catch {
      return;
    }
  }, [layoutConfig]);

  useEffect(() => {
    return () => {
      interactionCleanupRef.current?.();
      interactionCleanupRef.current = null;
    };
  }, []);

  const isDefaultLayout = useMemo(
    () => isDefaultLayoutConfig(layoutConfig),
    [layoutConfig],
  );

  const handleResetLayout = () => {
    setLayoutConfig(createDefaultLayoutConfig());
  };

  const handleWidgetDragStart = (
    e: React.PointerEvent<HTMLDivElement>,
    widgetId: WidgetId,
  ) => {
    if (!isEditMode || e.button !== 0) return;
    const overlayRect = overlayStageRef.current?.getBoundingClientRect();
    const widgetRect = e.currentTarget.getBoundingClientRect();
    if (
      !overlayRect ||
      overlayRect.width <= 0 ||
      overlayRect.height <= 0 ||
      widgetRect.width <= 0 ||
      widgetRect.height <= 0
    ) {
      return;
    }

    e.preventDefault();
    interactionCleanupRef.current?.();

    const offsetX = e.clientX - widgetRect.left;
    const offsetY = e.clientY - widgetRect.top;
    const widgetWPct = (widgetRect.width / overlayRect.width) * 100;
    const widgetHPct = (widgetRect.height / overlayRect.height) * 100;
    const maxXPct = Math.max(0, 100 - widgetWPct);
    const maxYPct = Math.max(0, 100 - widgetHPct);

    const handlePointerMove = (ev: PointerEvent) => {
      const rawXPct =
        ((ev.clientX - overlayRect.left - offsetX) / overlayRect.width) * 100;
      const rawYPct =
        ((ev.clientY - overlayRect.top - offsetY) / overlayRect.height) * 100;
      const xPct = Math.max(0, Math.min(maxXPct, rawXPct));
      const yPct = Math.max(0, Math.min(maxYPct, rawYPct));

      setLayoutConfig((prev) => ({
        ...prev,
        [widgetId]: {
          ...prev[widgetId],
          x: parseFloat(xPct.toFixed(1)),
          y: parseFloat(yPct.toFixed(1)),
        },
      }));
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      if (interactionCleanupRef.current === cleanup) {
        interactionCleanupRef.current = null;
      }
    };

    interactionCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  };

  const handleWidgetResizeStart = (
    e: React.PointerEvent<HTMLButtonElement>,
    widgetId: WidgetId,
    corner: ResizeCorner,
  ) => {
    if (!isEditMode || e.button !== 0) return;
    const overlayRect = overlayStageRef.current?.getBoundingClientRect();
    const widgetEl = e.currentTarget.parentElement;
    const widgetRect = widgetEl?.getBoundingClientRect();
    if (
      !overlayRect ||
      overlayRect.width <= 0 ||
      overlayRect.height <= 0 ||
      !widgetRect ||
      widgetRect.width <= 0 ||
      widgetRect.height <= 0
    ) {
      return;
    }

    e.preventDefault();
    interactionCleanupRef.current?.();
    setResizingWidgetId(widgetId);

    const startConfig = layoutConfig[widgetId];
    const def = DEFAULT_LAYOUT_CONFIG[widgetId];
    const startX = startConfig.x;
    const startY = startConfig.y;
    const startW = startConfig.w;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startRenderedHPct = (widgetRect.height / overlayRect.height) * 100;
    const hPerW = startRenderedHPct / startW;
    const configHPerW = def.h / def.w;
    const dirX = corner === "ne" || corner === "se" ? 1 : -1;
    const dirY = corner === "sw" || corner === "se" ? 1 : -1;
    const anchorX = dirX > 0 ? startX : startX + startW;
    const anchorY = dirY > 0 ? startY : startY + startRenderedHPct;
    const minW = def.w * MIN_WIDGET_SCALE;
    const maxW = Math.min(100, def.w * MAX_WIDGET_SCALE);
    const denom =
      widgetRect.width * widgetRect.width +
      widgetRect.height * widgetRect.height;

    const maxWByX = dirX > 0 ? 100 - anchorX : anchorX;
    const maxWByY = (dirY > 0 ? 100 - anchorY : anchorY) / hPerW;
    const upperW = Math.max(minW, Math.min(maxW, maxWByX, maxWByY));

    const handlePointerMove = (ev: PointerEvent) => {
      const dxPx = ev.clientX - startClientX;
      const dyPx = ev.clientY - startClientY;
      const scale =
        1 +
        (dxPx * dirX * widgetRect.width + dyPx * dirY * widgetRect.height) /
          denom;
      const rawW = startW * scale;
      const clampedW = Math.max(minW, Math.min(upperW, rawW));
      const clampedRenderedH = clampedW * hPerW;
      const clampedConfigH = clampedW * configHPerW;
      const newX = dirX > 0 ? anchorX : anchorX - clampedW;
      const newY = dirY > 0 ? anchorY : anchorY - clampedRenderedH;

      setLayoutConfig((prev) => ({
        ...prev,
        [widgetId]: {
          ...prev[widgetId],
          x: Math.max(0, parseFloat(newX.toFixed(1))),
          y: Math.max(0, parseFloat(newY.toFixed(1))),
          w: parseFloat(clampedW.toFixed(1)),
          h: parseFloat(clampedConfigH.toFixed(1)),
        },
      }));
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      if (interactionCleanupRef.current === cleanup) {
        interactionCleanupRef.current = null;
      }
      setResizingWidgetId(null);
    };

    interactionCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  };

  const seekMainVideoGlobal = (globalTime: number) => {
    const clamped = Math.max(0, Math.min(videoDuration || globalTime, globalTime));
    setCurrentTime(clamped);
    if (videoUrls.length === 0) return;

    const { index, localTime } = resolveVideoClipPosition(clamped, videoDurations);
    if (index !== activeVideoIndex) {
      pendingMainSeekRef.current = { time: localTime, autoPlay: isPlaying };
      setActiveVideoIndex(index);
    } else if (videoRef.current) {
      if (pendingMainSeekRef.current !== null && videoRef.current.readyState < 1) {
        pendingMainSeekRef.current = { time: localTime, autoPlay: isPlaying };
      } else {
        pendingMainSeekRef.current = null;
        videoRef.current.currentTime = localTime;
      }
    }
  };

  const getLapVideoBounds = (lapNum: number) => {
    const safeScale = speedScale > 0 ? speedScale : 1.0;
    const telStart =
      lapTimes.starts[lapNum] ??
      localTelemetry?.rows.find((r) => r.lap === lapNum)?.time ??
      0;
    const lapIdx = telemetryLaps.indexOf(lapNum);
    const nextLapNum =
      lapIdx !== -1 && lapIdx + 1 < telemetryLaps.length
        ? telemetryLaps[lapIdx + 1]
        : undefined;
    const nextLapStart =
      nextLapNum !== undefined
        ? (lapTimes.starts[nextLapNum] ??
          localTelemetry?.rows.find((r) => r.lap === nextLapNum)?.time)
        : undefined;
    const telEnd =
      nextLapStart ??
      lapTimes.ends[lapNum] ??
      telStart + (lapTimes.laps[lapNum] || 0);

    const rawStart = telStart / safeScale + syncOffset;
    const rawEnd = telEnd / safeScale + syncOffset;
    const isOutOfRange =
      videoDuration > 0 && (rawEnd <= 0 || rawStart >= videoDuration);
    const maxDur = videoDuration > 0 ? videoDuration : Math.max(0, rawEnd);
    const clampedStart = Math.max(0, Math.min(maxDur, rawStart));
    const clampedEnd = Math.max(clampedStart, Math.min(maxDur, rawEnd));

    return { rawStart, rawEnd, clampedStart, clampedEnd, isOutOfRange };
  };

  const handleSeekToVideoLap = (lapNum: number) => {
    if (!localTelemetry?.rows || localTelemetry.rows.length === 0) return;
    const { rawStart, rawEnd } = getLapVideoBounds(lapNum);
    const lapSpan = rawEnd - rawStart;
    const nudge = lapSpan > 0 ? Math.min(0.05, lapSpan / 2) : 0.05;
    const targetVideoTime = rawStart + nudge;
    const clamped = Math.max(
      0,
      Math.min(videoDuration || targetVideoTime, targetVideoTime),
    );
    seekMainVideoGlobal(clamped);
  };

  const seekModalVideo = (globalTime: number) => {
    const clamped = Math.max(0, Math.min(videoDuration || globalTime, globalTime));
    setModalVideoTime(clamped);
    if (videoUrls.length === 0) return;

    const { index, localTime } = resolveVideoClipPosition(clamped, videoDurations);
    if (index !== modalActiveVideoIndex) {
      pendingModalSeekRef.current = localTime;
      setModalActiveVideoIndex(index);
    } else if (modalVideoRef.current) {
      modalVideoRef.current.currentTime = localTime;
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === videoContainerRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSyncModalOpen || isExportModalOpen || isExporting) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (videoUrls.length === 0 || !videoRef.current) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (videoRef.current.paused) {
          videoRef.current
            .play()
            .then(() => setIsPlaying(true))
            .catch((err) => console.error("Error playing video:", err));
        } else {
          videoRef.current.pause();
          setIsPlaying(false);
        }
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const delta = e.key === "ArrowUp" ? 0.05 : -0.05;
        const currentVol = videoRef.current.muted ? 0 : videoRef.current.volume;
        const next = Math.max(
          0,
          Math.min(1, Math.round((currentVol + delta) * 100) / 100),
        );
        setVolume(next);
        setIsMuted(next === 0);
        return;
      }

      let seekDelta: number | null = null;
      if (e.key === "ArrowLeft") {
        seekDelta = e.shiftKey ? -10 : -3;
      } else if (e.key === "ArrowRight") {
        seekDelta = e.shiftKey ? 10 : 3;
      } else if (e.key === ",") {
        seekDelta = -1 / 60;
      } else if (e.key === ".") {
        seekDelta = 1 / 60;
      }

      if (seekDelta === null) return;

      e.preventDefault();
      const currentGlobal =
        videoDurations.slice(0, activeVideoIndex).reduce((a, b) => a + b, 0) +
        videoRef.current.currentTime;
      const clamped = Math.max(
        0,
        Math.min(videoDuration || currentGlobal + seekDelta, currentGlobal + seekDelta),
      );
      setCurrentTime(clamped);

      const { index, localTime } = resolveVideoClipPosition(
        clamped,
        videoDurations,
      );
      if (index !== activeVideoIndex) {
        pendingMainSeekRef.current = {
          time: localTime,
          autoPlay: !videoRef.current.paused,
        };
        setActiveVideoIndex(index);
      } else {
        videoRef.current.currentTime = localTime;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    videoUrls.length,
    videoDurations,
    videoDuration,
    activeVideoIndex,
    isSyncModalOpen,
    isExportModalOpen,
    isExporting,
  ]);

  // Telemetry Sync Wizard open trigger
  const handleOpenSyncWizard = () => {
    const localVideoTime = videoRef.current ? videoRef.current.currentTime : 0;
    const globalVideoTime =
      videoDurations.slice(0, activeVideoIndex).reduce((a, b) => a + b, 0) +
      localVideoTime;

    setModalActiveVideoIndex(activeVideoIndex);
    setModalVideoTime(globalVideoTime);
    pendingModalSeekRef.current = localVideoTime;

    if (localTelemetry?.rows && localTelemetry.rows.length > 0) {
      if (syncOffset !== 0 || speedScale !== 1.0) {
        seekToTelemetryTime(Math.max(0, (globalVideoTime - syncOffset) * speedScale));
      } else {
        setModalTelemetryIdx(firstLaunchIdx);
      }
    } else {
      setModalTelemetryIdx(0);
    }

    setIsSyncModalOpen(true);
    setIsPlaying(false);
    if (videoRef.current) videoRef.current.pause();
  };

  // Lock and apply sync wizard values
  //
  // The sync model is: telemetryTime = (videoTime - offset) * scale
  // For 1-point sync: offset = videoTime - telemetryTime / scale, scale stays unchanged.
  const handleApplySyncWizard = () => {
    if (!localTelemetry?.rows || localTelemetry.rows.length === 0) return;

    const telRow =
      localTelemetry.rows[
        Math.min(modalTelemetryIdx, localTelemetry.rows.length - 1)
      ];
    const safeScale = speedScale > 0 ? speedScale : 1.0;
    const computedOffset = modalVideoTime - telRow.time / safeScale;
    setSyncOffset(parseFloat(computedOffset.toFixed(4)));
    seekMainVideoGlobal(modalVideoTime);
    setIsSyncModalOpen(false);
  };

  const seekExportPreview = (globalTime: number) => {
    const clamped = Math.max(0, Math.min(videoDuration || globalTime, globalTime));
    setExportPreviewTime(clamped);
    if (videoUrls.length === 0 || videoDurations.length === 0) return;

    const { index, localTime } = resolveVideoClipPosition(
      clamped,
      videoDurations,
    );

    if (index !== exportActiveVideoIndex) {
      setExportActiveVideoIndex(index);
      if (exportPreviewVideoRef.current) {
        exportPreviewVideoRef.current.src = videoUrls[index];
        exportPreviewVideoRef.current.currentTime = localTime;
      }
    } else if (exportPreviewVideoRef.current) {
      exportPreviewVideoRef.current.currentTime = localTime;
    }
  };

  const applyExportLapRange = (
    startLap: number,
    endLap: number,
    anchorLap: number | null = null,
  ) => {
    const lo = Math.min(startLap, endLap);
    const hi = Math.max(startLap, endLap);
    const startBounds = getLapVideoBounds(lo);
    const endBounds = getLapVideoBounds(hi);
    const newStart = parseFloat(startBounds.clampedStart.toFixed(2));
    const newEnd = parseFloat(
      Math.max(newStart, endBounds.clampedEnd).toFixed(2),
    );

    setExportStartLap(lo);
    setExportEndLap(hi);
    setExportRangeAnchorLap(anchorLap);
    setExportStart(newStart);
    setExportEnd(newEnd);
    seekExportPreview(newStart);
  };

  const handleResetExportFullVideo = () => {
    setExportStartLap(null);
    setExportEndLap(null);
    setExportRangeAnchorLap(null);
    setExportStart(0);
    setExportEnd(videoDuration);
    seekExportPreview(0);
  };

  const handleExportLapPillClick = (lapNum: number) => {
    if (exportRangeAnchorLap !== null && exportRangeAnchorLap !== lapNum) {
      applyExportLapRange(exportRangeAnchorLap, lapNum, null);
    } else {
      applyExportLapRange(lapNum, lapNum, lapNum);
    }
  };

  const cleanupExportWorker = () => {
    if (exportCancelTimerRef.current !== null) {
      window.clearTimeout(exportCancelTimerRef.current);
      exportCancelTimerRef.current = null;
    }
    if (exportWorkerRef.current) {
      exportWorkerRef.current.terminate();
      exportWorkerRef.current = null;
    }
    setActiveExportInfo(null);
    setHasRenderedExportFrame(false);
    setIsFinalizingExport(false);
    setIsExporting(false);
  };

  const handleStopAndSaveExport = () => {
    const worker = exportWorkerRef.current;
    if (!worker || isFinalizingExport) return;
    setIsFinalizingExport(true);
    worker.postMessage({ type: "stop-and-save" });
  };

  const handleCancelExport = () => {
    const worker = exportWorkerRef.current;
    if (!worker) {
      cleanupExportWorker();
      return;
    }
    worker.postMessage({ type: "cancel" });
    if (exportCancelTimerRef.current !== null) {
      window.clearTimeout(exportCancelTimerRef.current);
    }
    exportCancelTimerRef.current = window.setTimeout(() => {
      cleanupExportWorker();
    }, 2500);
  };

  const handleExportVideo = async () => {
    if (!videoRef.current || !localTelemetry || videoFiles.length === 0) {
      setUploadError("Please load both GoPro POV video and CSV Telemetry data first!");
      return;
    }

    const isAlphaOverlay = exportMode === "overlay-alpha";
    const preferredContainer: ExportContainer = isAlphaOverlay
      ? "webm"
      : canEncodeMp4
        ? "mp4"
        : "webm";

    let fileHandle: FileSystemFileHandle | undefined;
    const pickerWindow =
      typeof window !== "undefined" ? (window as WindowWithSavePicker) : null;

    if (pickerWindow && typeof pickerWindow.showSaveFilePicker === "function") {
      try {
        fileHandle = await pickerWindow.showSaveFilePicker({
          suggestedName: isAlphaOverlay
            ? "hud_overlay.webm"
            : `overlay_render.${preferredContainer}`,
          types: isAlphaOverlay
            ? [
                {
                  description: "Transparent WebM Video (VP9 Alpha)",
                  accept: { "video/webm": [".webm"] },
                },
              ]
            : preferredContainer === "mp4"
              ? [
                  {
                    description: "MP4 Video",
                    accept: { "video/mp4": [".mp4"] },
                  },
                ]
              : [
                  {
                    description: "WebM Video",
                    accept: { "video/webm": [".webm"] },
                  },
                ],
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        fileHandle = undefined;
      }
    }

    setIsExportModalOpen(false);
    cleanupExportWorker();

    setUploadError("");
    setIsExporting(true);
    setExportProgress(0);
    setHasRenderedExportFrame(false);
    setIsFinalizingExport(false);
    setActiveExportInfo(null);
    setIsPlaying(false);
    videoRef.current.pause();

    const canvasWidth =
      sourceVideoProfile?.width || videoRef.current.videoWidth || 1280;
    const canvasHeight =
      sourceVideoProfile?.height || videoRef.current.videoHeight || 720;
    const actualStart = exportStart;
    const actualEnd = exportEnd > 0 ? exportEnd : videoDuration;

    const worker = new Worker(new URL("../workers/exportWorker.ts", import.meta.url));
    exportWorkerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data?.type === "info") {
        setActiveExportInfo(data.info as ExportEncodingInfo);
      } else if (data?.type === "finalizing") {
        setIsFinalizingExport(true);
      } else if (data?.type === "progress") {
        setHasRenderedExportFrame(true);
        setExportProgress(data.percent);
        if (data.previewBitmap) {
          const bitmap = data.previewBitmap as ImageBitmap;
          if (previewCanvasRef.current) {
            const pCtx = previewCanvasRef.current.getContext("2d");
            if (pCtx) {
              pCtx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
              pCtx.drawImage(
                bitmap,
                0,
                0,
                previewCanvasRef.current.width,
                previewCanvasRef.current.height,
              );
            }
          }
          bitmap.close();
        }
      } else if (data?.type === "cancelled") {
        if (exportWorkerRef.current === worker) {
          cleanupExportWorker();
        }
      } else if (data?.type === "done") {
        const { buffer, mimeType, fileExt, savedToDisk } = data as {
          buffer?: ArrayBuffer;
          mimeType: string;
          fileExt: string;
          savedToDisk?: boolean;
        };
        if (!savedToDisk && buffer) {
          const blob = new Blob([buffer], { type: mimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = isAlphaOverlay
            ? "hud_overlay.webm"
            : `overlay_render.${fileExt}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
        if (exportWorkerRef.current === worker) {
          cleanupExportWorker();
        }
      } else if (data?.type === "error") {
        setUploadError(data.message || "Video export failed.");
        if (exportWorkerRef.current === worker) {
          cleanupExportWorker();
        }
      }
    };

    worker.onerror = (err) => {
      setUploadError(err.message || "Export worker encountered an unexpected error.");
      if (exportWorkerRef.current === worker) {
        cleanupExportWorker();
      }
    };

    worker.postMessage({
      type: "init",
      payload: {
        videoFiles,
        telemetryRows: localTelemetry.rows,
        layoutConfig,
        lapTimesStarts: lapTimes.starts,
        lapTimesLaps: lapTimes.laps,
        lapTimesStartDistances: lapTimes.startDistances,
        lapTimesDistances: lapTimes.lapDistances,
        bestLapNum: bestLapInfo.lap,
        bestLapRows,
        gpsPoints,
        startFinishCoord,
        maxSpeed: telemetryMaxSpeed,
        maxRpm: telemetryMaxRpm,
        telemetryLaps,
        syncOffset,
        speedScale,
        exportStart: actualStart,
        exportEnd: actualEnd,
        canvasWidth,
        canvasHeight,
        videoDurations,
        exportMode,
        exportQuality,
        preferredContainer: fileHandle ? preferredContainer : null,
        sourceProfile: sourceVideoProfile,
        fileHandle,
        referenceLap: activeReferenceLap,
        showGhostOnMap,
      },
    });
  };

  // Get active telemetry row details for wizard UI
  const wizardTelemetryRow = useMemo(() => {
    if (!localTelemetry?.rows || localTelemetry.rows.length === 0) return null;
    return localTelemetry.rows[
      Math.min(modalTelemetryIdx, localTelemetry.rows.length - 1)
    ];
  }, [localTelemetry, modalTelemetryIdx]);

  const primaryRacerName = useMemo(
    () =>
      sanitizeDisplayLabel(
        localTelemetry?.metadata["Racer"] ||
          localTelemetry?.metadata["Driver"] ||
          "",
        40,
      ),
    [localTelemetry],
  );

  const primarySessionName = useMemo(
    () => sanitizeDisplayLabel(localTelemetry?.metadata["Session"] || "", 40),
    [localTelemetry],
  );

  const primaryHasGps = gpsPoints.length >= 5;
  const selectedSourceId = comparisonSelection.sourceId;
  const selectedPrimaryLapNum =
    selectedSourceId === PRIMARY_SESSION_ID ? comparisonSelection.lapNum : null;

  const primaryReferenceLap = useMemo(() => {
    if (!localTelemetry?.rows) return null;
    return buildReferenceLapTarget({
      sourceId: PRIMARY_SESSION_ID,
      isPrimarySession: true,
      racerName: primaryRacerName || "You",
      accentColor: PRIMARY_REFERENCE_ACCENT,
      rows: localTelemetry.rows,
      analysis: primaryLapAnalysis,
      requestedLapNum: selectedPrimaryLapNum,
      trackCompatible: primaryHasGps,
    });
  }, [
    localTelemetry,
    primaryRacerName,
    primaryLapAnalysis,
    selectedPrimaryLapNum,
    primaryHasGps,
  ]);

  const sessionReferenceTargets = useMemo(() => {
    const map: Record<string, ReferenceLapTarget | null> = {};
    for (const session of comparisonSessions) {
      map[session.id] = buildReferenceLapTarget({
        sourceId: session.id,
        isPrimarySession: false,
        racerName: session.racerName,
        accentColor: session.color,
        rows: session.telemetry.rows,
        analysis: session.analysis,
        requestedLapNum: session.selectedLapNum,
        trackCompatible: session.trackCompatible,
      });
    }
    return map;
  }, [comparisonSessions]);

  const activeReferenceLap =
    selectedSourceId === PRIMARY_SESSION_ID
      ? primaryReferenceLap
      : (sessionReferenceTargets[selectedSourceId] ?? null);

  const currentTelemetryTime = useMemo(() => {
    return (currentTime - syncOffset) * speedScale;
  }, [currentTime, syncOffset, speedScale]);

  const currentLapElapsed = useMemo(() => {
    const start = lapTimes.starts[currentTelemetry.lap] || 0;
    return Math.max(0, currentTelemetryTime - start);
  }, [lapTimes, currentTelemetry.lap, currentTelemetryTime]);

  const activeComparisonMetric = useMemo(() => {
    const elapsedDist =
      currentTelemetry.distance -
      (lapTimes.startDistances[currentTelemetry.lap] || 0);
    const currentLapTotalDist =
      lapTimes.lapDistances[currentTelemetry.lap] || 0;
    return evaluateReferenceAtProgress(
      activeReferenceLap,
      currentTelemetry.lap,
      telemetryLaps,
      currentLapElapsed,
      elapsedDist,
      currentLapTotalDist,
    );
  }, [
    activeReferenceLap,
    currentTelemetry.lap,
    currentTelemetry.distance,
    currentLapElapsed,
    lapTimes,
    telemetryLaps,
  ]);

  const ghostCoord = useMemo(() => {
    if (!showGhostOnMap) return null;
    return evaluateGhostPosition(
      activeReferenceLap,
      currentTelemetry.lap,
      telemetryLaps,
      currentLapElapsed,
    );
  }, [
    showGhostOnMap,
    activeReferenceLap,
    currentTelemetry.lap,
    telemetryLaps,
    currentLapElapsed,
  ]);

  const sessionLiveMetrics = useMemo(() => {
    const metrics: Record<string, LiveComparisonMetric> = {};
    const elapsedDist =
      currentTelemetry.distance -
      (lapTimes.startDistances[currentTelemetry.lap] || 0);
    const currentLapTotalDist =
      lapTimes.lapDistances[currentTelemetry.lap] || 0;

    for (const session of comparisonSessions) {
      metrics[session.id] = evaluateReferenceAtProgress(
        sessionReferenceTargets[session.id] ?? null,
        currentTelemetry.lap,
        telemetryLaps,
        currentLapElapsed,
        elapsedDist,
        currentLapTotalDist,
      );
    }
    return metrics;
  }, [
    comparisonSessions,
    sessionReferenceTargets,
    currentTelemetry.lap,
    currentTelemetry.distance,
    currentLapElapsed,
    lapTimes,
    telemetryLaps,
  ]);

  const effectiveExportEnd =
    exportEnd === 0 && videoDuration > 0 ? videoDuration : exportEnd;

  const isExportFullVideo =
    exportStartLap === null &&
    exportStart === 0 &&
    (videoDuration === 0 || Math.abs(effectiveExportEnd - videoDuration) < 0.05);

  const exportLapEntries = telemetryLaps.map((lapNum) => {
    const bounds = getLapVideoBounds(lapNum);
    const lapDur = lapTimes.laps[lapNum] || 0;
    const isBest = bestLapInfo.lap === lapNum;
    const optionLabel =
      lapNum === 0
        ? "Out Lap"
        : `Lap ${lapNum}${lapDur > 0 ? ` (${formatLapTime(lapDur)})` : ""}${isBest ? " ★ Best" : ""}`;
    return {
      lapNum,
      lapDur,
      isBest,
      isOutOfRange: bounds.isOutOfRange,
      optionLabel,
    };
  });

  const bestLapExportEntry = exportLapEntries.find((entry) => entry.isBest);
  const canSelectBestLapExport = Boolean(
    bestLapExportEntry && !bestLapExportEntry.isOutOfRange,
  );
  const isBestLapExportSelected =
    canSelectBestLapExport &&
    exportStartLap === bestLapInfo.lap &&
    exportEndLap === bestLapInfo.lap;

  let exportRangeStatusLabel = "Custom Trim";
  if (exportStartLap !== null && exportEndLap !== null) {
    const startLabel = exportStartLap === 0 ? "Out" : `L${exportStartLap}`;
    const endLabel = exportEndLap === 0 ? "Out" : `L${exportEndLap}`;
    exportRangeStatusLabel =
      exportStartLap === exportEndLap
        ? exportStartLap === 0
          ? "Out Lap"
          : `Lap ${exportStartLap}`
        : `${startLabel} → ${endLabel}`;
  } else if (isExportFullVideo) {
    exportRangeStatusLabel = "Full Video";
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full max-w-7xl px-4 py-6 text-zinc-100 select-none relative">
      {/* EXPORT TRIM PREVIEW MODAL */}
      {isExportModalOpen && videoUrls.length > 0 && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto overscroll-contain animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[calc(100dvh-2rem)] my-auto">
            <div className="shrink-0 flex justify-between items-center px-6 py-4 border-b border-zinc-800">
              <div className="flex flex-col">
                <div className="flex items-center space-x-2">
                  <Video className="text-cyan-400" size={18} />
                  <h3 className="text-sm font-black uppercase tracking-wider text-zinc-100">
                    Trim & Render Overlay Video
                  </h3>
                  {sourceVideoProfile && (
                    <span className="hidden sm:inline-flex items-center text-[9px] font-mono font-bold text-cyan-300 bg-cyan-400/10 border border-cyan-400/30 px-2 py-0.5 rounded-md">
                      {formatResolutionTag(sourceVideoProfile.width, sourceVideoProfile.height)}
                      {sourceVideoProfile.fps ? ` • ${Math.round(sourceVideoProfile.fps)}fps` : ""}
                      {sourceVideoProfile.codec ? ` • ${formatCodecLabel(sourceVideoProfile.codec)}` : ""}
                      {sourceVideoProfile.bitrate ? ` • ${formatBitrateMbps(sourceVideoProfile.bitrate)}` : ""}
                    </span>
                  )}
                </div>
                <p className="text-[9px] text-zinc-550 uppercase tracking-wider mt-0.5 ml-6 font-semibold">
                  Match original source quality or export a transparent HUD overlay for NLE compositing
                </p>
              </div>
              <button
                onClick={() => setIsExportModalOpen(false)}
                className="p-1 text-zinc-500 hover:text-zinc-300 rounded-lg transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-4">
              <div className="relative aspect-video rounded-2xl overflow-hidden border border-zinc-800 bg-black">
                <video
                  ref={exportPreviewVideoRef}
                  src={videoUrls[exportActiveVideoIndex]}
                  className="w-full h-full object-cover"
                  onTimeUpdate={() => {
                    if (exportPreviewVideoRef.current) {
                      const localTime =
                        exportPreviewVideoRef.current.currentTime;
                      const globalTime =
                        videoDurations
                          .slice(0, exportActiveVideoIndex)
                          .reduce((a, b) => a + b, 0) + localTime;
                      setExportPreviewTime(globalTime);
                    }
                  }}
                  onEnded={() => {
                    if (exportActiveVideoIndex < videoUrls.length - 1) {
                      const nextIdx = exportActiveVideoIndex + 1;
                      setExportActiveVideoIndex(nextIdx);
                      if (exportPreviewVideoRef.current) {
                        exportPreviewVideoRef.current.src = videoUrls[nextIdx];
                        exportPreviewVideoRef.current.currentTime = 0;
                        exportPreviewVideoRef.current
                          .play()
                          .catch((err) => console.error(err));
                      }
                    }
                  }}
                  controls
                />
              </div>

              <div className="flex flex-wrap justify-between items-center gap-2 text-xs font-mono text-zinc-400 bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-850">
                <div className="flex items-center space-x-1.5">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wide font-black">
                    Position:
                  </span>
                  <span className="text-cyan-400 font-bold">
                    {formatTimeMinutes(exportPreviewTime)}
                  </span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wide font-black">
                    Clip Length:
                  </span>
                  <span className="text-emerald-400 font-bold">
                    {formatTimeMinutes(
                      Math.max(
                        0,
                        (exportEnd === 0 && videoDuration > 0
                          ? videoDuration
                          : exportEnd) - exportStart,
                      ),
                    )}
                  </span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wide font-black">
                    Total Duration:
                  </span>
                  <span className="text-zinc-300 font-bold">
                    {formatTimeMinutes(videoDuration)}
                  </span>
                </div>
                {activeReferenceLap && (
                  <div className="flex items-center space-x-1.5">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: activeReferenceLap.accentColor }}
                    />
                    <span className="text-[10px] text-zinc-400 font-bold truncate max-w-52">
                      {activeReferenceLap.hudLabel}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col space-y-4 bg-zinc-950/40 border border-zinc-800/80 p-4 rounded-2xl">
                {localTelemetry && telemetryLaps.length > 0 && (
                  <div className="flex flex-col space-y-3 pb-3.5 border-b border-zinc-800/80">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <Flag size={11} className="text-cyan-400" />
                        <span className="text-[10px] text-zinc-400 font-black uppercase tracking-wider">
                          Lap Range Filter
                        </span>
                        <span className="text-[9px] font-mono font-bold text-cyan-400 bg-cyan-400/10 border border-cyan-400/30 px-2 py-0.5 rounded-md">
                          {exportRangeStatusLabel}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        {canSelectBestLapExport && (
                          <button
                            type="button"
                            onClick={() =>
                              applyExportLapRange(
                                bestLapInfo.lap,
                                bestLapInfo.lap,
                                null,
                              )
                            }
                            className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition cursor-pointer ${
                              isBestLapExportSelected
                                ? "bg-emerald-500/20 border-emerald-400 text-emerald-300"
                                : "bg-zinc-950 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                            }`}
                          >
                            Best Lap (L{bestLapInfo.lap})
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleResetExportFullVideo}
                          className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition cursor-pointer ${
                            isExportFullVideo
                              ? "bg-cyan-400/15 border-cyan-400/60 text-cyan-300"
                              : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                          }`}
                        >
                          Full Video
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <label className="flex flex-col space-y-1">
                        <span className="text-[9px] text-zinc-500 font-black uppercase tracking-wider">
                          Start Lap (From)
                        </span>
                        <select
                          value={exportStartLap ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === "") {
                              handleResetExportFullVideo();
                              return;
                            }
                            const nextStart = Number(raw);
                            if (
                              !Number.isFinite(nextStart) ||
                              !telemetryLaps.includes(nextStart)
                            ) {
                              return;
                            }
                            const nextEnd =
                              exportEndLap !== null
                                ? Math.max(nextStart, exportEndLap)
                                : nextStart;
                            applyExportLapRange(nextStart, nextEnd, null);
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-cyan-400/60 cursor-pointer"
                        >
                          <option value="">Custom / Manual</option>
                          {exportLapEntries.map((entry) => (
                            <option
                              key={entry.lapNum}
                              value={entry.lapNum}
                              disabled={entry.isOutOfRange}
                            >
                              {entry.optionLabel}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col space-y-1">
                        <span className="text-[9px] text-zinc-500 font-black uppercase tracking-wider">
                          End Lap (To)
                        </span>
                        <select
                          value={exportEndLap ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === "") {
                              handleResetExportFullVideo();
                              return;
                            }
                            const nextEnd = Number(raw);
                            if (
                              !Number.isFinite(nextEnd) ||
                              !telemetryLaps.includes(nextEnd)
                            ) {
                              return;
                            }
                            const nextStart =
                              exportStartLap !== null
                                ? Math.min(exportStartLap, nextEnd)
                                : nextEnd;
                            applyExportLapRange(nextStart, nextEnd, null);
                          }}
                          className="bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-cyan-400/60 cursor-pointer"
                        >
                          <option value="">Custom / Manual</option>
                          {exportLapEntries.map((entry) => (
                            <option
                              key={entry.lapNum}
                              value={entry.lapNum}
                              disabled={entry.isOutOfRange}
                            >
                              {entry.optionLabel}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 max-h-20 overflow-y-auto pr-1">
                      {exportLapEntries.map(
                        ({ lapNum, lapDur, isBest, isOutOfRange }) => {
                          const isBoundary =
                            exportStartLap !== null &&
                            exportEndLap !== null &&
                            (lapNum === exportStartLap ||
                              lapNum === exportEndLap);
                          const isInRange =
                            exportStartLap !== null &&
                            exportEndLap !== null &&
                            lapNum > exportStartLap &&
                            lapNum < exportEndLap;

                          return (
                            <button
                              key={lapNum}
                              type="button"
                              onClick={() => handleExportLapPillClick(lapNum)}
                              disabled={isOutOfRange}
                              title={
                                isOutOfRange
                                  ? "Outside video range"
                                  : isBest
                                    ? `Select Lap ${lapNum} (Best)`
                                    : lapNum === 0
                                      ? "Select Out Lap"
                                      : `Select Lap ${lapNum}`
                              }
                              className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border transition flex items-center space-x-1.5 ${
                                isOutOfRange
                                  ? "bg-zinc-950 border-zinc-800/60 text-zinc-600 opacity-40 cursor-not-allowed"
                                  : isBoundary
                                    ? "bg-cyan-400/20 border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.2)] cursor-pointer"
                                    : isInRange
                                      ? "bg-cyan-400/10 border-cyan-400/40 text-cyan-300/90 cursor-pointer"
                                      : isBest
                                        ? "bg-zinc-950 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                                        : "bg-zinc-950 border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 cursor-pointer"
                              }`}
                            >
                              <span>{lapNum === 0 ? "Out" : `L${lapNum}`}</span>
                              {lapNum >= 1 && lapDur > 0 && (
                                <span
                                  className={
                                    isBoundary || isInRange
                                      ? "text-cyan-200/80"
                                      : isBest
                                        ? "text-emerald-300/80"
                                        : "text-zinc-500"
                                  }
                                >
                                  {formatLapTime(lapDur)}
                                </span>
                              )}
                            </button>
                          );
                        },
                      )}
                    </div>

                    {exportRangeAnchorLap !== null && (
                      <p className="text-[9px] text-zinc-500 font-semibold">
                        Tip: Click another lap pill to extend the end of the
                        range
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-col space-y-3">
                  <div className="flex flex-col space-y-1">
                    <div className="flex justify-between items-center text-[10px] text-zinc-400 font-black uppercase">
                      <span>Export Start (Trim In):</span>
                      <span className="font-mono text-cyan-400 font-bold">
                        {formatTimeMinutes(exportStart)}
                      </span>
                    </div>
                    <div className="relative w-full h-6 flex items-center">
                      <div className="absolute w-full h-1 bg-zinc-800 rounded-lg" />
                      <div
                        className="absolute h-1 bg-cyan-400/35 border-l border-r border-cyan-400 rounded"
                        style={{
                          left:
                            videoDuration > 0
                              ? `${(exportStart / videoDuration) * 100}%`
                              : "0%",
                          width:
                            videoDuration > 0
                              ? `${(((exportEnd === 0 ? videoDuration : exportEnd) - exportStart) / videoDuration) * 100}%`
                              : "0%",
                        }}
                      />
                      <input
                        type="range"
                        min={0}
                        max={videoDuration || 100}
                        step={0.1}
                        value={exportStart}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          const effectiveEnd =
                            exportEnd === 0 && videoDuration > 0
                              ? videoDuration
                              : exportEnd;
                          const newStart = Math.min(val, effectiveEnd);
                          setExportStartLap(null);
                          setExportEndLap(null);
                          setExportRangeAnchorLap(null);
                          setExportStart(newStart);
                          seekExportPreview(newStart);
                        }}
                        className="w-full accent-cyan-400 h-1 bg-transparent rounded-lg appearance-none cursor-pointer z-10"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col space-y-1">
                    <div className="flex justify-between items-center text-[10px] text-zinc-400 font-black uppercase">
                      <span>Export End (Trim Out):</span>
                      <span className="font-mono text-cyan-400 font-bold">
                        {formatTimeMinutes(
                          exportEnd === 0 && videoDuration > 0
                            ? videoDuration
                            : exportEnd,
                        )}
                      </span>
                    </div>
                    <div className="relative w-full h-6 flex items-center">
                      <div className="absolute w-full h-1 bg-zinc-800 rounded-lg" />
                      <div
                        className="absolute h-1 bg-cyan-400/35 border-l border-r border-cyan-400 rounded"
                        style={{
                          left:
                            videoDuration > 0
                              ? `${(exportStart / videoDuration) * 100}%`
                              : "0%",
                          width:
                            videoDuration > 0
                              ? `${(((exportEnd === 0 ? videoDuration : exportEnd) - exportStart) / videoDuration) * 100}%`
                              : "0%",
                        }}
                      />
                      <input
                        type="range"
                        min={0}
                        max={videoDuration || 100}
                        step={0.1}
                        value={
                          exportEnd === 0 && videoDuration > 0
                            ? videoDuration
                            : exportEnd
                        }
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          const newEnd = Math.max(val, exportStart);
                          setExportStartLap(null);
                          setExportEndLap(null);
                          setExportRangeAnchorLap(null);
                          setExportEnd(newEnd);
                          seekExportPreview(newEnd);
                        }}
                        className="w-full accent-cyan-400 h-1 bg-transparent rounded-lg appearance-none cursor-pointer z-10"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col space-y-2.5 bg-zinc-950/40 border border-zinc-800/80 p-4 rounded-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-400 font-black uppercase tracking-wider flex items-center space-x-1.5">
                    <Layers size={11} className="text-cyan-400" />
                    <span>Output Mode</span>
                  </span>
                  <span className="text-[9px] font-mono text-zinc-500">
                    {exportMode === "overlay-alpha"
                      ? "WebM VP9 + Alpha • No Video Re-encode"
                      : exportQuality === "original"
                        ? "Matches Source Codec & Bitrate"
                        : "Hardware WebCodecs • Lossless Audio"}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setExportMode("composite")}
                    className={`text-left p-3 rounded-xl border transition cursor-pointer ${
                      exportMode === "composite"
                        ? "bg-cyan-400/10 border-cyan-400/60 text-zinc-100 shadow-[0_0_12px_rgba(34,211,238,0.12)]"
                        : "bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider">
                        Video + HUD
                      </span>
                      <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-cyan-400">
                        {canEncodeMp4 ? "MP4" : "WebM"}
                      </span>
                    </div>
                    <p className="text-[9px] text-zinc-400 mt-1 leading-relaxed">
                      Burns gauges onto your footage with lossless audio passthrough. Use Original to match source bitrate &amp; HEVC.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportMode("overlay-alpha")}
                    className={`text-left p-3 rounded-xl border transition cursor-pointer ${
                      exportMode === "overlay-alpha"
                        ? "bg-cyan-400/10 border-cyan-400/60 text-zinc-100 shadow-[0_0_12px_rgba(34,211,238,0.12)]"
                        : "bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider">
                        Transparent HUD Only
                      </span>
                      <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-900 border border-emerald-500/40 text-emerald-400">
                        Alpha WebM
                      </span>
                    </div>
                    <p className="text-[9px] text-zinc-400 mt-1 leading-relaxed">
                      Gauges on transparent background for DaVinci Resolve, Premiere &amp; Final Cut. Keeps original 10-bit/HDR footage untouched.
                    </p>
                  </button>
                </div>
              </div>
            </div>

            <div className="shrink-0 px-6 py-4 bg-zinc-950 border-t border-zinc-800 flex flex-wrap justify-between items-center gap-3 rounded-b-3xl">
              <div className="flex items-center space-x-2">
                <span className="text-[9px] text-zinc-500 uppercase font-black tracking-wider">Quality:</span>
                {exportMode === "composite" ? (
                  <div className="flex flex-wrap gap-1">
                    {(["standard", "high", "ultra", "original"] as const).map((q) => {
                      const originalBadge = sourceVideoProfile?.bitrate
                        ? `${Math.round(sourceVideoProfile.bitrate / 1_000_000)}Mb`
                        : "Match";
                      return (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setExportQuality(q)}
                          className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition cursor-pointer border ${
                            exportQuality === q
                              ? q === "original"
                                ? "bg-emerald-500/15 border-emerald-400/60 text-emerald-300"
                                : "bg-cyan-400/15 border-cyan-400/50 text-cyan-400"
                              : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                          }`}
                        >
                          {q === "standard"
                            ? "Standard"
                            : q === "high"
                              ? "High"
                              : q === "ultra"
                                ? "Ultra"
                                : "Original"}
                          <span className="ml-1 text-[7px] font-mono opacity-70">
                            {q === "standard"
                              ? "15Mb"
                              : q === "high"
                                ? "30Mb"
                                : q === "ultra"
                                  ? "50Mb"
                                  : originalBadge}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {(["standard", "high", "ultra"] as const).map((q) => {
                      const isActive =
                        exportQuality === q ||
                        (q === "ultra" && exportQuality === "original");
                      return (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setExportQuality(q)}
                          className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition cursor-pointer border ${
                            isActive
                              ? "bg-cyan-400/15 border-cyan-400/50 text-cyan-400"
                              : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                          }`}
                        >
                          {q === "standard" ? "Standard" : q === "high" ? "High" : "Ultra"}
                          <span className="ml-1 text-[7px] font-mono opacity-70">
                            {q === "standard" ? "10Mb" : q === "high" ? "20Mb" : "35Mb"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => setIsExportModalOpen(false)}
                  className="px-4 py-2 border border-zinc-850 hover:bg-zinc-900 text-zinc-300 font-extrabold text-[10px] uppercase tracking-wider rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleExportVideo();
                  }}
                  className="bg-cyan-400 hover:bg-cyan-500 text-zinc-950 font-black px-6 py-2 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer shadow-[0_0_15px_rgba(34,211,238,0.25)] flex items-center space-x-1.5"
                >
                  <Download size={12} />
                  <span>
                    {exportMode === "overlay-alpha"
                      ? "Export Transparent HUD"
                      : "Start GPU Render"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isExporting && (
        <div className="fixed inset-0 bg-zinc-950/95 flex items-center justify-center z-50 p-4 sm:p-6 overflow-y-auto overscroll-contain">
          <div className="p-6 bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-3xl text-center space-y-5 max-w-xl w-full max-h-[calc(100dvh-2rem)] overflow-y-auto my-auto shadow-2xl relative flex flex-col items-center">
            <div className="flex items-center space-x-3">
              <RefreshCw size={24} className="animate-spin text-cyan-400" />
              <div className="text-left">
                <h3 className="text-sm font-black uppercase tracking-wider text-zinc-100">
                  {activeExportInfo?.mode === "overlay-alpha"
                    ? "Exporting Transparent HUD Overlay"
                    : "Exporting Telemetry Overlay"}
                </h3>
                <p className="text-[10px] text-zinc-400 font-mono font-semibold tracking-wider mt-0.5">
                  {activeExportInfo
                    ? `${activeExportInfo.width}×${activeExportInfo.height} • ${formatCodecLabel(activeExportInfo.codec)}${activeExportInfo.mode === "overlay-alpha" ? " Alpha" : ""} • ${activeExportInfo.bitrate === "auto" ? "Auto High" : formatBitrateMbps(activeExportInfo.bitrate)}${activeExportInfo.streamingToDisk ? " • Direct to Disk" : ""}`
                    : "Initializing WebCodecs Hardware Render..."}
                </p>
              </div>
            </div>

            <div className="shrink-0 relative aspect-video w-full bg-zinc-950 rounded-2xl border border-zinc-850 overflow-hidden shadow-2xl flex items-center justify-center">
              <canvas
                ref={previewCanvasRef}
                width={640}
                height={360}
                className="w-full h-full object-contain"
              />
              <div className="absolute top-3 left-3 px-2 py-1 bg-black/70 backdrop-blur-md rounded-md border border-zinc-800 flex items-center space-x-1.5 pointer-events-none">
                <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse" />
                <span className="text-[8px] font-black tracking-wider uppercase text-zinc-300">
                  {activeExportInfo?.mode === "overlay-alpha"
                    ? "Transparent Alpha Preview"
                    : "Live Render Preview"}
                </span>
              </div>
            </div>

            <div className="w-full space-y-2">
              <div className="w-full bg-zinc-950 rounded-full h-2.5 overflow-hidden border border-zinc-850">
                <div
                  className="bg-cyan-500 h-full transition-all duration-300 shadow-[0_0_8px_#22d3ee]"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-xs font-mono font-bold text-zinc-400">
                <span>{exportProgress}% Completed</span>
                <span className="text-[10px] text-cyan-400 tracking-wider font-sans uppercase">
                  {isFinalizingExport
                    ? "Finalizing Video..."
                    : activeExportInfo?.streamingToDisk
                      ? "Streaming to Disk"
                      : "Active WebCodecs Render"}
                </span>
              </div>
            </div>

            <div className="p-3.5 bg-cyan-950/20 border border-cyan-900/40 rounded-2xl text-[10px] text-cyan-200/90 flex items-start space-x-2 text-left w-full">
              <span className="font-extrabold uppercase bg-cyan-400 text-zinc-950 px-1 rounded shrink-0">
                INFO
              </span>
              <span className="leading-relaxed">
                <strong>Keep this tab open until export completes.</strong>{" "}
                Rendering runs in a background WebCodecs worker so you can
                safely switch tabs while it encodes.
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 w-full">
              <button
                type="button"
                onClick={handleStopAndSaveExport}
                disabled={!hasRenderedExportFrame || isFinalizingExport}
                className="bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed border border-emerald-500/50 text-emerald-300 font-extrabold text-xs px-6 py-2.5 rounded-xl uppercase tracking-wider transition cursor-pointer flex items-center space-x-2"
              >
                <Download size={14} />
                <span>{isFinalizingExport ? "Finalizing..." : "Stop & Save So Far"}</span>
              </button>
              <button
                type="button"
                onClick={handleCancelExport}
                disabled={isFinalizingExport}
                className="bg-rose-950/40 hover:bg-rose-900/60 disabled:opacity-40 disabled:cursor-not-allowed border border-rose-800 text-rose-300 hover:text-rose-200 font-extrabold text-xs px-6 py-2.5 rounded-xl uppercase tracking-wider transition cursor-pointer flex items-center space-x-2"
              >
                <X size={14} />
                <span>Cancel &amp; Discard</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TELEMETRY SYNC WIZARD MODAL */}
      {isSyncModalOpen && localTelemetry && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto overscroll-contain">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[calc(100dvh-2rem)] my-auto">
            <div className="shrink-0 flex justify-between items-center px-6 py-4 border-b border-zinc-800">
              <div className="flex flex-col">
                <div className="flex items-center space-x-2">
                  <Sliders className="text-cyan-400" size={18} />
                  <h3 className="text-sm font-black uppercase tracking-wider text-zinc-100">
                    Telemetry Sync Wizard
                  </h3>
                </div>
                <p className="text-[9px] text-zinc-500 uppercase tracking-wider mt-0.5 ml-6">
                  Find the same identifiable moment in both video and telemetry
                  (gear shift, speed event, GPS position) — then apply.
                </p>
              </div>
              <button
                onClick={() => setIsSyncModalOpen(false)}
                className="p-1 text-zinc-500 hover:text-zinc-300 rounded-lg transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 overflow-y-auto overscroll-contain">
              {/* Left Panel (Col 4): Video Scanner */}
              <div className="md:col-span-4 p-6 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-col space-y-4">
                <h4 className="text-xs font-extrabold uppercase text-cyan-400 tracking-wider flex items-center space-x-1.5">
                  <Video size={12} />
                  <span>1. Align Video Position</span>
                </h4>

                <div className="aspect-video bg-black rounded-2xl overflow-hidden border border-zinc-800 flex items-center justify-center relative">
                  {videoUrls.length > 0 ? (
                    <>
                      <video
                        ref={modalVideoRef}
                        src={videoUrls[modalActiveVideoIndex]}
                        className="w-full h-full object-cover"
                        controls={false}
                        onLoadedMetadata={() => {
                          if (
                            modalVideoRef.current &&
                            pendingModalSeekRef.current !== null
                          ) {
                            modalVideoRef.current.currentTime =
                              pendingModalSeekRef.current;
                            pendingModalSeekRef.current = null;
                          }
                        }}
                        onTimeUpdate={() => {
                          if (modalVideoRef.current) {
                            const localTime = modalVideoRef.current.currentTime;
                            const globalTime =
                              videoDurations
                                .slice(0, modalActiveVideoIndex)
                                .reduce((a, b) => a + b, 0) + localTime;
                            setModalVideoTime(globalTime);
                          }
                        }}
                      />
                      {videoUrls.length > 1 && (
                        <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/75 border border-zinc-800 rounded text-[9px] font-mono font-bold text-cyan-400">
                          Clip {modalActiveVideoIndex + 1} / {videoUrls.length}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[10px] text-zinc-650 uppercase font-bold">
                      POV Video Not Loaded
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                    <span>Video Time:</span>
                    <span className="font-bold text-zinc-200">
                      {modalVideoTime.toFixed(3)}s
                    </span>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={videoDuration || 100}
                    step={0.01}
                    value={modalVideoTime}
                    onChange={(e) => seekModalVideo(parseFloat(e.target.value))}
                    className="w-full accent-cyan-400 h-1 bg-zinc-950 rounded-lg appearance-none cursor-pointer"
                  />

                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    <button
                      onClick={() => seekModalVideo(modalVideoTime - 1.0)}
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-855 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition cursor-pointer"
                    >
                      -1.0s
                    </button>
                    <button
                      onClick={() => seekModalVideo(modalVideoTime - 0.1)}
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-855 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition cursor-pointer"
                    >
                      -0.1s
                    </button>
                    <button
                      onClick={() => seekModalVideo(modalVideoTime - 1 / 60)}
                      className="bg-zinc-950 hover:bg-zinc-800 border border-zinc-850 text-[9px] px-1.5 py-1 rounded font-bold uppercase text-cyan-400 transition cursor-pointer"
                    >
                      -1 Frame
                    </button>
                    <button
                      onClick={() => seekModalVideo(modalVideoTime + 1 / 60)}
                      className="bg-zinc-950 hover:bg-zinc-800 border border-zinc-850 text-[9px] px-1.5 py-1 rounded font-bold uppercase text-cyan-400 transition cursor-pointer"
                    >
                      +1 Frame
                    </button>
                    <button
                      onClick={() => seekModalVideo(modalVideoTime + 0.1)}
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-855 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition cursor-pointer"
                    >
                      +0.1s
                    </button>
                    <button
                      onClick={() => seekModalVideo(modalVideoTime + 1.0)}
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-855 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition cursor-pointer"
                    >
                      +1.0s
                    </button>
                  </div>
                </div>
              </div>

              {/* Middle Panel (Col 4): Telemetry Scanner */}
              <div className="md:col-span-4 p-6 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-col space-y-4">
                <h4 className="text-xs font-extrabold uppercase text-rose-500 tracking-wider flex items-center space-x-1.5">
                  <FileText size={12} />
                  <span>2. Align Telemetry Point</span>
                </h4>

                {/* Telemetry statistics card */}
                <div className="bg-zinc-950 border border-zinc-850 rounded-2xl p-4 flex flex-col space-y-1.5 min-h-27.5">
                  {wizardTelemetryRow ? (
                    <div className="grid grid-cols-2 gap-1 text-[10px] font-sans">
                      <div className="text-zinc-500">Current Lap:</div>
                      <div className="font-mono font-bold text-cyan-400 text-right uppercase">
                        {wizardTelemetryRow.lap === 0
                          ? "Out Lap"
                          : `Lap ${wizardTelemetryRow.lap}`}
                      </div>
                      <div className="text-zinc-500">Log Timestamp:</div>
                      <div className="font-mono font-bold text-rose-400 text-right">
                        {wizardTelemetryRow.time.toFixed(3)}s
                      </div>
                      <div className="text-zinc-500">Speed (KM/H):</div>
                      <div className="font-mono font-bold text-zinc-200 text-right">
                        {Math.round(wizardTelemetryRow.speed)}
                      </div>
                      <div className="text-zinc-500">Engine RPM:</div>
                      <div className="font-mono font-bold text-zinc-200 text-right">
                        {Math.round(wizardTelemetryRow.rpm)}
                      </div>
                      {localTelemetry.detectedSampleRate > 0 && (
                        <>
                          <div className="text-zinc-500">Sample Rate:</div>
                          <div className="font-mono font-bold text-zinc-400 text-right">
                            {localTelemetry.detectedSampleRate}Hz
                            {localTelemetry.timeUnitCorrected && (
                              <span className="ml-1 text-emerald-400 text-[7px] font-bold uppercase">
                                corrected
                              </span>
                            )}
                          </div>
                          <div className="text-zinc-500">Session Span:</div>
                          <div className="font-mono font-bold text-zinc-400 text-right">
                            {Math.floor(localTelemetry.totalDuration / 60)}m{" "}
                            {Math.round(localTelemetry.totalDuration % 60)}s
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="text-[10px] text-zinc-550 italic text-center py-6">
                      No telemetry rows parsed
                    </div>
                  )}
                </div>

                {/* Precision Telemetry Scrubbing */}
                <div className="space-y-3">
                  {localTelemetry.totalDuration > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                        <span>Telemetry Time:</span>
                        <span className="font-bold text-rose-400">
                          {Math.floor((wizardTelemetryRow?.time ?? 0) / 60)}:
                          {String(
                            Math.floor((wizardTelemetryRow?.time ?? 0) % 60),
                          ).padStart(2, "0")}
                          .
                          {String(
                            Math.floor(
                              ((wizardTelemetryRow?.time ?? 0) % 1) * 10,
                            ),
                          )}
                          {" / "}
                          {Math.floor(localTelemetry.totalDuration / 60)}:
                          {String(
                            Math.floor(localTelemetry.totalDuration % 60),
                          ).padStart(2, "0")}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={Math.ceil(localTelemetry.totalDuration)}
                        step={0.1}
                        value={wizardTelemetryRow?.time ?? 0}
                        onChange={(e) =>
                          seekToTelemetryTime(parseFloat(e.target.value))
                        }
                        className="w-full accent-rose-500 h-1.5 bg-zinc-950 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    <button
                      onClick={() =>
                        seekToTelemetryTime(
                          Math.max(0, (wizardTelemetryRow?.time ?? 0) - 5),
                        )
                      }
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-855 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition"
                    >
                      -5s
                    </button>
                    <button
                      onClick={() =>
                        seekToTelemetryTime(
                          Math.max(0, (wizardTelemetryRow?.time ?? 0) - 1),
                        )
                      }
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-855 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition"
                    >
                      -1s
                    </button>
                    <button
                      onClick={() =>
                        seekToTelemetryTime(
                          Math.max(0, (wizardTelemetryRow?.time ?? 0) - 0.1),
                        )
                      }
                      className="bg-zinc-950 hover:bg-zinc-800 border border-zinc-850 text-[9px] px-1.5 py-1 rounded font-bold uppercase text-rose-400 transition"
                    >
                      -0.1s
                    </button>
                    <button
                      onClick={() =>
                        seekToTelemetryTime(
                          Math.min(
                            localTelemetry.totalDuration,
                            (wizardTelemetryRow?.time ?? 0) + 0.1,
                          ),
                        )
                      }
                      className="bg-zinc-950 hover:bg-zinc-800 border border-zinc-850 text-[9px] px-1.5 py-1 rounded font-bold uppercase text-rose-400 transition"
                    >
                      +0.1s
                    </button>
                    <button
                      onClick={() =>
                        seekToTelemetryTime(
                          Math.min(
                            localTelemetry.totalDuration,
                            (wizardTelemetryRow?.time ?? 0) + 1,
                          ),
                        )
                      }
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-855 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition"
                    >
                      +1s
                    </button>
                    <button
                      onClick={() =>
                        seekToTelemetryTime(
                          Math.min(
                            localTelemetry.totalDuration,
                            (wizardTelemetryRow?.time ?? 0) + 5,
                          ),
                        )
                      }
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-855 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition"
                    >
                      +5s
                    </button>
                  </div>

                  <div className="border-t border-zinc-800/80 pt-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="text-[9px] text-zinc-500 uppercase tracking-widest font-black flex items-center space-x-1">
                        <Flag size={10} />
                        <span>Quick Jumps</span>
                      </div>
                      <button
                        onClick={() => setModalTelemetryIdx(firstLaunchIdx)}
                        className="bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-cyan-400 hover:text-cyan-300 font-extrabold text-[9px] px-2.5 py-1 rounded-lg uppercase transition flex items-center space-x-1 cursor-pointer"
                      >
                        <Zap size={10} />
                        <span>First Launch</span>
                      </button>
                    </div>

                    {telemetryLaps.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {telemetryLaps.map((lapNum) => {
                          const isCurrent = wizardTelemetryRow?.lap === lapNum;
                          return (
                            <button
                              key={lapNum}
                              onClick={() => handleJumpToLapNumber(lapNum)}
                              className={`px-2 py-1 rounded-md text-[9px] font-mono font-bold uppercase border transition cursor-pointer ${
                                isCurrent
                                  ? "bg-rose-500/20 border-rose-500/60 text-rose-400"
                                  : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                              }`}
                            >
                              {lapNum === 0 ? "Out" : `L${lapNum}`}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="md:col-span-4 p-6 flex flex-col space-y-4">
                <h4 className="text-xs font-extrabold uppercase text-cyan-400 tracking-wider flex items-center space-x-1.5">
                  <MapPin size={12} />
                  <span>3. Visual Track Coordinate</span>
                </h4>

                <div className="w-full aspect-square md:aspect-auto md:grow min-h-50 border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-950/60 p-2">
                  <TrackMap
                    gpsPoints={gpsPoints}
                    currentLat={wizardTelemetryRow ? wizardTelemetryRow.lat : 0}
                    currentLon={wizardTelemetryRow ? wizardTelemetryRow.lon : 0}
                    startFinishCoord={startFinishCoord}
                  />
                </div>
              </div>
            </div>

            <div className="shrink-0 bg-zinc-950/60 px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between space-y-3 md:space-y-0 border-t border-zinc-800">
              <div className="text-[10px] text-zinc-450 uppercase font-semibold flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex items-center space-x-1.5">
                  <Zap size={14} className="text-cyan-400 animate-bounce" />
                  <span>Offset:</span>
                  <span className="font-mono font-bold text-zinc-200 text-xs bg-zinc-900 border border-zinc-850 px-2 py-0.5 rounded">
                    {(
                      modalVideoTime -
                      (wizardTelemetryRow?.time || 0) /
                        (speedScale > 0 ? speedScale : 1.0)
                    ).toFixed(3)}
                    s
                  </span>
                </div>
                {localTelemetry.detectedSampleRate > 0 && (
                  <div className="flex items-center space-x-1.5">
                    <span>Tel. Rate:</span>
                    <span className="font-mono font-bold text-zinc-300 text-xs bg-zinc-900 border border-zinc-850 px-2 py-0.5 rounded">
                      {localTelemetry.detectedSampleRate}Hz
                      {localTelemetry.timeUnitCorrected && (
                        <span className="ml-1 text-emerald-400">corrected</span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setIsSyncModalOpen(false)}
                  className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 font-extrabold px-4 py-2 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplySyncWizard}
                  className="bg-cyan-500 hover:bg-cyan-600 text-zinc-950 font-black px-5 py-2 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer shadow-[0_0_15px_rgba(34,211,238,0.2)]"
                >
                  Lock Sync & Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="lg:col-span-8 flex flex-col space-y-4">
        <div
          ref={videoContainerRef}
          className={
            isFullscreen
              ? "relative bg-black overflow-hidden w-screen h-screen flex items-center justify-center"
              : "relative bg-zinc-950 rounded-3xl border border-zinc-800/80 shadow-2xl overflow-hidden aspect-video w-full flex items-center justify-center"
          }
        >
          <div
            ref={overlayStageRef}
            className={
              isFullscreen
                ? "relative aspect-video overflow-hidden"
                : "relative w-full h-full overflow-hidden"
            }
            style={
              isFullscreen
                ? { width: "min(100vw, calc(100vh * 16 / 9))" }
                : undefined
            }
          >
            {videoUrls.length > 0 ? (
              <video
                ref={videoRef}
                src={videoUrls[activeVideoIndex]}
                className={
                  isFullscreen
                    ? "w-full h-full object-cover"
                    : "w-full h-full object-cover rounded-3xl"
                }
                onLoadedMetadata={() => {
                  if (videoRef.current && pendingMainSeekRef.current !== null) {
                    const pending = pendingMainSeekRef.current;
                    pendingMainSeekRef.current = null;
                    videoRef.current.currentTime = pending.time;
                    if (pending.autoPlay) {
                      videoRef.current
                        .play()
                        .catch((err) => console.error("Error playing video:", err));
                    }
                  }
                }}
                onEnded={() => {
                  if (activeVideoIndex < videoUrls.length - 1) {
                    pendingMainSeekRef.current = { time: 0, autoPlay: isPlaying };
                    setActiveVideoIndex(activeVideoIndex + 1);
                  } else {
                    setIsPlaying(false);
                  }
                }}
                onClick={togglePlay}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-zinc-500 p-8 text-center space-y-4">
                <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-full text-zinc-400 drop-shadow-[0_0_15px_rgba(24,24,27,0.8)]">
                  <Upload size={36} className="animate-bounce" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-200">
                    Load POV Video(s)
                  </h3>
                  <p className="text-xs text-zinc-400 max-w-xs mt-1">
                    GoPro POV videos not loaded! Select local videos to overlay
                    beautiful telemetry.
                  </p>
                </div>
                <label className="flex items-center space-x-2 bg-cyan-400 hover:bg-cyan-555 text-zinc-950 font-bold px-4 py-2 rounded-xl cursor-pointer text-xs transition">
                  <Upload size={14} />
                  <span>Select Local Video</span>
                  <input
                    type="file"
                    multiple
                    accept="video/*"
                    onChange={handleVideoChange}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            <span className="absolute top-3 right-3 text-white/20 text-[10px] font-medium pointer-events-none select-none z-10">
              OpenRaceRender.com
            </span>

            {localTelemetry && (
              <div className="absolute inset-0 pointer-events-none">
                {layoutConfig.speedometer.visible && (
                  <HudWidgetFrame
                    widgetId="speedometer"
                    layout={layoutConfig.speedometer}
                    isEditMode={isEditMode}
                    isResizing={resizingWidgetId === "speedometer"}
                    onDragStart={handleWidgetDragStart}
                    onResizeStart={handleWidgetResizeStart}
                  >
                    <Speedometer
                      speed={currentTelemetry.speed}
                      maxSpeed={telemetryMaxSpeed}
                    />
                  </HudWidgetFrame>
                )}

                {layoutConfig.rpmGauge.visible && (
                  <HudWidgetFrame
                    widgetId="rpmGauge"
                    layout={layoutConfig.rpmGauge}
                    isEditMode={isEditMode}
                    isResizing={resizingWidgetId === "rpmGauge"}
                    onDragStart={handleWidgetDragStart}
                    onResizeStart={handleWidgetResizeStart}
                  >
                    <RpmGauge
                      rpm={currentTelemetry.rpm}
                      maxRpm={telemetryMaxRpm}
                    />
                  </HudWidgetFrame>
                )}

                {layoutConfig.gForceRadar.visible && (
                  <HudWidgetFrame
                    widgetId="gForceRadar"
                    layout={layoutConfig.gForceRadar}
                    isEditMode={isEditMode}
                    isResizing={resizingWidgetId === "gForceRadar"}
                    containerQuery
                    onDragStart={handleWidgetDragStart}
                    onResizeStart={handleWidgetResizeStart}
                  >
                    <GForceRadar
                      latAcc={currentTelemetry.latAcc}
                      lonAcc={currentTelemetry.lonAcc}
                    />
                  </HudWidgetFrame>
                )}

                {layoutConfig.trackMap.visible && (
                  <HudWidgetFrame
                    widgetId="trackMap"
                    layout={layoutConfig.trackMap}
                    isEditMode={isEditMode}
                    isResizing={resizingWidgetId === "trackMap"}
                    onDragStart={handleWidgetDragStart}
                    onResizeStart={handleWidgetResizeStart}
                  >
                    <TrackMap
                      gpsPoints={gpsPoints}
                      currentLat={currentTelemetry.lat}
                      currentLon={currentTelemetry.lon}
                      startFinishCoord={startFinishCoord}
                      ghostCoord={ghostCoord}
                      ghostColor={activeReferenceLap?.accentColor}
                    />
                  </HudWidgetFrame>
                )}

                {layoutConfig.lapTimer.visible && (
                  <HudWidgetFrame
                    widgetId="lapTimer"
                    layout={layoutConfig.lapTimer}
                    isEditMode={isEditMode}
                    isResizing={resizingWidgetId === "lapTimer"}
                    fitHeight
                    containerQuery
                    onDragStart={handleWidgetDragStart}
                    onResizeStart={handleWidgetResizeStart}
                  >
                    <LapTimer
                      currentLap={currentTelemetry.lap}
                      currentLapTime={formatLapTime(currentLapElapsed)}
                      bestLapTime={formatLapTime(bestLapInfo.time)}
                      bestLapNum={bestLapInfo.lap}
                      previousLapTime={formatLapTime(
                        lapTimes.laps[currentTelemetry.lap - 1] || 0,
                      )}
                    />
                  </HudWidgetFrame>
                )}

                {layoutConfig.deltaBar.visible && (
                  <HudWidgetFrame
                    widgetId="deltaBar"
                    layout={layoutConfig.deltaBar}
                    isEditMode={isEditMode}
                    isResizing={resizingWidgetId === "deltaBar"}
                    fitHeight
                    containerQuery
                    onDragStart={handleWidgetDragStart}
                    onResizeStart={handleWidgetResizeStart}
                  >
                    <DeltaBar
                      delta={activeComparisonMetric.delta}
                      hasBestLap={Boolean(activeReferenceLap)}
                      referenceLabel={activeReferenceLap?.hudLabel}
                    />
                  </HudWidgetFrame>
                )}
              </div>
            )}

            {isEditMode && (
              <div className="absolute top-4 left-1/2 transform -translate-x-1/2 pointer-events-none bg-cyan-500 text-zinc-950 font-extrabold text-[10px] tracking-widest px-3 py-1 rounded-full uppercase z-10 border border-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.5)]">
                Layout HUD Editor Active - Drag to move, corners to resize
              </div>
            )}
          </div>
        </div>

        {/* Video Scrubber & Control Bar */}
        <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-4 rounded-2xl flex flex-col space-y-3">
          <div className="flex items-center space-x-3">
            <button
              onClick={togglePlay}
              disabled={videoUrls.length === 0}
              className={`p-2.5 rounded-xl transition ${
                videoUrls.length > 0
                  ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 cursor-pointer"
                  : "bg-zinc-900 text-zinc-700 cursor-not-allowed"
              }`}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>

            <div className="flex items-center space-x-2 bg-zinc-950/60 border border-zinc-850/80 px-2.5 py-1.5 rounded-xl transition-all duration-200">
              <button
                onClick={() => setIsMuted(!isMuted)}
                disabled={videoUrls.length === 0}
                className={`transition-colors cursor-pointer ${
                  videoUrls.length > 0
                    ? "text-zinc-400 hover:text-zinc-100"
                    : "text-zinc-700 cursor-not-allowed"
                }`}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX size={16} className="text-zinc-555" />
                ) : (
                  <Volume2 size={16} className="text-cyan-400" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                disabled={videoUrls.length === 0}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setVolume(val);
                  if (val > 0) {
                    setIsMuted(false);
                  }
                }}
                className="w-16 h-1 accent-cyan-400 bg-zinc-950 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed"
                title="Volume"
              />
            </div>

            {/* Main Video Progress slider with range mark */}
            <div className="relative grow h-6 flex items-center">
              {/* Shaded trim range marker behind slider */}
              {videoDuration > 0 && exportEnd > 0 && (
                <div
                  className="absolute h-1 bg-cyan-400/35 border-l border-r border-cyan-400/80 rounded"
                  style={{
                    left: `${(exportStart / videoDuration) * 100}%`,
                    width: `${((exportEnd - exportStart) / videoDuration) * 100}%`,
                    pointerEvents: "none",
                  }}
                />
              )}
              <input
                type="range"
                min={0}
                max={videoDuration || 100}
                step={0.05}
                value={currentTime}
                disabled={videoUrls.length === 0}
                onChange={(e) => seekMainVideoGlobal(parseFloat(e.target.value))}
                className="w-full accent-cyan-400 h-1 bg-zinc-950 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed z-10"
              />
            </div>

            <div className="text-xs font-mono text-zinc-400 select-none tabular-nums w-27.5 text-right">
              {Math.floor(currentTime / 60)}:
              {String(Math.floor(currentTime % 60)).padStart(2, "0")}.
              {String(Math.floor((currentTime % 1) * 10)).padStart(1, "0")} /{" "}
              {Math.floor(videoDuration / 60)}:
              {String(Math.floor(videoDuration % 60)).padStart(2, "0")}
            </div>

            <button
              onClick={() => {
                if (videoContainerRef.current) {
                  if (document.fullscreenElement) {
                    document.exitFullscreen();
                  } else {
                    videoContainerRef.current.requestFullscreen();
                  }
                }
              }}
              disabled={videoUrls.length === 0}
              className={`p-2.5 rounded-xl transition ml-2 ${
                videoUrls.length > 0
                  ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 cursor-pointer"
                  : "bg-zinc-900 text-zinc-700 cursor-not-allowed"
              }`}
              title="Fullscreen"
            >
              <Maximize size={16} />
            </button>
          </div>

          {videoUrls.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/80 pt-3">
              <span className="inline-flex items-center space-x-1">
                <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-[10px] font-bold leading-none">
                  Space
                </kbd>
                <span>Play/Pause</span>
              </span>
              <span className="inline-flex items-center space-x-1">
                <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-[10px] font-bold leading-none">
                  ←
                </kbd>
                <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-[10px] font-bold leading-none">
                  →
                </kbd>
                <span>±3s</span>
              </span>
              <span className="inline-flex items-center space-x-1">
                <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-[10px] font-bold leading-none">
                  Shift
                </kbd>
                <span className="text-zinc-500">+</span>
                <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-[10px] font-bold leading-none">
                  ←
                </kbd>
                <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-[10px] font-bold leading-none">
                  →
                </kbd>
                <span>±10s</span>
              </span>
              <span className="inline-flex items-center space-x-1">
                <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded bg-zinc-950 border border-cyan-500/40 text-cyan-300 font-mono text-xs font-black leading-none text-center">
                  ,
                </kbd>
                <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded bg-zinc-950 border border-cyan-500/40 text-cyan-300 font-mono text-xs font-black leading-none text-center">
                  .
                </kbd>
                <span>±1 Frame</span>
              </span>
              <span className="inline-flex items-center space-x-1">
                <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-[10px] font-bold leading-none">
                  ↑
                </kbd>
                <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-[10px] font-bold leading-none">
                  ↓
                </kbd>
                <span>Volume</span>
              </span>
            </div>
          )}

          {localTelemetry && videoUrls.length > 0 && telemetryLaps.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-3">
              <div className="flex items-center space-x-1.5 text-[10px] text-zinc-400 uppercase tracking-wider font-black mr-1">
                <Flag size={11} className="text-cyan-400" />
                <span>Laps</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {telemetryLaps.map((lapNum) => {
                  const safeScale = speedScale > 0 ? speedScale : 1.0;
                  const telStart =
                    lapTimes.starts[lapNum] ??
                    localTelemetry.rows.find((r) => r.lap === lapNum)?.time ??
                    0;
                  const telEnd =
                    lapTimes.ends[lapNum] ??
                    (lapNum === 0 && lapTimes.starts[1] !== undefined
                      ? lapTimes.starts[1]
                      : telStart + (lapTimes.laps[lapNum] || 0));
                  const lapStartVid = telStart / safeScale + syncOffset;
                  const lapEndVid = telEnd / safeScale + syncOffset;
                  const isOutOfRange =
                    videoDuration > 0 &&
                    (lapEndVid < 0 || lapStartVid > videoDuration);
                  const isCurrent = currentTelemetry.lap === lapNum;
                  const isBest = bestLapInfo.lap === lapNum;
                  const lapDur = lapTimes.laps[lapNum] || 0;

                  return (
                    <button
                      key={lapNum}
                      onClick={() => handleSeekToVideoLap(lapNum)}
                      disabled={isOutOfRange}
                      title={
                        isOutOfRange
                          ? "Outside video range"
                          : isBest
                            ? `Jump to Lap ${lapNum} (Best)`
                            : lapNum === 0
                              ? "Jump to Out Lap"
                              : `Jump to Lap ${lapNum}`
                      }
                      className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border transition flex items-center space-x-1.5 ${
                        isOutOfRange
                          ? "bg-zinc-950 border-zinc-800/60 text-zinc-600 opacity-40 cursor-not-allowed"
                          : isCurrent
                            ? "bg-cyan-500/15 border-cyan-400/60 text-cyan-300 cursor-pointer"
                            : isBest
                              ? "bg-zinc-950 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                              : "bg-zinc-950 border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 cursor-pointer"
                      }`}
                    >
                      <span>{lapNum === 0 ? "Out" : `L${lapNum}`}</span>
                      {lapNum >= 1 && lapDur > 0 && (
                        <span
                          className={
                            isCurrent
                              ? "text-cyan-200/80"
                              : isBest
                                ? "text-emerald-300/80"
                                : "text-zinc-500"
                          }
                        >
                          {formatLapTime(lapDur)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {localTelemetry && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-3">
              <div className="flex items-center">
                {autoSyncState.phase === "running" && (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[10px] font-bold uppercase tracking-wider">
                    <RefreshCw size={11} className="animate-spin" />
                    <span>Scanning GoPro telemetry...</span>
                  </div>
                )}
                {autoSyncState.phase === "matched" && autoSyncState.result && (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                    <Sparkles size={11} />
                    <span>
                      Auto-synced via {formatSyncMethodLabel(autoSyncState.result.method)} (
                      {Math.round(autoSyncState.result.confidence * 100)}%)
                    </span>
                  </div>
                )}
                {autoSyncState.phase === "low-confidence" && autoSyncState.result && (
                  <div className="flex items-center space-x-2 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-bold uppercase tracking-wider">
                    <span>
                      Low-confidence ({Math.round(autoSyncState.result.confidence * 100)}%,{" "}
                      {autoSyncState.result.syncOffset.toFixed(2)}s)
                    </span>
                    <button
                      onClick={() => {
                        if (!autoSyncState.result) return;
                        setSyncOffset(autoSyncState.result.syncOffset);
                        setSpeedScale(autoSyncState.result.speedScale);
                        setAutoSyncState({
                          phase: "matched",
                          result: autoSyncState.result,
                        });
                      }}
                      className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black px-2 py-0.5 rounded text-[9px] uppercase cursor-pointer transition"
                    >
                      Apply
                    </button>
                  </div>
                )}
                {autoSyncState.phase === "unavailable" && (
                  <div className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-500 text-[10px] font-semibold">
                    {autoSyncState.result?.reason ||
                      "No GoPro telemetry track — adjust manually in Sync Wizard."}
                  </div>
                )}
                {autoSyncState.phase === "idle" && (
                  <span className="text-[10px] text-zinc-500 font-semibold">
                    Auto-sync didn&apos;t match? Adjust manually in Sync Wizard.
                  </span>
                )}
              </div>

              <button
                onClick={handleOpenSyncWizard}
                className="flex items-center space-x-1.5 bg-cyan-500 hover:bg-cyan-600 text-zinc-950 font-black px-3 py-1.5 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer shadow-[0_0_12px_rgba(34,211,238,0.2)] ml-auto"
              >
                <Sliders size={12} />
                <span>Open Sync Wizard</span>
              </button>
            </div>
          )}
        </div>

        {localTelemetry && (
          <ComparisonPanel
            primaryRacerName={primaryRacerName}
            primarySessionName={primarySessionName}
            primaryAnalysis={primaryLapAnalysis}
            currentLap={currentTelemetry.lap}
            currentLapElapsed={currentLapElapsed}
            currentSpeed={currentTelemetry.speed}
            telemetryLaps={telemetryLaps}
            comparisonSessions={comparisonSessions}
            comparisonSelection={comparisonSelection}
            activeReferenceLap={activeReferenceLap}
            activeMetric={activeComparisonMetric}
            sessionLiveMetrics={sessionLiveMetrics}
            showGhostOnMap={showGhostOnMap}
            isParsingComparison={isParsingComparison}
            comparisonError={comparisonError}
            onToggleGhostOnMap={() => setShowGhostOnMap((prev) => !prev)}
            onSelectComparison={handleSelectComparison}
            onAddComparisonCSVs={handleAddComparisonCSVs}
            onRemoveComparisonSession={handleRemoveComparisonSession}
            onRenameComparisonSession={handleRenameComparisonSession}
            onDismissError={() => setComparisonError("")}
          />
        )}
      </div>

      {/* RIGHT COLUMN: 40% Width - Workspace Control Panel */}
      <div className="lg:col-span-4 flex flex-col space-y-6">
        {/* Load Local Video */}
        <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-5 rounded-3xl flex flex-col space-y-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex items-center space-x-2">
            <Video size={14} className="text-cyan-400" />
            <span>GoPro POV Video</span>
          </h3>

          <div>
            <div className="relative border border-dashed border-zinc-800 rounded-xl bg-zinc-950/60 p-5 hover:border-zinc-700 transition cursor-pointer text-center">
              <input
                type="file"
                accept="video/*"
                multiple
                onChange={handleVideoChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center justify-center space-y-1">
                <Video size={20} className="text-cyan-400" />
                <span className="text-[10px] text-zinc-400 font-semibold truncate max-w-55">
                  {videoFiles.length > 0
                    ? `${videoFiles.length} video(s) selected`
                    : "Select POV Video(s)"}
                </span>
                <span className="text-[8px] text-zinc-555">
                  Loads locally for maximum GPU rendering speed
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Load Local telemetry data */}
        <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-5 rounded-3xl flex flex-col space-y-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex items-center space-x-2">
            <FileText size={14} className="text-rose-500" />
            <span>Telemetry File (CSV)</span>
          </h3>

          <div>
            <div className="relative border border-dashed border-zinc-800 rounded-xl bg-zinc-950/60 p-5 hover:border-zinc-700 transition cursor-pointer text-center">
              <input
                type="file"
                accept=".csv"
                onChange={handleCSVChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center justify-center space-y-1">
                <FileText size={20} className="text-rose-400" />
                <span className="text-[10px] text-zinc-400 font-semibold truncate max-w-55">
                  {csvFile ? csvFile.name : "Select Telemetry CSV"}
                </span>
                <span className="text-[8px] text-zinc-555">
                  Aim/RaceStudio 2 format compliant
                </span>
              </div>
            </div>
          </div>

          {isProcessing && (
            <div className="text-[10px] text-cyan-400 font-semibold text-center flex items-center justify-center space-x-1.5 animate-pulse">
              <RefreshCw size={12} className="animate-spin" />
              <span>Parsing telemetry client-side...</span>
            </div>
          )}

          {uploadError && (
            <div className="text-[10px] text-rose-500 font-bold bg-rose-950/20 border border-rose-900 rounded-xl p-2.5">
              {uploadError}
            </div>
          )}
        </div>

        {/* GPU Exporter Control Center */}
        {localTelemetry && videoFiles.length > 0 && (
          <div className="bg-zinc-900/80 backdrop-blur-md border border-rose-500/30 p-5 rounded-3xl flex flex-col space-y-4 shadow-[0_0_20px_rgba(244,63,94,0.1)]">
            <h3 className="text-xs font-black uppercase tracking-widest text-rose-500 flex items-center space-x-2">
              <Video size={14} className="text-rose-500 animate-pulse" />
              <span>GPU HUD Exporter</span>
            </h3>
            <p className="text-[9px] text-zinc-400 leading-relaxed uppercase font-semibold">
              Merge POV video and telemetry dials directly inside your browser!
              GPU hardware-accelerated.
            </p>

            {/* Range Selectors */}
            <button
              onClick={() => {
                setIsExportModalOpen(true);
                setExportPreviewTime(exportStart);

                let t = 0;
                let idx = 0;
                for (let i = 0; i < videoDurations.length; i++) {
                  if (
                    exportStart >= t &&
                    exportStart <= t + videoDurations[i]
                  ) {
                    idx = i;
                    break;
                  }
                  t += videoDurations[i];
                }
                setExportActiveVideoIndex(idx);

                setTimeout(() => {
                  if (exportPreviewVideoRef.current) {
                    exportPreviewVideoRef.current.src = videoUrls[idx];
                    exportPreviewVideoRef.current.currentTime = exportStart - t;
                  }
                }, 50);
              }}
              className="w-full bg-cyan-400 hover:bg-cyan-550 text-zinc-950 font-black py-3 rounded-xl text-xs uppercase transition tracking-widest flex items-center justify-center space-x-2 cursor-pointer shadow-[0_0_15px_rgba(34,211,238,0.255)]"
            >
              <Download size={14} />
              <span>Export HUD Overlaid Video</span>
            </button>
          </div>
        )}

        {/* Live HUD Customizer Controls */}
        {localTelemetry && (
          <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-5 rounded-3xl flex flex-col space-y-4">
            <div className="flex justify-between items-center gap-2">
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex items-center space-x-2">
                <Layers size={14} className="text-cyan-400" />
                <span>HUD Widget Control</span>
              </h3>
              <div className="flex items-center space-x-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleResetLayout}
                  disabled={isDefaultLayout}
                  title="Reset HUD positions, sizes, and visibility"
                  className={`flex items-center space-x-1 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border transition bg-zinc-950 text-zinc-400 border-zinc-800 ${
                    isDefaultLayout
                      ? "opacity-40 cursor-not-allowed"
                      : "hover:text-zinc-200 hover:border-zinc-700 cursor-pointer"
                  }`}
                >
                  <RotateCcw size={11} />
                  <span>Reset</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditMode(!isEditMode)}
                  className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border transition cursor-pointer ${
                    isEditMode
                      ? "bg-cyan-400 text-zinc-950 border-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                      : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:bg-zinc-900"
                  }`}
                >
                  {isEditMode ? "Exit HUD Editor" : "Edit HUD Layout"}
                </button>
              </div>
            </div>

            <div className="space-y-2 border-t border-zinc-800/80 pt-3">
              {(Object.keys(DEFAULT_LAYOUT_CONFIG) as WidgetId[]).map(
                (widgetKey) => {
                  const config = layoutConfig[widgetKey];
                  const cleanName = widgetKey.replace(/([A-Z])/g, " $1");
                  return (
                  <div
                    key={widgetKey}
                    className="flex items-center justify-between text-xs py-1.5"
                  >
                    <span className="capitalize text-zinc-300 font-sans tracking-wide">
                      {cleanName}
                    </span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.visible}
                        onChange={(e) => {
                          const isChecked = e.target.checked;
                          setLayoutConfig((prev) => ({
                            ...prev,
                            [widgetKey]: {
                              ...prev[widgetKey],
                              visible: isChecked,
                            },
                          }));
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4.5 bg-zinc-950 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-zinc-500 after:border-zinc-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-cyan-500 peer-checked:after:bg-zinc-950" />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
