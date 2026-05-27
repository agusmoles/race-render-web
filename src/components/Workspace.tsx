"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Play,
  Pause,
  Upload,
  Layers,
  Settings,
  RefreshCw,
  Sliders,
  Flame,
  Download,
  Video,
  FileText,
  X,
  ChevronLeft,
  ChevronRight,
  Zap,
  MapPin,
  Flag,
} from "lucide-react";
import { parseTelemetryCSV, ParsedTelemetry } from "@/lib/csv-helper";
import Speedometer from "./gauges/Speedometer";
import RpmGauge from "./gauges/RpmGauge";
import GForceRadar from "./gauges/GForceRadar";
import TrackMap from "./gauges/TrackMap";

export default function Workspace() {
  // Local File Loading
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
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
  const [layoutConfig, setLayoutConfig] = useState<Record<string, any>>({
    speedometer: { x: 3, y: 70, w: 20, h: 25, visible: true },
    rpmGauge: { x: 25, y: 88, w: 50, h: 10, visible: true },
    gForceRadar: { x: 77, y: 70, w: 20, h: 25, visible: true },
    trackMap: { x: 3, y: 3, w: 22, h: 30, visible: true },
  });

  // Video Ref & Playback state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // High performance telemetry interpolation state
  const [currentTelemetry, setCurrentTelemetry] = useState({
    speed: 0,
    rpm: 0,
    latAcc: 0,
    lonAcc: 0,
    lat: 0,
    lon: 0,
  });

  // Telemetry Sync Wizard Modal State
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
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

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setIsPlaying(false);
      setCurrentTime(0);
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
      } catch (err: any) {
        console.error(err);
        setUploadError("Error reading telemetry: " + err.message);
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

      const videoTime = videoRef.current.currentTime;

      // OPTIMIZATION: Only update states and trigger re-renders if the video play clock actually advanced
      if (videoTime !== lastTime) {
        lastTime = videoTime;
        setCurrentTime(videoTime);

        // Align telemetry timestamp and apply time scaling (playback speed scaling)
        const telemetryTime = (videoTime - syncOffset) * speedScale;
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
            });
          }
        }
      }

      animationFrameId = requestAnimationFrame(updateInterpolatedTelemetry);
    };

    animationFrameId = requestAnimationFrame(updateInterpolatedTelemetry);
    return () => cancelAnimationFrame(animationFrameId);
  }, [localTelemetry, syncOffset, speedScale]);

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
    if (!videoRef.current || !localTelemetry || !videoFile) {
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

    // Aligned HTML5 Video player for frame scanning
    const exportVideo = document.createElement("video");
    exportVideo.src = videoUrl!;
    exportVideo.muted = true;
    exportVideo.playsInline = true;
    exportVideo.width = canvas.width;
    exportVideo.height = canvas.height;

    // Load video fully
    await new Promise((resolve) => {
      exportVideo.onloadeddata = resolve;
    });

    // Capture the stream at 30 FPS
    const canvasStream = canvas.captureStream(30);

    // Set up Audio Mixing from original video
    let audioStreamTrack: MediaStreamTrack | null = null;
    try {
      const audioCtx = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
      const source = audioCtx.createMediaElementSource(exportVideo);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);
      source.connect(audioCtx.destination); // Let user hear sound while recording
      audioStreamTrack = dest.stream.getAudioTracks()[0];
    } catch (e) {
      console.warn("Could not capture video audio stream track:", e);
    }

    // Merge audio track into canvas stream
    const exportStream = new MediaStream(canvasStream.getVideoTracks());
    if (audioStreamTrack) {
      exportStream.addTrack(audioStreamTrack);
    }

    // Initialize MediaRecorder
    let options = { mimeType: "video/webm;codecs=vp9,opus" };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm;codecs=vp8,opus" };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm" };
    }

    const mediaRecorder = new MediaRecorder(exportStream, options);
    const chunks: Blob[] = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `overlay_render.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setIsExporting(false);
    };

    // Begin recording
    mediaRecorder.start();
    exportVideo.currentTime = 0;
    exportVideo.play();

    // High performance frame rendering loop
    const duration = exportVideo.duration;

    const renderLoop = () => {
      if (exportVideo.paused || exportVideo.ended) {
        mediaRecorder.stop();
        return;
      }

      // 1. Draw video frame to canvas
      ctx.drawImage(exportVideo, 0, 0, canvas.width, canvas.height);

      // 2. Interpolate active telemetry metrics
      const vTime = exportVideo.currentTime;
      setExportProgress(Math.round((vTime / duration) * 100));

      const tTime = (vTime - syncOffset) * speedScale;
      const rows = localTelemetry.rows;
      let matchedTelemetry = {
        speed: 0,
        rpm: 0,
        latAcc: 0,
        lonAcc: 0,
        lat: 0,
        lon: 0,
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
          };
        }
      }

      // 3. Render Telemetry overlays on top of the canvas frame
      drawCanvasHUD(ctx, canvas.width, canvas.height, matchedTelemetry);

      requestAnimationFrame(renderLoop);
    };

    exportVideo.onplay = () => {
      requestAnimationFrame(renderLoop);
    };

    exportVideo.onended = () => {
      mediaRecorder.stop();
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
    },
  ) => {
    ctx.save();

    // SPEEDOMETER WIDGET DRAW
    if (layoutConfig.speedometer?.visible) {
      const wX = (layoutConfig.speedometer.x / 100) * width;
      const wY = (layoutConfig.speedometer.y / 100) * height;
      const wW = (layoutConfig.speedometer.w / 100) * width;
      const wH = (layoutConfig.speedometer.h / 100) * height;

      // Draw background glass
      ctx.fillStyle = "rgba(24, 24, 27, 0.85)";
      ctx.strokeStyle = "rgba(39, 39, 42, 0.9)";
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, wX, wY, wW, wH, 12);
      ctx.fill();
      ctx.stroke();

      // Draw arc
      const cx = wX + wW / 2;
      const cy = wY + wH / 2 + 5;
      const r = Math.min(wW, wH) * 0.35;

      ctx.beginPath();
      ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (405 * Math.PI) / 180);
      ctx.strokeStyle = "rgba(39, 39, 42, 0.8)";
      ctx.lineWidth = 8;
      ctx.stroke();

      // Active speed arc
      const clampedPct = Math.min(1, Math.max(0, tel.speed / 260));
      const endAngle = 135 + clampedPct * 270;
      ctx.beginPath();
      ctx.arc(cx, cy, r, (135 * Math.PI) / 180, (endAngle * Math.PI) / 180);
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 8;
      ctx.stroke();

      // Digital digits
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 26px Orbitron, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(Math.round(tel.speed).toString(), cx, cy - 2);

      // Label units
      ctx.fillStyle = "#71717a";
      ctx.font = "bold 9px Inter, sans-serif";
      ctx.fillText("KM/H", cx, cy + r - 10);
    }

    // RPM GAUGE DRAW
    if (layoutConfig.rpmGauge?.visible) {
      const wX = (layoutConfig.rpmGauge.x / 100) * width;
      const wY = (layoutConfig.rpmGauge.y / 100) * height;
      const wW = (layoutConfig.rpmGauge.w / 100) * width;
      const wH = (layoutConfig.rpmGauge.h / 100) * height;

      ctx.fillStyle = "rgba(24, 24, 27, 0.85)";
      ctx.strokeStyle = "rgba(39, 39, 42, 0.9)";
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, wX, wY, wW, wH, 10);
      ctx.fill();
      ctx.stroke();

      // RPM digital print
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px Orbitron, monospace";
      ctx.textAlign = "right";
      ctx.fillText(
        Math.round(tel.rpm).toString() + " RPM",
        wX + wW - 15,
        wY + 20,
      );

      // LED Segment blocks
      const ledsCount = 20;
      const activeCount = Math.round((tel.rpm / 10000) * ledsCount);
      const ledBarX = wX + 15;
      const ledBarY = wY + 26;
      const ledBarW = wW - 30;
      const ledBarH = 10;

      const ledBlockW = (ledBarW - (ledsCount - 1) * 2) / ledsCount;

      for (let i = 0; i < ledsCount; i++) {
        const val = ((i + 1) / ledsCount) * 10000;
        const isActive = i < activeCount;
        let ledColor = "rgba(16, 185, 129, 0.15)"; // emerald dim

        if (isActive) {
          if (val >= 9500)
            ledColor = "#60a5fa"; // blue shift flash
          else if (val >= 8500)
            ledColor = "#f43f5e"; // rose redline
          else if (val >= 6000)
            ledColor = "#fbbf24"; // amber high-rpm
          else ledColor = "#10b981"; // emerald base
        }

        ctx.fillStyle = ledColor;
        ctx.fillRect(
          ledBarX + i * (ledBlockW + 2),
          ledBarY,
          ledBlockW,
          ledBarH,
        );
      }
    }

    // G-FORCE GAUGE DRAW
    if (layoutConfig.gForceRadar?.visible) {
      const wX = (layoutConfig.gForceRadar.x / 100) * width;
      const wY = (layoutConfig.gForceRadar.y / 100) * height;
      const wW = (layoutConfig.gForceRadar.w / 100) * width;
      const wH = (layoutConfig.gForceRadar.h / 100) * height;

      ctx.fillStyle = "rgba(24, 24, 27, 0.85)";
      ctx.strokeStyle = "rgba(39, 39, 42, 0.9)";
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, wX, wY, wW, wH, 12);
      ctx.fill();
      ctx.stroke();

      const cx = wX + wW / 2;
      const cy = wY + wH / 2 + 5;
      const r = Math.min(wW, wH) * 0.35;

      // Draw concentric G-rings
      ctx.strokeStyle = "rgba(63, 63, 70, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.5, 0, 2 * Math.PI);
      ctx.stroke(); // 0.5G
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.stroke(); // 1.0G

      // Draw crosshair axes
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();

      // Draw active G Force vector dot
      const maxG = 1.5;
      const gX = cx + (tel.latAcc / maxG) * r;
      const gY = cy - (tel.lonAcc / maxG) * r;

      ctx.beginPath();
      ctx.arc(gX, gY, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "#f43f5e";
      ctx.shadowColor = "#f43f5e";
      ctx.shadowBlur = 8;
      ctx.fill();
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full max-w-7xl px-4 py-6 text-zinc-100 select-none relative">
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
                  {videoUrl ? (
                    <video
                      ref={modalVideoRef}
                      src={videoUrl}
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
          className="relative bg-zinc-950 rounded-3xl border border-zinc-800/80 shadow-2xl overflow-hidden aspect-video w-full"
          onMouseMove={handleOverlayMouseMove}
          onMouseUp={handleOverlayMouseUp}
          onMouseLeave={handleOverlayMouseUp}
        >
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-full object-cover rounded-3xl"
              onLoadedMetadata={() =>
                setVideoDuration(videoRef.current?.duration || 0)
              }
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
              disabled={!videoUrl}
              className={`p-2.5 rounded-xl transition ${
                videoUrl
                  ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 cursor-pointer"
                  : "bg-zinc-900 text-zinc-700 cursor-not-allowed"
              }`}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>

            {/* Main Video Progress slider */}
            <input
              type="range"
              min={0}
              max={videoDuration || 100}
              step={0.05}
              value={currentTime}
              disabled={!videoUrl}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setCurrentTime(val);
                if (videoRef.current) videoRef.current.currentTime = val;
              }}
              className="flex-grow accent-cyan-400 h-1.5 bg-zinc-950 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed"
            />

            <div className="text-xs font-mono text-zinc-400 select-none">
              {Math.floor(currentTime / 60)}:
              {String(Math.floor(currentTime % 60)).padStart(2, "0")}.
              {String(Math.floor((currentTime % 1) * 10)).padStart(1, "0")} /{" "}
              {Math.floor(videoDuration / 60)}:
              {String(Math.floor(videoDuration % 60)).padStart(2, "0")}
            </div>
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
                onChange={handleVideoChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center justify-center space-y-1">
                <Video size={20} className="text-cyan-400" />
                <span className="text-[10px] text-zinc-400 font-semibold truncate max-w-55">
                  {videoFile ? videoFile.name : "Select POV Video"}
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
        {localTelemetry && videoFile && (
          <div className="bg-zinc-900/80 backdrop-blur-md border border-rose-500/30 p-5 rounded-3xl flex flex-col space-y-4 shadow-[0_0_20px_rgba(244,63,94,0.1)]">
            <h3 className="text-xs font-black uppercase tracking-widest text-rose-500 flex items-center space-x-2">
              <Video size={14} className="text-rose-500 animate-pulse" />
              <span>GPU HUD Exporter</span>
            </h3>
            <p className="text-[9px] text-zinc-400 leading-relaxed uppercase font-semibold">
              Merge POV video and telemetry dials directly inside your browser!
              GPU hardware-accelerated.
            </p>

            <button
              onClick={handleExportVideo}
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
