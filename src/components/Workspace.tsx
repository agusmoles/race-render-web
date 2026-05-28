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
} from "lucide-react";
import { parseTelemetryCSV, ParsedTelemetry } from "@/utils/csv-helper";
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
    Record<string, WidgetLayout>
  >({
    speedometer: { x: 3, y: 70, w: 20, h: 25, visible: true },
    rpmGauge: { x: 20, y: 72, w: 18, h: 23, visible: true },
    gForceRadar: { x: 77, y: 68, w: 20, h: 27, visible: true },
    trackMap: { x: 70, y: 2, w: 28, h: 38, visible: true },
    lapTimer: { x: 3, y: 3, w: 26, h: 16, visible: true },
    deltaBar: { x: 35, y: 3, w: 30, h: 8, visible: true },
  });

  // Video Ref & Playback state
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Export trim range
  const [prevVideoDuration, setPrevVideoDuration] = useState(0);
  const [exportStart, setExportStart] = useState<number>(0);
  const [exportEnd, setExportEnd] = useState<number>(0);

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
  const exportPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const [modalVideoTime, setModalVideoTime] = useState(0);
  const [modalTelemetryIdx, setModalTelemetryIdx] = useState(0);
  const modalVideoRef = useRef<HTMLVideoElement>(null);

  // Dual-point calibration coordinates for automatic scale computation
  const [syncPoint1, setSyncPoint1] = useState<{
    video: number;
    telemetry: number;
  } | null>(null);
  const [syncPoint2, setSyncPoint2] = useState<{
    video: number;
    telemetry: number;
  } | null>(null);

  const telemetryMeta = useMemo(() => {
    if (!localTelemetry)
      return { totalDuration: 0, sampleRate: 0, timeUnitCorrected: false };
    return {
      totalDuration: localTelemetry.totalDuration,
      sampleRate: localTelemetry.detectedSampleRate,
      timeUnitCorrected: localTelemetry.timeUnitCorrected,
    };
  }, [localTelemetry]);

  const lapTimes = useMemo(() => {
    if (!localTelemetry?.rows || localTelemetry.rows.length === 0)
      return {
        laps: {} as Record<number, number>,
        starts: {} as Record<number, number>,
        ends: {} as Record<number, number>,
      };
    const laps: Record<number, number> = {};
    const starts: Record<number, number> = {};
    const ends: Record<number, number> = {};
    const startDistances: Record<number, number> = {};

    localTelemetry.rows.forEach((r) => {
      if (r.lap === undefined || r.lap < 1) return;
      if (starts[r.lap] === undefined || r.time < starts[r.lap]) {
        starts[r.lap] = r.time;
        startDistances[r.lap] = r.distance || 0;
      }
      if (ends[r.lap] === undefined || r.time > ends[r.lap]) {
        ends[r.lap] = r.time;
      }
    });

    const lapKeys = Object.keys(starts)
      .map(Number)
      .sort((a, b) => a - b);
    lapKeys.forEach((k, idx) => {
      if (idx < lapKeys.length - 1) {
        laps[k] = starts[lapKeys[idx + 1]] - starts[k];
      } else {
        laps[k] = ends[k] - starts[k];
      }
    });

    return { laps, starts, ends, startDistances };
  }, [localTelemetry]);

  const bestLapInfo = useMemo(() => {
    if (!lapTimes || !lapTimes.laps) return { lap: 0, time: 0 };
    const lapKeys = Object.keys(lapTimes.laps)
      .map(Number)
      .sort((a, b) => a - b);
    if (lapKeys.length === 0) return { lap: 0, time: 0 };

    let bestLap = 0;
    let bestTime = Infinity;

    lapKeys.forEach((lapNum) => {
      if (lapKeys.length > 2) {
        if (lapNum === lapKeys[0] || lapNum === lapKeys[lapKeys.length - 1]) {
          return;
        }
      } else if (lapKeys.length === 2) {
        if (lapNum === lapKeys[0]) {
          return;
        }
      }

      const duration = lapTimes.laps[lapNum];
      if (duration < bestTime && duration > 5) {
        bestTime = duration;
        bestLap = lapNum;
      }
    });

    return bestTime === Infinity
      ? { lap: 0, time: 0 }
      : { lap: bestLap, time: bestTime };
  }, [lapTimes]);

  const bestLapRows = useMemo(() => {
    if (!localTelemetry?.rows || bestLapInfo.lap === 0) return [];
    return localTelemetry.rows.filter((r) => r.lap === bestLapInfo.lap);
  }, [localTelemetry, bestLapInfo.lap]);

  const getDeltaTime = (
    currentLap: number,
    elapsedTime: number,
    elapsedDist: number,
  ) => {
    if (bestLapInfo.lap === 0 || bestLapRows.length === 0) return 0;
    if (currentLap === bestLapInfo.lap) return 0;

    const bestStartDist = lapTimes.startDistances?.[bestLapInfo.lap] || 0;
    const bestStartTime = lapTimes.starts[bestLapInfo.lap] || 0;

    let low = 0;
    let high = bestLapRows.length - 1;
    let matchIdx = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midDist = bestLapRows[mid].distance - bestStartDist;
      if (midDist === elapsedDist) {
        matchIdx = mid;
        break;
      } else if (midDist < elapsedDist) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    let bestLapTime = 0;
    if (matchIdx !== -1) {
      bestLapTime = bestLapRows[matchIdx].time - bestStartTime;
    } else {
      const idxB = Math.min(low, bestLapRows.length - 1);
      const idxA = Math.max(0, idxB - 1);
      const rowA = bestLapRows[idxA];
      const rowB = bestLapRows[idxB];

      const distA = rowA.distance - bestStartDist;
      const distB = rowB.distance - bestStartDist;

      let fraction = 0;
      if (distB !== distA) {
        fraction = Math.max(
          0,
          Math.min(1, (elapsedDist - distA) / (distB - distA)),
        );
      }

      const timeA = rowA.time - bestStartTime;
      const timeB = rowB.time - bestStartTime;
      bestLapTime = timeA + fraction * (timeB - timeA);
    }

    return elapsedTime - bestLapTime;
  };

  const formatLapTime = (secs: number) => {
    if (isNaN(secs) || secs <= 0) return "0:00.00";
    const mins = Math.floor(secs / 60);
    const remainingSecs = Math.floor(secs % 60);
    const centiseconds = Math.floor((secs % 1) * 100);
    return `${mins}:${remainingSecs.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
  };

  // Track map coordinates list
  const gpsPoints = useMemo(() => {
    if (!localTelemetry?.rows) return [];
    return localTelemetry.rows.map((row) => ({
      lat: Number(row.lat) || 0,
      lon: Number(row.lon) || 0,
    }));
  }, [localTelemetry]);

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

  // List of unique laps present in the telemetry logs
  const telemetryLaps = useMemo(() => {
    if (!localTelemetry?.rows) return [];
    const lapsSet = new Set<number>();
    localTelemetry.rows.forEach((r) => {
      if (r.lap && r.lap > 0) lapsSet.add(r.lap);
    });
    return Array.from(lapsSet).sort((a, b) => a - b);
  }, [localTelemetry]);

  // Jump wizard to first row of specific lap number
  const handleJumpToLapStart = (lapNum: number) => {
    if (!localTelemetry?.rows) return;
    const targetIdx = localTelemetry.rows.findIndex((r) => r.lap === lapNum);
    if (targetIdx !== -1) {
      setModalTelemetryIdx(targetIdx);
    }
  };

  // Jump wizard to specific lap index (1st, 2nd, 3rd) with fallback
  // Note: CSV Lap 1 is the "in" lap, so:
  // - 1st Lap Start (timed) jumps to CSV Lap 2
  // - 2nd Lap Start jumps to CSV Lap 3
  // - 3rd Lap Start jumps to CSV Lap 4
  const handleJumpToLap = (lapIndex: number) => {
    if (!localTelemetry?.rows || localTelemetry.rows.length === 0) return;

    // Map lapIndex: 1 -> telemetryLaps[1] (CSV Lap 2), 2 -> telemetryLaps[2] (CSV Lap 3), etc.
    if (telemetryLaps.length > lapIndex) {
      const targetLapNum = telemetryLaps[lapIndex];
      const targetIdx = localTelemetry.rows.findIndex(
        (r) => r.lap === targetLapNum,
      );
      if (targetIdx !== -1) {
        setModalTelemetryIdx(targetIdx);
        return;
      }
    }

    // Proportional fallback if specific lap doesn't exist
    const totalRows = localTelemetry.rows.length;
    if (lapIndex === 1) {
      setModalTelemetryIdx(0);
    } else if (lapIndex === 2) {
      setModalTelemetryIdx(Math.floor(totalRows * 0.33));
    } else if (lapIndex === 3) {
      setModalTelemetryIdx(Math.floor(totalRows * 0.66));
    }
  };

  const handleVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      videoUrls.forEach((url) => URL.revokeObjectURL(url));

      const files = Array.from(e.target.files).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      setVideoFiles(files);
      const urls = files.map((f) => URL.createObjectURL(f));
      setVideoUrls(urls);
      setActiveVideoIndex(0);
      setIsPlaying(false);
      setCurrentTime(0);
      setExportStart(0);
      setExportEnd(0);

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
      setVideoDurations(durations);
      const total = durations.reduce((a, b) => a + b, 0);
      setVideoDuration(total);
    }
  };

  // Parse CSV telemetry in client-side memory
  const handleCSVChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setCsvFile(file);
      setIsProcessing(true);
      setUploadError("");

      try {
        const csvText = await file.text();
        const parsed = parseTelemetryCSV(csvText);
        setLocalTelemetry(parsed);
        setChannelMapping(parsed.channelMapping);
      } catch (err) {
        const error = err as Error;
        console.error(error);
        setUploadError("Error reading telemetry: " + error.message);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // Real-time animation loop for high-frequency telemetry gauge updates (60 FPS)
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = -1;

    const updateInterpolatedTelemetry = () => {
      if (
        !videoRef.current ||
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
            lap: Number(match.lap) || 1,
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
              lap: Number(rowA.lap) || 1,
              distance: isNaN(rowA.distance + fraction * (rowB.distance - rowA.distance))
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

  // Draggable HUD Widget layout mouse event capturing
  const dragWidgetRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const handleWidgetMouseDown = (e: React.MouseEvent, widgetId: string) => {
    if (!isEditMode) return;
    e.preventDefault();
    dragWidgetRef.current = widgetId;

    const overlayBounds =
      e.currentTarget.parentElement?.getBoundingClientRect();
    if (!overlayBounds) return;

    const widgetBounds = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - widgetBounds.left;
    const clickY = e.clientY - widgetBounds.top;

    dragOffsetRef.current = { x: clickX, y: clickY };
  };

  const handleOverlayMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEditMode || !dragWidgetRef.current) return;
    e.preventDefault();

    const overlayBounds = e.currentTarget.getBoundingClientRect();
    if (!overlayBounds) return;

    const xPx = e.clientX - overlayBounds.left - dragOffsetRef.current.x;
    const yPx = e.clientY - overlayBounds.top - dragOffsetRef.current.y;

    const xPct = Math.max(0, Math.min(85, (xPx / overlayBounds.width) * 100));
    const yPct = Math.max(0, Math.min(85, (yPx / overlayBounds.height) * 100));

    setLayoutConfig((prev) => ({
      ...prev,
      [dragWidgetRef.current!]: {
        ...prev[dragWidgetRef.current!],
        x: parseFloat(xPct.toFixed(1)),
        y: parseFloat(yPct.toFixed(1)),
      },
    }));
  };

  const handleOverlayMouseUp = () => {
    dragWidgetRef.current = null;
  };

  // Telemetry Sync Wizard open trigger
  const handleOpenSyncWizard = () => {
    if (videoRef.current) {
      setModalVideoTime(videoRef.current.currentTime);
    } else {
      setModalVideoTime(0);
    }
    setModalTelemetryIdx(0);
    setSyncPoint1(null);
    setSyncPoint2(null);
    setIsSyncModalOpen(true);
    setIsPlaying(false);
    if (videoRef.current) videoRef.current.pause();
  };

  // Lock and apply sync wizard values
  //
  // The sync model is: telemetryTime = (videoTime - offset) * scale
  // For 1-point sync: offset = videoTime - telemetryTime, scale stays unchanged.
  // For 2-point sync: solve two equations to get both offset and scale that
  //   satisfy both (video1, tel1) and (video2, tel2) simultaneously.
  //
  // 2-point math (from the two equations):
  //   tel1 = (vid1 - offset) * scale  →  scale = (tel2 - tel1) / (vid2 - vid1)
  //   offset = vid1 - tel1 / scale
  const handleApplySyncWizard = () => {
    if (!localTelemetry?.rows || localTelemetry.rows.length === 0) return;

    if (syncPoint1 && syncPoint2) {
      const vDelta = syncPoint2.video - syncPoint1.video;
      const tDelta = syncPoint2.telemetry - syncPoint1.telemetry;
      if (Math.abs(vDelta) > 0.5) {
        const computedScale = tDelta / vDelta;
        const computedOffset =
          syncPoint1.video - syncPoint1.telemetry / computedScale;
        setSpeedScale(parseFloat(computedScale.toFixed(6)));
        setSyncOffset(parseFloat(computedOffset.toFixed(4)));
        if (videoRef.current) videoRef.current.currentTime = syncPoint1.video;
        setIsSyncModalOpen(false);
        return;
      }
    }

    const telRow =
      localTelemetry.rows[
        Math.min(modalTelemetryIdx, localTelemetry.rows.length - 1)
      ];
    const computedOffset = modalVideoTime - telRow.time;
    setSyncOffset(parseFloat(computedOffset.toFixed(4)));
    if (videoRef.current) videoRef.current.currentTime = modalVideoTime;
    setIsSyncModalOpen(false);
  };

  // GPU ACCELERATED VIDEO OVERLAY EXPORTER
  const handleExportVideo = async () => {
    if (!videoRef.current || !localTelemetry || videoFiles.length === 0) {
      alert("Please load both GoPro POV video and CSV Telemetry data first!");
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    setIsPlaying(false);
    videoRef.current.pause();

    const originalVideo = videoRef.current;

    // Create an offscreen recording canvas matching video dimensions
    const canvas = document.createElement("canvas");
    canvas.width = originalVideo.videoWidth || 1280;
    canvas.height = originalVideo.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      alert("Failed to initialize canvas GPU render context.");
      setIsExporting(false);
      return;
    }

    const actualStart = exportStart;
    const actualEnd = exportEnd > 0 ? exportEnd : videoDuration;

    // Aligned HTML5 Video player for frame scanning
    const exportVideos = await Promise.all(
      videoUrls.map(async (url) => {
        const v = document.createElement("video");
        v.src = url;
        v.muted = false; // MUST be unmuted to capture its audio!
        v.volume = 1.0;
        v.playsInline = true;
        v.width = canvas.width;
        v.height = canvas.height;
        v.style.position = "absolute";
        v.style.top = "0";
        v.style.left = "0";
        v.style.width = `${canvas.width}px`;
        v.style.height = `${canvas.height}px`;
        v.style.zIndex = "-9999";
        v.style.opacity = "0.01";
        v.style.pointerEvents = "none";
        document.body.appendChild(v);
        await new Promise<void>((resolve) => {
          v.onloadeddata = () => resolve();
        });
        return v;
      }),
    );

    let currentExportVideoIndex = 0;
    let exportVideo = exportVideos[currentExportVideoIndex];

    // Capture the stream at 60 FPS for buttery smooth playback
    const canvasStream = canvas.captureStream(60);

    // Set up Audio Mixing from original video
    let audioStreamTrack: MediaStreamTrack | null = null;
    try {
      const audioCtx = new (
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      )();

      // Explicitly resume the AudioContext (browsers block background audio until resumed)
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      const dest = audioCtx.createMediaStreamDestination();

      // Pipe all video audio sources to our recording stream destination
      exportVideos.forEach((v) => {
        const source = audioCtx.createMediaElementSource(v);
        source.connect(dest);
      });

      // NOTE: We do NOT connect source to audioCtx.destination!
      // This prevents the audio from double-playing through the user's speakers,
      // but still captures it perfectly into the output recording stream!

      audioStreamTrack = dest.stream.getAudioTracks()[0];
    } catch (e) {
      console.warn("Could not capture video audio stream track:", e);
    }

    // Merge audio track into canvas stream
    const exportStream = new MediaStream(canvasStream.getVideoTracks());
    if (audioStreamTrack) {
      exportStream.addTrack(audioStreamTrack);
    }

    // Initialize MediaRecorder with parameters optimized for hardware acceleration and stability
    let options: MediaRecorderOptions = {};
    const preferredTypes = [
      "video/webm;codecs=h264,opus",
      "video/mp4;codecs=avc1",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9,opus",
      "video/webm",
    ];
    for (const mimeType of preferredTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        options = { mimeType, videoBitsPerSecond: 15000000 }; // 15 Mbps for high quality 60fps
        break;
      }
    }

    const mediaRecorder = new MediaRecorder(exportStream, options);
    const chunks: Blob[] = [];
    let isRecording = false;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      isRecording = false;
      exportVideos.forEach((v) => {
        if (v.parentNode) {
          document.body.removeChild(v);
        }
      });
      const actualMime = options.mimeType || "video/webm";
      const fileExt = actualMime.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks, { type: actualMime });

      const finishExport = (finalBlob: Blob) => {
        const url = URL.createObjectURL(finalBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `overlay_render.${fileExt}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setIsExporting(false);
      };

      if (fileExt === "webm") {
        import("fix-webm-duration").then((fixWebmDuration) => {
          const durationMs = (actualEnd - actualStart) * 1000;
          // fix-webm-duration supports Promise-style if callback is omitted.
          // Note: default import handling for dynamic imports.
          const ysFixWebmDuration = fixWebmDuration.default || fixWebmDuration;
          if (typeof ysFixWebmDuration === "function") {
            ysFixWebmDuration(blob, durationMs, { logger: false })
              .then(finishExport)
              .catch((err: Error) => {
                console.error("Failed to fix webm duration", err);
                finishExport(blob);
              });
          } else {
            finishExport(blob);
          }
        }).catch((err) => {
          console.error("Failed to load fix-webm-duration", err);
          finishExport(blob);
        });
      } else {
        finishExport(blob);
      }
    };

    // Find starting video and relative time
    let relativeStart = actualStart;
    let cumulative = 0;
    for (let i = 0; i < videoDurations.length; i++) {
      if (
        actualStart < cumulative + videoDurations[i] ||
        i === videoDurations.length - 1
      ) {
        currentExportVideoIndex = i;
        relativeStart = actualStart - cumulative;
        break;
      }
      cumulative += videoDurations[i];
    }

    exportVideo = exportVideos[currentExportVideoIndex];
    exportVideo.currentTime = relativeStart;

    const onSeeked = () => {
      exportVideo.removeEventListener("seeked", onSeeked);
      isRecording = true;
      mediaRecorder.start(100); // 100ms timeslices for stable memory usage
      exportVideo.play();
    };
    exportVideo.addEventListener("seeked", onSeeked);

    let gHistory: { x: number; y: number }[] = [];
    let trackPath = "";
    let trackScale = 1;
    let trackMinLon = 0;
    let trackMaxLat = 0;
    let trackHasGPS = false;
    let tPadding = 20;
    let tSvgW = 200,
      tSvgH = 200;
    let trackLonSpan = 0;
    let trackLatSpan = 0;

    if (localTelemetry?.rows && localTelemetry.rows.length > 5) {
      const validPoints = localTelemetry.rows.filter(
        (p: any) => p.lat !== 0 && p.lon !== 0,
      );
      if (validPoints.length > 5) {
        let minLat = Infinity,
          maxLat = -Infinity,
          minLon = Infinity,
          maxLon = -Infinity;
        for (const p of validPoints) {
          if (p.lat < minLat) minLat = p.lat;
          if (p.lat > maxLat) maxLat = p.lat;
          if (p.lon < minLon) minLon = p.lon;
          if (p.lon > maxLon) maxLon = p.lon;
        }
        trackLatSpan = maxLat - minLat;
        trackLonSpan = maxLon - minLon;
        if (trackLatSpan > 0 && trackLonSpan > 0) {
          trackHasGPS = true;
          const scaleX = (tSvgW - tPadding * 2) / trackLonSpan;
          const scaleY = (tSvgH - tPadding * 2) / trackLatSpan;
          trackScale = Math.min(scaleX, scaleY);
          trackMinLon = minLon;
          trackMaxLat = maxLat;

          validPoints.forEach((p: any, idx: number) => {
            const x =
              tPadding +
              (p.lon - minLon) * trackScale +
              (tSvgW - tPadding * 2 - trackLonSpan * trackScale) / 2;
            const y =
              tPadding +
              (maxLat - p.lat) * trackScale +
              (tSvgH - tPadding * 2 - trackLatSpan * trackScale) / 2;
            if (idx === 0) trackPath += `M ${x.toFixed(2)} ${y.toFixed(2)}`;
            else trackPath += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
          });
          trackPath += " Z";
        }
      }
    }

    const cachedPath2D = trackHasGPS ? new Path2D(trackPath) : null;

    const renderLoop = () => {
      if (!isRecording) return;

      const vTimeLocal = exportVideo.currentTime;
      const vTime =
        videoDurations
          .slice(0, currentExportVideoIndex)
          .reduce((a, b) => a + b, 0) + vTimeLocal;

      if (vTime >= actualEnd || exportVideo.ended) {
        if (
          exportVideo.ended &&
          currentExportVideoIndex < exportVideos.length - 1 &&
          vTime < actualEnd
        ) {
          // Move to next video
          currentExportVideoIndex++;
          exportVideo = exportVideos[currentExportVideoIndex];
          exportVideo.currentTime = 0;
          exportVideo.play();
          requestAnimationFrame(renderLoop);
          return;
        } else {
          if (mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
          }
          isRecording = false;
          return;
        }
      }

      // 1. Draw video frame to canvas
      ctx.drawImage(exportVideo, 0, 0, canvas.width, canvas.height);

      // 2. Interpolate active telemetry metrics
      const totalExportDuration = actualEnd - actualStart;
      setExportProgress(
        Math.max(
          0,
          Math.min(
            100,
            Math.round(((vTime - actualStart) / totalExportDuration) * 100),
          ),
        ),
      );

      const tTime = (vTime - syncOffset) * speedScale;
      const rows = localTelemetry.rows;
      let matchedTelemetry = {
        speed: 0,
        rpm: 0,
        latAcc: 0,
        lonAcc: 0,
        lat: 0,
        lon: 0,
        lap: 1,
        distance: 0,
      };

      // Simple interpolation loop
      let low = 0,
        high = rows.length - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (rows[mid].time === tTime) {
          const m = rows[mid];
          matchedTelemetry = {
            speed: m.speed,
            rpm: m.rpm,
            latAcc: m.latAcc,
            lonAcc: m.lonAcc,
            lat: m.lat,
            lon: m.lon,
            lap: m.lap || 1,
            distance: m.distance || 0,
          };
          break;
        } else if (rows[mid].time < tTime) low = mid + 1;
        else high = mid - 1;
      }

      if (matchedTelemetry.speed === 0) {
        const idxA = Math.max(0, Math.min(high, rows.length - 2));
        const idxB = idxA + 1;
        const rA = rows[idxA],
          rB = rows[idxB];
        if (rA && rB && rB.time !== rA.time) {
          const frac = Math.max(
            0,
            Math.min(1, (tTime - rA.time) / (rB.time - rA.time)),
          );
          matchedTelemetry = {
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
      }

      // Maintain G-Force trace history
      if (
        gHistory.length === 0 ||
        gHistory[gHistory.length - 1].x !== matchedTelemetry.latAcc ||
        gHistory[gHistory.length - 1].y !== matchedTelemetry.lonAcc
      ) {
        gHistory.push({
          x: matchedTelemetry.latAcc,
          y: matchedTelemetry.lonAcc,
        });
        if (gHistory.length > 6) gHistory.shift();
      }

      // 3. Render Telemetry overlays on top of the canvas frame
      drawCanvasHUD(
        ctx,
        canvas.width,
        canvas.height,
        matchedTelemetry,
        gHistory,
        {
          cachedPath2D,
          trackScale,
          trackMinLon,
          trackMaxLat,
          trackHasGPS,
          tSvgW,
          tSvgH,
          tPadding,
          trackLonSpan,
          trackLatSpan,
          telemetryTime: tTime,
          lapTimesStarts: lapTimes.starts,
          lapTimesLaps: lapTimes.laps,
          lapTimesStartDistances: lapTimes.startDistances,
          formatLapTime,
          bestLapTimeStr: formatLapTime(bestLapInfo.time),
          bestLapNum: bestLapInfo.lap,
          bestLapRows,
        },
      );

      requestAnimationFrame(renderLoop);
    };

    exportVideo.onplay = () => {
      requestAnimationFrame(renderLoop);
    };
  };

  // GPU Canvas Overlay Drawing Functions
  const drawCanvasHUD = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tel: {
      speed: number;
      rpm: number;
      latAcc: number;
      lonAcc: number;
      lat: number;
      lon: number;
      lap: number;
      distance: number;
    },
    gHistory: { x: number; y: number }[],
    trackMapProps: any,
  ) => {
    ctx.save();

    // SPEEDOMETER WIDGET DRAW
    if (layoutConfig.speedometer?.visible) {
      const wX = (layoutConfig.speedometer.x / 100) * width;
      const wY = (layoutConfig.speedometer.y / 100) * height;
      const wW = (layoutConfig.speedometer.w / 100) * width;
      const wH = (layoutConfig.speedometer.h / 100) * height;

      const cx = wX + wW / 2;
      const cy = wY + wH / 2;
      const r = Math.min(wW, wH) * 0.35;

      ctx.beginPath();
      ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (405 * Math.PI) / 180);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = r * 0.15;
      ctx.lineCap = "round";
      ctx.stroke();

      const clampedPct = Math.min(1, Math.max(0, tel.speed / 260));
      if (clampedPct > 0) {
        const endAngle = 135 + clampedPct * 270;
        ctx.beginPath();
        ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (endAngle * Math.PI) / 180);
        ctx.strokeStyle = "#22d3ee";
        ctx.lineWidth = r * 0.15;
        ctx.lineCap = "round";
        ctx.shadowColor = "rgba(34,211,238,0.5)";
        ctx.shadowBlur = r * 0.1;
        ctx.stroke();
        ctx.shadowBlur = 0; // reset
      }

      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${r * 0.55}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(Math.round(tel.speed).toString(), cx, cy);

      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.font = `bold ${r * 0.15}px sans-serif`;
      ctx.fillText("KM/H", cx, cy + r * 0.35);
    }

    // RPM GAUGE DRAW
    if (layoutConfig.rpmGauge?.visible) {
      const wX = (layoutConfig.rpmGauge.x / 100) * width;
      const wY = (layoutConfig.rpmGauge.y / 100) * height;
      const wW = (layoutConfig.rpmGauge.w / 100) * width;
      const wH = (layoutConfig.rpmGauge.h / 100) * height;

      const cx = wX + wW / 2;
      const cy = wY + wH / 2;
      const r = Math.min(wW, wH) * 0.3;
      const maxRpm = 15000;
      const clampedPct = Math.min(1, Math.max(0, tel.rpm / maxRpm));

      let arcColor = "#10b981";
      if (clampedPct > 0.85) arcColor = "#f43f5e";
      else if (clampedPct > 0.65) arcColor = "#fb923c";
      else if (clampedPct > 0.45) arcColor = "#fbbf24";

      ctx.beginPath();
      ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (405 * Math.PI) / 180);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = r * 0.15;
      ctx.lineCap = "round";
      ctx.stroke();

      if (clampedPct > 0) {
        const endAngle = 135 + clampedPct * 270;
        ctx.beginPath();
        ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (endAngle * Math.PI) / 180);
        ctx.strokeStyle = arcColor;
        ctx.lineWidth = r * 0.15;
        ctx.lineCap = "round";
        ctx.shadowColor = arcColor;
        ctx.shadowBlur = r * 0.1;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${r * 0.4}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(Math.round(tel.rpm).toString(), cx, cy);

      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.font = `bold ${r * 0.15}px sans-serif`;
      ctx.fillText("RPM", cx, cy + r * 0.3);
    }

    // G-FORCE GAUGE DRAW
    if (layoutConfig.gForceRadar?.visible) {
      const wX = (layoutConfig.gForceRadar.x / 100) * width;
      const wY = (layoutConfig.gForceRadar.y / 100) * height;
      const wW = (layoutConfig.gForceRadar.w / 100) * width;
      const wH = (layoutConfig.gForceRadar.h / 100) * height;

      const cx = wX + wW / 2;
      const cy = wY + wH / 2;
      const r = Math.min(wW, wH) * 0.35;
      const maxG = 1.6;

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold ${r * 0.15}px monospace`;
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText(`LAT: `, cx - r * 0.4, cy - r - r * 0.2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(`${tel.latAcc.toFixed(2)}G`, cx - r * 0.1, cy - r - r * 0.2);

      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText(`LON: `, cx + r * 0.4, cy - r - r * 0.2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(`${tel.lonAcc.toFixed(2)}G`, cx + r * 0.7, cy - r - r * 0.2);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = Math.max(1, r * 0.015);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx.beginPath();
      ctx.arc(cx, cy, r * (1.0 / maxG), 0, 2 * Math.PI);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.5 / maxG), 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();

      const getGCoords = (gX: number, gY: number) => {
        const x = cx - (gX / maxG) * r;
        const y = cy + (gY / maxG) * r;
        return {
          x: Math.max(cx - r, Math.min(cx + r, x)),
          y: Math.max(cy - r, Math.min(cy + r, y)),
        };
      };

      gHistory.slice(0, -1).forEach((gPoint, index) => {
        const coords = getGCoords(gPoint.x, gPoint.y);
        const opacity = (index + 1) / gHistory.length;
        const size = r * 0.03 + opacity * (r * 0.05);
        ctx.beginPath();
        ctx.arc(coords.x, coords.y, size, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(244, 63, 94, ${opacity * 0.4})`;
        ctx.fill();
      });

      const currentCoords = getGCoords(tel.latAcc, tel.lonAcc);
      ctx.beginPath();
      ctx.arc(currentCoords.x, currentCoords.y, r * 0.1, 0, 2 * Math.PI);
      ctx.fillStyle = "#f43f5e";
      ctx.shadowColor = "rgba(244, 63, 94, 0.8)";
      ctx.shadowBlur = r * 0.1;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(currentCoords.x, currentCoords.y, r * 0.03, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }

    // TRACK MAP DRAW
    if (layoutConfig.trackMap?.visible && trackMapProps.trackHasGPS) {
      const wX = (layoutConfig.trackMap.x / 100) * width;
      const wY = (layoutConfig.trackMap.y / 100) * height;
      const wW = (layoutConfig.trackMap.w / 100) * width;
      const wH = (layoutConfig.trackMap.h / 100) * height;

      // Create a clipping region or just scale perfectly into the box
      const scaleToFit = Math.min(
        wW / trackMapProps.tSvgW,
        wH / trackMapProps.tSvgH,
      );
      const cx = wX + (wW - trackMapProps.tSvgW * scaleToFit) / 2;
      const cy = wY + (wH - trackMapProps.tSvgH * scaleToFit) / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scaleToFit, scaleToFit);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (trackMapProps.cachedPath2D) {
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 5;
        ctx.stroke(trackMapProps.cachedPath2D);

        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 2;
        ctx.stroke(trackMapProps.cachedPath2D);
      }

      // Draw current pos
      if (tel.lat !== 0 && tel.lon !== 0) {
        const ptX =
          trackMapProps.tPadding +
          (tel.lon - trackMapProps.trackMinLon) * trackMapProps.trackScale +
          (trackMapProps.tSvgW -
            trackMapProps.tPadding * 2 -
            trackMapProps.trackLonSpan * trackMapProps.trackScale) /
            2;
        const ptY =
          trackMapProps.tPadding +
          (trackMapProps.trackMaxLat - tel.lat) * trackMapProps.trackScale +
          (trackMapProps.tSvgH -
            trackMapProps.tPadding * 2 -
            trackMapProps.trackLatSpan * trackMapProps.trackScale) /
            2;

        ctx.beginPath();
        ctx.arc(ptX, ptY, 5, 0, 2 * Math.PI);
        ctx.fillStyle = "#22d3ee";
        ctx.shadowColor = "#22d3ee";
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.arc(ptX, ptY, 1.5, 0, 2 * Math.PI);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
      ctx.restore();
    }

    // LAP TIMER WIDGET DRAW
    if (layoutConfig.lapTimer?.visible) {
      const wX = (layoutConfig.lapTimer.x / 100) * width;
      const wY = (layoutConfig.lapTimer.y / 100) * height;
      const wW = (layoutConfig.lapTimer.w / 100) * width;
      const cqw = wW / 100;
      const wH = 34 * cqw; // matches React component height: 5(pt) + 4.5(lap) + 2.5(mt) + 3.5(label) + 0.5(mt) + 12(value) + 6(pb) = 34cqw

      ctx.save();
      
      // Background and border-radius
      drawRoundedRect(ctx, wX, wY, wW, wH, 6 * cqw);
      ctx.fillStyle = "rgba(9, 9, 11, 0.7)";
      ctx.fill();
      
      // Left border clip & draw
      ctx.save();
      drawRoundedRect(ctx, wX, wY, wW, wH, 6 * cqw);
      ctx.clip();
      ctx.fillStyle = "#22d3ee";
      ctx.fillRect(wX, wY, 1.5 * cqw, wH);
      ctx.restore();

      // Outer border
      ctx.strokeStyle = "rgba(39, 39, 42, 0.8)";
      ctx.lineWidth = 1;
      drawRoundedRect(ctx, wX, wY, wW, wH, 6 * cqw);
      ctx.stroke();

      const elapsed = Math.max(
        0,
        (trackMapProps.telemetryTime || 0) -
          (trackMapProps.lapTimesStarts?.[tel.lap] || 0),
      );
      const curTimeStr = trackMapProps.formatLapTime
        ? trackMapProps.formatLapTime(elapsed)
        : "0:00.00";
      const bestTimeStr = trackMapProps.bestLapTimeStr || "0:00.00";

      ctx.textBaseline = "top";

      // LAP Text
      ctx.fillStyle = "#22d3ee";
      ctx.font = `900 ${4.5 * cqw}px sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(`LAP ${tel.lap}`, wX + 5 * cqw, wY + 5 * cqw);

      // Best and Last Lap Times
      let rightY = wY + 5 * cqw;
      
      if (bestTimeStr !== "0:00.00") {
        ctx.textAlign = "right";
        const bestLabel = trackMapProps.bestLapNum > 0 ? `BEST (L${trackMapProps.bestLapNum}):` : "BEST:";
        
        ctx.fillStyle = "#10b981"; // emerald-400
        ctx.font = `900 ${4.5 * cqw}px monospace`;
        const timeWidth = ctx.measureText(bestTimeStr).width;
        
        ctx.fillText(bestTimeStr, wX + wW - 5 * cqw, rightY);
        
        ctx.fillStyle = "#71717a"; // zinc-500
        ctx.font = `900 ${3.5 * cqw}px sans-serif`;
        ctx.fillText(bestLabel, wX + wW - 5 * cqw - timeWidth - 1.5 * cqw, rightY + 0.5 * cqw);
        
        rightY += 4.5 * cqw + 0.5 * cqw;
      }

      const prevDuration = trackMapProps.lapTimesLaps?.[tel.lap - 1] || 0;
      if (prevDuration > 0 && trackMapProps.formatLapTime) {
        const lastTimeStr = trackMapProps.formatLapTime(prevDuration);
        ctx.textAlign = "right";
        
        ctx.fillStyle = "#d4d4d8"; // zinc-300
        ctx.font = `bold ${4.5 * cqw}px monospace`;
        const timeWidth = ctx.measureText(lastTimeStr).width;
        
        ctx.fillText(lastTimeStr, wX + wW - 5 * cqw, rightY);
        
        ctx.fillStyle = "#71717a"; // zinc-500
        ctx.font = `900 ${3.5 * cqw}px sans-serif`;
        ctx.fillText("LAST:", wX + wW - 5 * cqw - timeWidth - 1.5 * cqw, rightY + 0.5 * cqw);
      }

      // CURRENT TIME Label
      ctx.fillStyle = "rgba(161, 161, 170, 1)"; // zinc-400
      ctx.font = `bold ${3.5 * cqw}px sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText("CURRENT TIME", wX + 5 * cqw, wY + 12 * cqw);

      // CURRENT TIME Value
      ctx.fillStyle = "#f4f4f5";
      ctx.font = `900 ${12 * cqw}px monospace`;
      ctx.fillText(curTimeStr, wX + 5 * cqw, wY + 16 * cqw);

      ctx.restore();
    }

    // DELTA BAR WIDGET DRAW
    if (layoutConfig.deltaBar?.visible) {
      const wX = (layoutConfig.deltaBar.x / 100) * width;
      const wY = (layoutConfig.deltaBar.y / 100) * height;
      const wW = (layoutConfig.deltaBar.w / 100) * width;
      const cqw = wW / 100;

      ctx.save();

      const bestLapNum = trackMapProps.bestLapNum || 0;
      const bestLapRows = trackMapProps.bestLapRows || [];
      const hasBestLap = bestLapNum > 0 && bestLapRows.length > 0;
      
      let delta = 0;
      if (hasBestLap && tel.lap !== bestLapNum) {
        const startDistances = trackMapProps.lapTimesStartDistances || {};
        const starts = trackMapProps.lapTimesStarts || {};
        
        const curStartDist = startDistances[tel.lap] || 0;
        const curStartTime = starts[tel.lap] || 0;
        
        const elapsedDist = tel.distance - curStartDist;
        const elapsedTime = (trackMapProps.telemetryTime || 0) - curStartTime;
        
        const bestStartDist = startDistances[bestLapNum] || 0;
        const bestStartTime = starts[bestLapNum] || 0;

        let low = 0;
        let high = bestLapRows.length - 1;
        let matchIdx = -1;

        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const midDist = bestLapRows[mid].distance - bestStartDist;
          if (midDist === elapsedDist) {
            matchIdx = mid;
            break;
          } else if (midDist < elapsedDist) {
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }

        let bestLapTime = 0;
        if (matchIdx !== -1) {
          bestLapTime = bestLapRows[matchIdx].time - bestStartTime;
        } else {
          const idxB = Math.min(low, bestLapRows.length - 1);
          const idxA = Math.max(0, idxB - 1);
          const rowA = bestLapRows[idxA];
          const rowB = bestLapRows[idxB];

          const distA = rowA.distance - bestStartDist;
          const distB = rowB.distance - bestStartDist;

          let fraction = 0;
          if (distB !== distA) {
            fraction = Math.max(0, Math.min(1, (elapsedDist - distA) / (distB - distA)));
          }

          const timeA = rowA.time - bestStartTime;
          const timeB = rowB.time - bestStartTime;
          bestLapTime = timeA + fraction * (timeB - timeA);
        }

        delta = elapsedTime - bestLapTime;
      }

      // Title
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#71717a";
      ctx.font = `900 ${3 * cqw}px sans-serif`;
      ctx.fillText("LAP DELTA", wX + wW / 2, wY + 4 * cqw);

      // Value
      let valueStr = "0.00";
      let valColor = "#a1a1aa";
      if (!hasBestLap) {
        valueStr = "--.--";
        valColor = "#71717a";
      } else if (delta < 0) {
        valueStr = delta.toFixed(2);
        valColor = "#22d3ee";
      } else if (delta > 0) {
        valueStr = "+" + delta.toFixed(2);
        valColor = "#f43f5e";
      }

      ctx.fillStyle = valColor;
      ctx.font = `900 ${7 * cqw}px monospace`;
      ctx.fillText(valueStr, wX + wW / 2, wY + 7.5 * cqw);

      // Visual Bar background track
      const barY = wY + 16 * cqw;
      const barH = 3 * cqw;
      const barW = wW - 10 * cqw;
      const barX = wX + 5 * cqw;

      // Draw bar track rounded rect
      drawRoundedRect(ctx, barX, barY, barW, barH, 1.5 * cqw);
      ctx.fillStyle = "#18181b";
      ctx.fill();
      ctx.strokeStyle = "rgba(39, 39, 42, 0.6)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Center divider tick
      ctx.fillStyle = "rgba(113, 113, 122, 0.8)";
      ctx.fillRect(barX + barW / 2 - 0.25 * cqw, barY, 0.5 * cqw, barH);

      // Draw visual delta fill
      if (hasBestLap && delta !== 0) {
        const clampLimit = 2.0;
        const clampedDelta = Math.max(-clampLimit, Math.min(clampLimit, delta));
        const barPercent = Math.abs(clampedDelta) / clampLimit;
        const fillW = barPercent * (barW / 2);
        
        ctx.save();
        if (delta < 0) {
          ctx.fillStyle = "#22d3ee";
          ctx.shadowColor = "#22d3ee";
          ctx.shadowBlur = 6;
          ctx.fillRect(barX + barW / 2 - fillW, barY, fillW, barH);
        } else {
          ctx.fillStyle = "#f43f5e";
          ctx.shadowColor = "#f43f5e";
          ctx.shadowBlur = 6;
          ctx.fillRect(barX + barW / 2, barY, fillW, barH);
        }
        ctx.restore();
      }

      ctx.restore();
    }

    ctx.restore();
  };

  const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  // Get active telemetry row details for wizard UI
  const wizardTelemetryRow = useMemo(() => {
    if (!localTelemetry?.rows || localTelemetry.rows.length === 0) return null;
    return localTelemetry.rows[
      Math.min(modalTelemetryIdx, localTelemetry.rows.length - 1)
    ];
  }, [localTelemetry, modalTelemetryIdx]);

  const currentTelemetryTime = useMemo(() => {
    return (currentTime - syncOffset) * speedScale;
  }, [currentTime, syncOffset, speedScale]);

  const currentLapElapsed = useMemo(() => {
    const start = lapTimes.starts[currentTelemetry.lap] || 0;
    return Math.max(0, currentTelemetryTime - start);
  }, [lapTimes, currentTelemetry.lap, currentTelemetryTime]);

  const currentDelta = useMemo(() => {
    const elapsedDist =
      currentTelemetry.distance -
      (lapTimes.startDistances?.[currentTelemetry.lap] || 0);
    return getDeltaTime(currentTelemetry.lap, currentLapElapsed, elapsedDist);
  }, [
    currentTelemetry.lap,
    currentTelemetry.distance,
    currentLapElapsed,
    lapTimes,
    bestLapRows,
    bestLapInfo,
  ]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full max-w-7xl px-4 py-6 text-zinc-100 select-none relative">
      {/* EXPORT TRIM PREVIEW MODAL */}
      {isExportModalOpen && videoUrls.length > 0 && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-zinc-800">
              <div className="flex flex-col">
                <div className="flex items-center space-x-2">
                  <Video className="text-cyan-400" size={18} />
                  <h3 className="text-sm font-black uppercase tracking-wider text-zinc-100">
                    Trim & Render Overlay Video
                  </h3>
                </div>
                <p className="text-[9px] text-zinc-550 uppercase tracking-wider mt-0.5 ml-6 font-semibold">
                  Preview video, select start/end crop marks, and export in
                  ultra-high quality
                </p>
              </div>
              <button
                onClick={() => setIsExportModalOpen(false)}
                className="p-1 text-zinc-500 hover:text-zinc-300 rounded-lg transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 flex flex-col space-y-4 overflow-y-auto">
              {/* Preview player */}
              <div className="relative aspect-video rounded-2xl overflow-hidden border border-zinc-800 bg-black">
                <video
                  ref={exportPreviewVideoRef}
                  src={videoUrls[0]}
                  className="w-full h-full object-cover"
                  onTimeUpdate={() => {
                    if (exportPreviewVideoRef.current) {
                      setExportPreviewTime(
                        exportPreviewVideoRef.current.currentTime,
                      );
                    }
                  }}
                  controls
                />
              </div>

              {/* Position and Format */}
              <div className="flex justify-between items-center text-xs font-mono text-zinc-400 bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-850">
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
                    Total Duration:
                  </span>
                  <span className="text-zinc-300 font-bold">
                    {formatTimeMinutes(videoDuration)}
                  </span>
                </div>
              </div>

              {/* Crop control range highlight timeline bar */}
              <div className="flex flex-col space-y-4 bg-zinc-950/40 border border-zinc-800/80 p-4 rounded-2xl">
                {/* Trim Sliders */}
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
                          left: `${(exportStart / videoDuration) * 100}%`,
                          width: `${((exportEnd - exportStart) / videoDuration) * 100}%`,
                        }}
                      />
                      <input
                        type="range"
                        min={0}
                        max={videoDuration || 100}
                        step={0.5}
                        value={exportStart}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          const newStart = Math.min(val, exportEnd);
                          setExportStart(newStart);
                          if (exportPreviewVideoRef.current) {
                            exportPreviewVideoRef.current.currentTime =
                              newStart;
                          }
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
                          left: `${(exportStart / videoDuration) * 100}%`,
                          width: `${((exportEnd - exportStart) / videoDuration) * 100}%`,
                        }}
                      />
                      <input
                        type="range"
                        min={0}
                        max={videoDuration || 100}
                        step={0.5}
                        value={
                          exportEnd === 0 && videoDuration > 0
                            ? videoDuration
                            : exportEnd
                        }
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          const newEnd = Math.max(val, exportStart);
                          setExportEnd(newEnd);
                          if (exportPreviewVideoRef.current) {
                            exportPreviewVideoRef.current.currentTime = newEnd;
                          }
                        }}
                        className="w-full accent-cyan-400 h-1 bg-transparent rounded-lg appearance-none cursor-pointer z-10"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-800 flex justify-end space-x-3 rounded-b-3xl">
              <button
                onClick={() => setIsExportModalOpen(false)}
                className="px-4 py-2 border border-zinc-850 hover:bg-zinc-900 text-zinc-300 font-extrabold text-[10px] uppercase tracking-wider rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setIsExportModalOpen(false);
                  handleExportVideo();
                }}
                className="bg-cyan-400 hover:bg-cyan-500 text-zinc-950 font-black px-6 py-2 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer shadow-[0_0_15px_rgba(34,211,238,0.25)] flex items-center space-x-1.5"
              >
                <Download size={12} />
                <span>Start GPU Render</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exporter Progress HUD overlay modal */}
      {isExporting && (
        <div className="absolute inset-0 bg-zinc-950/95 flex flex-col items-center justify-center z-50 rounded-3xl border border-zinc-800 space-y-6">
          <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-3xl text-center space-y-4 max-w-sm shadow-2xl relative">
            <RefreshCw
              size={44}
              className="animate-spin text-cyan-400 mx-auto"
            />
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-zinc-200">
                Exporting Telemetry Overlay
              </h3>
              <p className="text-[10px] text-zinc-550 mt-1 uppercase font-semibold">
                Rendering Frame-by-Frame via GPU Hardware Canvas
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-zinc-950 rounded-full h-2.5 overflow-hidden border border-zinc-850">
              <div
                className="bg-cyan-500 h-full transition-all duration-300 shadow-[0_0_8px_#22d3ee]"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
            <div className="text-xs font-mono font-bold text-zinc-400">
              {exportProgress}% Completed
            </div>
          </div>
        </div>
      )}

      {/* TELEMETRY SYNC WIZARD MODAL */}
      {isSyncModalOpen && localTelemetry && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-zinc-800">
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

            {/* Main content splitter (3 columns: Video Scanner, Telemetry Scanner, Live Circuit Map) */}
            <div className="grid grid-cols-1 md:grid-cols-12 overflow-y-auto">
              {/* Left Panel (Col 4): Video Scanner */}
              <div className="md:col-span-4 p-6 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-col space-y-4">
                <h4 className="text-xs font-extrabold uppercase text-cyan-400 tracking-wider flex items-center space-x-1.5">
                  <Video size={12} />
                  <span>1. Align Video Position</span>
                </h4>

                {/* Micro video player */}
                <div className="aspect-video bg-black rounded-2xl overflow-hidden border border-zinc-800 flex items-center justify-center relative">
                  {videoUrls.length > 0 ? (
                    <video
                      ref={modalVideoRef}
                      src={videoUrls[0]}
                      className="w-full h-full object-cover"
                      controls={false}
                      onTimeUpdate={() => {
                        if (modalVideoRef.current) {
                          setModalVideoTime(modalVideoRef.current.currentTime);
                        }
                      }}
                    />
                  ) : (
                    <span className="text-[10px] text-zinc-650 uppercase font-bold">
                      POV Video Not Loaded
                    </span>
                  )}
                </div>

                {/* Precision Video Scrubbing Controls */}
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
                    onChange={(e) => {
                      const t = parseFloat(e.target.value);
                      setModalVideoTime(t);
                      if (modalVideoRef.current)
                        modalVideoRef.current.currentTime = t;
                    }}
                    className="w-full accent-cyan-400 h-1 bg-zinc-950 rounded-lg appearance-none cursor-pointer"
                  />

                  {/* Micro adjustment buttons */}
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    <button
                      onClick={() => {
                        const t = Math.max(0, modalVideoTime - 1.0);
                        setModalVideoTime(t);
                        if (modalVideoRef.current)
                          modalVideoRef.current.currentTime = t;
                      }}
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-850 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition"
                    >
                      -1.0s
                    </button>
                    <button
                      onClick={() => {
                        const t = Math.max(0, modalVideoTime - 0.1);
                        setModalVideoTime(t);
                        if (modalVideoRef.current)
                          modalVideoRef.current.currentTime = t;
                      }}
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-855 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition"
                    >
                      -0.1s
                    </button>
                    <button
                      onClick={() => {
                        const t = Math.min(videoDuration, modalVideoTime + 0.1);
                        setModalVideoTime(t);
                        if (modalVideoRef.current)
                          modalVideoRef.current.currentTime = t;
                      }}
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-855 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition"
                    >
                      +0.1s
                    </button>
                    <button
                      onClick={() => {
                        const t = Math.min(videoDuration, modalVideoTime + 1.0);
                        setModalVideoTime(t);
                        if (modalVideoRef.current)
                          modalVideoRef.current.currentTime = t;
                      }}
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-850 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition"
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
                        {wizardTelemetryRow.lap === 1
                          ? "Out Lap"
                          : `Lap ${wizardTelemetryRow.lap - 1}`}
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
                  <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                    <span>Row Index:</span>
                    <span className="font-bold text-zinc-500">
                      {modalTelemetryIdx} / {localTelemetry.rows.length - 1}
                    </span>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={localTelemetry.rows.length - 1}
                    step={1}
                    value={modalTelemetryIdx}
                    onChange={(e) =>
                      setModalTelemetryIdx(parseInt(e.target.value) || 0)
                    }
                    className="w-full accent-zinc-600 h-0.5 bg-zinc-950 rounded-lg appearance-none cursor-pointer"
                  />

                  {/* Micro buttons */}
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    <button
                      onClick={() =>
                        setModalTelemetryIdx(
                          Math.max(0, modalTelemetryIdx - 100),
                        )
                      }
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-850 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition"
                    >
                      -100 pts
                    </button>
                    <button
                      onClick={() =>
                        setModalTelemetryIdx(Math.max(0, modalTelemetryIdx - 1))
                      }
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-855 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition"
                    >
                      -1 pt
                    </button>
                    <button
                      onClick={() =>
                        setModalTelemetryIdx(
                          Math.min(
                            localTelemetry.rows.length - 1,
                            modalTelemetryIdx + 1,
                          ),
                        )
                      }
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-855 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition"
                    >
                      +1 pt
                    </button>
                    <button
                      onClick={() =>
                        setModalTelemetryIdx(
                          Math.min(
                            localTelemetry.rows.length - 1,
                            modalTelemetryIdx + 100,
                          ),
                        )
                      }
                      className="bg-zinc-950 hover:bg-zinc-855 border border-zinc-850 text-[9px] px-1.5 py-1 rounded font-bold uppercase transition"
                    >
                      +100 pts
                    </button>
                  </div>

                  {/* AUTOMATED LAP JUMP BUTTONS */}
                  <div className="border-t border-zinc-800/80 pt-3 space-y-2">
                    <div className="text-[9px] text-zinc-500 uppercase tracking-widest font-black flex items-center space-x-1">
                      <Flag size={10} />
                      <span>Lap-Start Fast Jumps</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        onClick={() => handleJumpToLap(1)}
                        className="bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-rose-400 hover:text-rose-300 font-extrabold text-[9px] py-1.5 rounded-lg uppercase transition flex flex-col items-center justify-center cursor-pointer space-y-0.5"
                      >
                        <Flag size={8} />
                        <span>1st Lap</span>
                        <span className="text-[7px] text-zinc-500 font-mono">
                          {telemetryLaps.length >= 2
                            ? `Lap ${telemetryLaps[1]}`
                            : "0%"}
                        </span>
                      </button>
                      <button
                        onClick={() => handleJumpToLap(2)}
                        className="bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-rose-400 hover:text-rose-300 font-extrabold text-[9px] py-1.5 rounded-lg uppercase transition flex flex-col items-center justify-center cursor-pointer space-y-0.5"
                      >
                        <Flag size={8} />
                        <span>2nd Lap</span>
                        <span className="text-[7px] text-zinc-500 font-mono">
                          {telemetryLaps.length >= 3
                            ? `Lap ${telemetryLaps[2]}`
                            : "33%"}
                        </span>
                      </button>
                      <button
                        onClick={() => handleJumpToLap(3)}
                        className="bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-rose-400 hover:text-rose-300 font-extrabold text-[9px] py-1.5 rounded-lg uppercase transition flex flex-col items-center justify-center cursor-pointer space-y-0.5"
                      >
                        <Flag size={8} />
                        <span>3rd Lap</span>
                        <span className="text-[7px] text-zinc-500 font-mono">
                          {telemetryLaps.length >= 4
                            ? `Lap ${telemetryLaps[3]}`
                            : "66%"}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* DUAL POINT DRIFT CALIBRATOR */}
                  <div className="border-t border-zinc-800/80 pt-3 space-y-2">
                    <div className="text-[9px] text-zinc-500 uppercase tracking-widest font-black flex items-center space-x-1">
                      <Sliders size={10} />
                      <span>2-Point Clock Drift Correction</span>
                    </div>
                    <p className="text-[8px] text-zinc-600 leading-relaxed">
                      Align a 1st event below, lock it. Then seek BOTH video +
                      telemetry to a 2nd event and lock it. Computes exact scale
                      to correct clock drift.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          if (wizardTelemetryRow) {
                            setSyncPoint1({
                              video: modalVideoTime,
                              telemetry: wizardTelemetryRow.time,
                            });
                          }
                        }}
                        className={`border text-[9px] py-2 rounded-lg uppercase tracking-wider font-extrabold transition cursor-pointer flex flex-col items-center justify-center space-y-0.5 ${
                          syncPoint1
                            ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                            : "bg-zinc-950 hover:bg-zinc-850 border-zinc-850 text-zinc-400"
                        }`}
                      >
                        <span>📍 Lock Point A</span>
                        {syncPoint1 ? (
                          <span className="text-[7px] font-mono text-emerald-300">
                            V:{Math.floor(syncPoint1.video / 60)}:
                            {String(Math.floor(syncPoint1.video % 60)).padStart(
                              2,
                              "0",
                            )}{" "}
                            = T:{Math.floor(syncPoint1.telemetry / 60)}:
                            {String(
                              Math.floor(syncPoint1.telemetry % 60),
                            ).padStart(2, "0")}
                          </span>
                        ) : (
                          <span className="text-[7px] text-zinc-550">
                            Seek to event, lock here
                          </span>
                        )}
                      </button>

                      <button
                        onClick={() => {
                          if (wizardTelemetryRow) {
                            setSyncPoint2({
                              video: modalVideoTime,
                              telemetry: wizardTelemetryRow.time,
                            });
                          }
                        }}
                        className={`border text-[9px] py-2 rounded-lg uppercase tracking-wider font-extrabold transition cursor-pointer flex flex-col items-center justify-center space-y-0.5 ${
                          syncPoint2
                            ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                            : "bg-zinc-950 hover:bg-zinc-850 border-zinc-850 text-zinc-400"
                        }`}
                      >
                        <span>📍 Lock Point B</span>
                        {syncPoint2 ? (
                          <span className="text-[7px] font-mono text-emerald-300">
                            V:{Math.floor(syncPoint2.video / 60)}:
                            {String(Math.floor(syncPoint2.video % 60)).padStart(
                              2,
                              "0",
                            )}{" "}
                            = T:{Math.floor(syncPoint2.telemetry / 60)}:
                            {String(
                              Math.floor(syncPoint2.telemetry % 60),
                            ).padStart(2, "0")}
                          </span>
                        ) : (
                          <span className="text-[7px] text-zinc-550">
                            Seek to 2nd event, lock here
                          </span>
                        )}
                      </button>
                    </div>

                    {syncPoint1 && syncPoint2 && (
                      <div className="bg-zinc-950 border border-zinc-850 rounded-xl p-2.5 text-[9px] font-mono space-y-1">
                        <div className="flex items-center justify-between text-zinc-400">
                          <span>Computed Scale:</span>
                          <span
                            className={`font-extrabold ${
                              Math.abs(syncPoint2.video - syncPoint1.video) >
                              0.5
                                ? "text-cyan-400"
                                : "text-rose-400"
                            }`}
                          >
                            {Math.abs(syncPoint2.video - syncPoint1.video) > 0.5
                              ? (
                                  (syncPoint2.telemetry -
                                    syncPoint1.telemetry) /
                                  (syncPoint2.video - syncPoint1.video)
                                ).toFixed(6) + "x"
                              : "⚠ Points too close"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-zinc-400">
                          <span>Computed Offset:</span>
                          <span className="text-cyan-400 font-extrabold">
                            {Math.abs(syncPoint2.video - syncPoint1.video) > 0.5
                              ? (() => {
                                  const s =
                                    (syncPoint2.telemetry -
                                      syncPoint1.telemetry) /
                                    (syncPoint2.video - syncPoint1.video);
                                  return (
                                    (
                                      syncPoint1.video -
                                      syncPoint1.telemetry / s
                                    ).toFixed(3) + "s"
                                  );
                                })()
                              : "—"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Panel (Col 4): Track Map Visual Positioner */}
              <div className="md:col-span-4 p-6 flex flex-col space-y-4">
                <h4 className="text-xs font-extrabold uppercase text-cyan-400 tracking-wider flex items-center space-x-1.5">
                  <MapPin size={12} />
                  <span>3. Visual Track Coordinate</span>
                </h4>

                {/* Circuit Map driven by Wizard coordinates */}
                <div className="w-full aspect-square md:aspect-auto md:grow min-h-50 border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-950/60 p-2">
                  <TrackMap
                    gpsPoints={gpsPoints}
                    currentLat={wizardTelemetryRow ? wizardTelemetryRow.lat : 0}
                    currentLon={wizardTelemetryRow ? wizardTelemetryRow.lon : 0}
                  />
                </div>
              </div>
            </div>

            {/* Bottom summary and apply */}
            <div className="bg-zinc-950/60 px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between space-y-3 md:space-y-0 border-t border-zinc-800">
              <div className="text-[10px] text-zinc-450 uppercase font-semibold flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex items-center space-x-1.5">
                  <Zap size={14} className="text-cyan-400 animate-bounce" />
                  <span>
                    {syncPoint1 && syncPoint2
                      ? "2-Point Mode — Offset:"
                      : "1-Point Mode — Offset:"}
                  </span>
                  <span className="font-mono font-bold text-zinc-200 text-xs bg-zinc-900 border border-zinc-850 px-2 py-0.5 rounded">
                    {(modalVideoTime - (wizardTelemetryRow?.time || 0)).toFixed(
                      3,
                    )}
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

      {/* LEFT COLUMN: 60% Width - POV Video and Overlays */}
      <div className="lg:col-span-8 flex flex-col space-y-4">
        {/* Main Video Overlay container */}
        <div
          ref={videoContainerRef}
          className="relative bg-zinc-950 rounded-3xl border border-zinc-800/80 shadow-2xl overflow-hidden aspect-video w-full"
          onMouseMove={handleOverlayMouseMove}
          onMouseUp={handleOverlayMouseUp}
          onMouseLeave={handleOverlayMouseUp}
        >
          {videoUrls.length > 0 ? (
            <video
              ref={videoRef}
              src={videoUrls[activeVideoIndex]}
              className="w-full h-full object-cover rounded-3xl"
              onEnded={() => {
                if (activeVideoIndex < videoUrls.length - 1) {
                  setActiveVideoIndex(activeVideoIndex + 1);
                  setTimeout(() => {
                    if (videoRef.current && isPlaying) videoRef.current.play();
                  }, 0);
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
                  Load POV Video
                </h3>
                <p className="text-xs text-zinc-400 max-w-xs mt-1">
                  Oog! GoPro POV video not loaded! Select local video to overlay
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

          {/* Absolute HUD Dashboard Overlays */}
          {localTelemetry && (
            <div className="absolute inset-0 pointer-events-none">
              {/* SPEEDOMETER WIDGET */}
              {layoutConfig.speedometer?.visible && (
                <div
                  className={`absolute transition-all duration-75 select-none ${
                    isEditMode
                      ? "pointer-events-auto border-2 border-dashed border-cyan-400 cursor-move bg-cyan-400/10 p-1"
                      : ""
                  }`}
                  style={{
                    left: `${layoutConfig.speedometer.x}%`,
                    top: `${layoutConfig.speedometer.y}%`,
                    width: `${layoutConfig.speedometer.w}%`,
                    height: `${layoutConfig.speedometer.h}%`,
                  }}
                  onMouseDown={(e) => handleWidgetMouseDown(e, "speedometer")}
                >
                  <Speedometer speed={currentTelemetry.speed} />
                </div>
              )}

              {/* RPM WIDGET */}
              {layoutConfig.rpmGauge?.visible && (
                <div
                  className={`absolute transition-all duration-75 select-none ${
                    isEditMode
                      ? "pointer-events-auto border-2 border-dashed border-cyan-400 cursor-move bg-cyan-400/10 p-1"
                      : ""
                  }`}
                  style={{
                    left: `${layoutConfig.rpmGauge.x}%`,
                    top: `${layoutConfig.rpmGauge.y}%`,
                    width: `${layoutConfig.rpmGauge.w}%`,
                    height: `${layoutConfig.rpmGauge.h}%`,
                  }}
                  onMouseDown={(e) => handleWidgetMouseDown(e, "rpmGauge")}
                >
                  <RpmGauge rpm={currentTelemetry.rpm} />
                </div>
              )}

              {/* G-FORCE WIDGET */}
              {layoutConfig.gForceRadar?.visible && (
                <div
                  className={`absolute transition-all duration-75 select-none ${
                    isEditMode
                      ? "pointer-events-auto border-2 border-dashed border-cyan-400 cursor-move bg-cyan-400/10 p-1"
                      : ""
                  }`}
                  style={{
                    left: `${layoutConfig.gForceRadar.x}%`,
                    top: `${layoutConfig.gForceRadar.y}%`,
                    width: `${layoutConfig.gForceRadar.w}%`,
                    height: `${layoutConfig.gForceRadar.h}%`,
                  }}
                  onMouseDown={(e) => handleWidgetMouseDown(e, "gForceRadar")}
                >
                  <GForceRadar
                    latAcc={currentTelemetry.latAcc}
                    lonAcc={currentTelemetry.lonAcc}
                  />
                </div>
              )}

              {/* GPS TRACK MAP WIDGET */}
              {layoutConfig.trackMap?.visible && (
                <div
                  className={`absolute transition-all duration-75 select-none ${
                    isEditMode
                      ? "pointer-events-auto border-2 border-dashed border-cyan-400 cursor-move bg-cyan-400/10 p-1"
                      : ""
                  }`}
                  style={{
                    left: `${layoutConfig.trackMap.x}%`,
                    top: `${layoutConfig.trackMap.y}%`,
                    width: `${layoutConfig.trackMap.w}%`,
                    height: `${layoutConfig.trackMap.h}%`,
                  }}
                  onMouseDown={(e) => handleWidgetMouseDown(e, "trackMap")}
                >
                  <TrackMap
                    gpsPoints={gpsPoints}
                    currentLat={currentTelemetry.lat}
                    currentLon={currentTelemetry.lon}
                  />
                </div>
              )}

              {/* LAP TIMER WIDGET */}
              {layoutConfig.lapTimer?.visible && (
                <div
                  className={`absolute transition-all duration-75 select-none @container ${
                    isEditMode
                      ? "pointer-events-auto border-2 border-dashed border-cyan-400 cursor-move bg-cyan-400/10 p-1"
                      : ""
                  }`}
                  style={{
                    left: `${layoutConfig.lapTimer.x}%`,
                    top: `${layoutConfig.lapTimer.y}%`,
                    width: `${layoutConfig.lapTimer.w}%`,
                    height: "fit-content",
                  }}
                  onMouseDown={(e) => handleWidgetMouseDown(e, "lapTimer")}
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
                </div>
              )}

              {/* DELTA BAR WIDGET */}
              {layoutConfig.deltaBar?.visible && (
                <div
                  className={`absolute transition-all duration-75 select-none @container ${
                    isEditMode
                      ? "pointer-events-auto border-2 border-dashed border-cyan-400 cursor-move bg-cyan-400/10 p-1"
                      : ""
                  }`}
                  style={{
                    left: `${layoutConfig.deltaBar.x}%`,
                    top: `${layoutConfig.deltaBar.y}%`,
                    width: `${layoutConfig.deltaBar.w}%`,
                    height: "fit-content",
                  }}
                  onMouseDown={(e) => handleWidgetMouseDown(e, "deltaBar")}
                >
                  <DeltaBar
                    delta={currentDelta}
                    hasBestLap={bestLapInfo.lap > 0}
                  />
                </div>
              )}
            </div>
          )}

          {/* Quick HUD indicator */}
          {isEditMode && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-cyan-500 text-zinc-950 font-extrabold text-[10px] tracking-widest px-3 py-1 rounded-full uppercase z-10 border border-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.5)]">
              Layout HUD Editor Active - Drag widgets to position
            </div>
          )}
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
            <div className="relative flex-grow h-6 flex items-center">
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
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setCurrentTime(val);

                  let t = 0;
                  let idx = 0;
                  for (let i = 0; i < videoDurations.length; i++) {
                    if (
                      val <= t + videoDurations[i] ||
                      i === videoDurations.length - 1
                    ) {
                      idx = i;
                      break;
                    }
                    t += videoDurations[i];
                  }

                  if (idx !== activeVideoIndex) {
                    setActiveVideoIndex(idx);
                    if (videoRef.current) {
                      videoRef.current.src = videoUrls[idx];
                      videoRef.current.currentTime = val - t;
                      if (isPlaying) videoRef.current.play();
                    }
                  } else {
                    if (videoRef.current)
                      videoRef.current.currentTime = val - t;
                  }
                }}
                className="w-full accent-cyan-400 h-1 bg-zinc-950 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed z-10"
              />
            </div>

            <div className="text-xs font-mono text-zinc-400 select-none tabular-nums w-[110px] text-right">
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

          {/* Sync timeline helper details */}
          {localTelemetry && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-zinc-800 pt-3">
              <div className="flex flex-col space-y-1">
                <div className="flex items-center space-x-2">
                  <Sliders size={14} className="text-cyan-400" />
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">
                    Telemetry Sync Controls
                  </span>
                </div>
                <div className="text-[8px] text-zinc-555 uppercase tracking-wider">
                  Adjust offset and scaling to resolve clock drift
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  onClick={handleOpenSyncWizard}
                  className="flex items-center space-x-1.5 bg-cyan-500 hover:bg-cyan-600 text-zinc-950 font-black px-3 py-1.5 rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                >
                  <Sliders size={12} />
                  <span>Open Sync Wizard</span>
                </button>

                {/* Offset input */}
                <div className="flex items-center space-x-1.5">
                  <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">
                    Offset:
                  </span>
                  <input
                    type="number"
                    step={0.01}
                    value={syncOffset}
                    onChange={(e) =>
                      setSyncOffset(parseFloat(e.target.value) || 0.0)
                    }
                    className="w-20 bg-zinc-950 text-zinc-100 border border-zinc-800 rounded-lg px-2 py-1 text-xs font-mono text-center focus:border-cyan-400 focus:outline-none"
                  />
                  <span className="text-[9px] text-zinc-555 uppercase font-bold">
                    s
                  </span>
                </div>

                {/* Speed Scale input */}
                <div className="flex items-center space-x-1.5">
                  <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">
                    Scale:
                  </span>
                  <input
                    type="number"
                    step={0.001}
                    min={0.5}
                    max={2.0}
                    value={speedScale}
                    onChange={(e) =>
                      setSpeedScale(parseFloat(e.target.value) || 1.0)
                    }
                    className="w-20 bg-zinc-950 text-zinc-100 border border-zinc-800 rounded-lg px-2 py-1 text-xs font-mono text-center focus:border-cyan-400 focus:outline-none"
                  />
                  <span className="text-[9px] text-zinc-555 uppercase font-bold">
                    x
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
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
                    : "Select POV Video"}
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
              }}
              className="w-full bg-cyan-400 hover:bg-cyan-550 text-zinc-950 font-black py-3 rounded-xl text-xs uppercase transition tracking-widest flex items-center justify-center space-x-2 cursor-pointer shadow-[0_0_15px_rgba(34,211,238,0.25)]"
            >
              <Download size={14} />
              <span>Export HUD Overlaid Video</span>
            </button>
          </div>
        )}

        {/* Live HUD Customizer Controls */}
        {localTelemetry && (
          <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-5 rounded-3xl flex flex-col space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex items-center space-x-2">
                <Layers size={14} className="text-cyan-400" />
                <span>HUD Widget Control</span>
              </h3>
              <button
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

            <div className="space-y-2 border-t border-zinc-800/80 pt-3">
              {Object.keys(layoutConfig).map((widgetKey) => {
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
                      <div className="w-8 h-4.5 bg-zinc-950 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-500 after:border-zinc-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-cyan-500 peer-checked:after:bg-zinc-950" />
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
