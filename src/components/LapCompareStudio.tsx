"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Clock,
  FileText,
  Flag,
  Gauge,
  GitCompare,
  Map as MapIcon,
  Pause,
  Play,
  Route,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { parseTelemetryCSV, type ParsedTelemetry } from "@/utils/csv-helper";
import {
  buildAlignedLapPair,
  buildNeutralTrackCenterline,
  computeComparisonSnapshot,
  createSessionItem,
  formatCompareLapTime,
  parseCustomTrackFile,
  type ParsedTrackFile,
  type TelemetrySessionItem,
} from "@/utils/lap-comparison";
import Track3DViewer from "./Track3DViewer";
import LapCompareCharts from "./LapCompareCharts";

interface LapCompareStudioProps {
  initialCsvFile?: File | null;
  initialTelemetry?: ParsedTelemetry | null;
}

interface LapSelection {
  sessionId: string;
  lapNumber: number;
}

const MAX_CSV_BYTES = 50 * 1024 * 1024;
const MAX_SESSIONS = 12;
const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2] as const;

function pickDefaultSecondLap(session: TelemetrySessionItem): number {
  const timed = session.laps.filter(
    (l) => l.lapNumber !== session.bestLapNumber && !l.isOutOrInLap,
  );
  if (timed.length > 0) {
    timed.sort((a, b) => a.lapTime - b.lapTime);
    return timed[0].lapNumber;
  }
  const anyOther = session.laps.find(
    (l) => l.lapNumber !== session.bestLapNumber,
  );
  return anyOther ? anyOther.lapNumber : session.bestLapNumber;
}

export default function LapCompareStudio({
  initialCsvFile = null,
  initialTelemetry = null,
}: LapCompareStudioProps) {
  const [uploadedSessions, setUploadedSessions] = useState<
    TelemetrySessionItem[]
  >([]);
  const [hiddenInitialId, setHiddenInitialId] = useState<string | null>(null);
  const [selectionA, setSelectionA] = useState<LapSelection | null>(null);
  const [selectionB, setSelectionB] = useState<LapSelection | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [customTrack, setCustomTrack] = useState<ParsedTrackFile | null>(null);
  const [trackError, setTrackError] = useState("");

  const [syncMode, setSyncMode] = useState<"distance" | "time">("distance");
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] =
    useState<(typeof PLAYBACK_SPEEDS)[number]>(1);

  const initialSession = useMemo<TelemetrySessionItem | null>(() => {
    if (!initialTelemetry) return null;
    const name = initialCsvFile?.name || "Active Studio Telemetry.csv";
    const sig = `${initialCsvFile?.size ?? 0}_${initialCsvFile?.lastModified ?? 0}`;
    return createSessionItem(name, initialTelemetry, `initial_${name}_${sig}`);
  }, [initialCsvFile, initialTelemetry]);

  const sessions = useMemo<TelemetrySessionItem[]>(() => {
    const list: TelemetrySessionItem[] = [];
    if (initialSession && initialSession.id !== hiddenInitialId) {
      list.push(initialSession);
    }
    for (const s of uploadedSessions) {
      list.push(s);
    }
    return list;
  }, [initialSession, hiddenInitialId, uploadedSessions]);

  const effectiveSelectionA = useMemo<LapSelection | null>(() => {
    if (sessions.length === 0) return null;
    if (selectionA) {
      const found = sessions.find((s) => s.id === selectionA.sessionId);
      if (found && found.laps.some((l) => l.lapNumber === selectionA.lapNumber)) {
        return selectionA;
      }
    }
    return {
      sessionId: sessions[0].id,
      lapNumber: sessions[0].bestLapNumber,
    };
  }, [sessions, selectionA]);

  const effectiveSelectionB = useMemo<LapSelection | null>(() => {
    if (sessions.length === 0) return null;
    if (selectionB) {
      const found = sessions.find((s) => s.id === selectionB.sessionId);
      if (found && found.laps.some((l) => l.lapNumber === selectionB.lapNumber)) {
        return selectionB;
      }
    }
    if (sessions.length >= 2) {
      return {
        sessionId: sessions[1].id,
        lapNumber: sessions[1].bestLapNumber,
      };
    }
    return {
      sessionId: sessions[0].id,
      lapNumber: pickDefaultSecondLap(sessions[0]),
    };
  }, [sessions, selectionB]);

  const sessionA = useMemo(
    () =>
      sessions.find((s) => s.id === effectiveSelectionA?.sessionId) || null,
    [sessions, effectiveSelectionA],
  );
  const sessionB = useMemo(
    () =>
      sessions.find((s) => s.id === effectiveSelectionB?.sessionId) || null,
    [sessions, effectiveSelectionB],
  );

  const aligned = useMemo(() => {
    if (
      !sessionA ||
      !sessionB ||
      !effectiveSelectionA ||
      !effectiveSelectionB
    ) {
      return { lapA: null, lapB: null, origin: null };
    }
    return buildAlignedLapPair(
      sessionA,
      effectiveSelectionA.lapNumber,
      sessionB,
      effectiveSelectionB.lapNumber,
    );
  }, [sessionA, sessionB, effectiveSelectionA, effectiveSelectionB]);

  const { lapA, lapB, origin } = aligned;

  const centerline = useMemo(() => {
    if (!lapA || !lapB) return [];
    return buildNeutralTrackCenterline(
      sessions,
      lapA,
      lapB,
      origin,
      customTrack?.points ?? null,
    );
  }, [sessions, lapA, lapB, origin, customTrack]);

  const snapshot = useMemo(() => {
    if (!lapA || !lapB) return null;
    return computeComparisonSnapshot(lapA, lapB, syncMode, progress);
  }, [lapA, lapB, syncMode, progress]);

  useEffect(() => {
    if (!isPlaying || !lapA || !lapB) return;

    const cycleSec = Math.max(
      1,
      syncMode === "time"
        ? Math.max(lapA.lapTime, lapB.lapTime)
        : lapA.lapTime,
    );
    let rafId: number;
    let lastTs = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;

      setProgress((prev) => {
        const next = prev + (dt * playbackSpeed) / cycleSec;
        return next >= 1 ? next - 1 : next;
      });

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, playbackSpeed, syncMode, lapA, lapB]);

  const handleUploadCSVs = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    e.target.value = "";

    setUploadError("");
    setIsParsing(true);

    try {
      const added: TelemetrySessionItem[] = [];
      for (const file of files) {
        if (sessions.length + added.length >= MAX_SESSIONS) {
          setUploadError(`Maximum of ${MAX_SESSIONS} CSV sessions reached.`);
          break;
        }
        if (!file.name.toLowerCase().endsWith(".csv")) {
          setUploadError(`Skipped "${file.name}": only .csv files are allowed.`);
          continue;
        }
        if (file.size > MAX_CSV_BYTES) {
          setUploadError(
            `Skipped "${file.name}": exceeds 50 MB client safety limit.`,
          );
          continue;
        }

        const text = await file.text();
        const parsed = parseTelemetryCSV(text);
        const item = createSessionItem(file.name, parsed);
        if (item.laps.length === 0) {
          setUploadError(`No valid laps found in "${file.name}".`);
          continue;
        }
        added.push(item);
      }

      if (added.length > 0) {
        setUploadedSessions((prev) => [...prev, ...added]);
        if (sessions.length === 0 && added.length >= 2) {
          setSelectionA({
            sessionId: added[0].id,
            lapNumber: added[0].bestLapNumber,
          });
          setSelectionB({
            sessionId: added[1].id,
            lapNumber: added[1].bestLapNumber,
          });
        } else if (sessions.length === 1 && added.length >= 1) {
          setSelectionB({
            sessionId: added[0].id,
            lapNumber: added[0].bestLapNumber,
          });
        }
      }
    } catch (err) {
      const error = err as Error;
      setUploadError(`Error reading telemetry CSV: ${error.message}`);
    } finally {
      setIsParsing(false);
    }
  };

  const handleRemoveSession = (id: string) => {
    if (initialSession && id === initialSession.id) {
      setHiddenInitialId(id);
    } else {
      setUploadedSessions((prev) => prev.filter((s) => s.id !== id));
    }
    setIsPlaying(false);
  };

  const handleTrackFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setTrackError("");
    try {
      if (file.size > 20 * 1024 * 1024) {
        setTrackError("Track file exceeds the 20 MB client limit.");
        return;
      }
      const buffer = await file.arrayBuffer();
      const parsed = await parseCustomTrackFile(
        file.name,
        buffer,
        origin,
      );
      setCustomTrack(parsed);
    } catch (err) {
      const error = err as Error;
      setTrackError(error.message);
    }
  };

  const labelA = lapA
    ? `${lapA.racerName} • ${lapA.lapNumber === 0 ? "Out" : `L${lapA.lapNumber}`}`
    : "Lap A";
  const labelB = lapB
    ? `${lapB.racerName} • ${lapB.lapNumber === 0 ? "Out" : `L${lapB.lapNumber}`}`
    : "Lap B";

  const overallTimeDiff =
    lapA && lapB ? lapB.lapTime - lapA.lapTime : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">
      <div className="lg:col-span-8 flex flex-col space-y-5">
        {lapA && lapB && snapshot ? (
          <>
            <Track3DViewer
              lapA={lapA}
              lapB={lapB}
              centerline={centerline}
              snapshot={snapshot}
              labelA={labelA}
              labelB={labelB}
            />

            <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-4 rounded-2xl flex flex-col space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsPlaying((p) => !p)}
                  className="p-2.5 rounded-xl bg-cyan-400 hover:bg-cyan-500 text-zinc-950 transition cursor-pointer shadow-[0_0_12px_rgba(34,211,238,0.25)]"
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setProgress(0);
                  }}
                  className="p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition cursor-pointer"
                  title="Restart lap comparison"
                >
                  <RotateCcw size={16} />
                </button>

                <div className="flex items-center space-x-1 bg-zinc-950 border border-zinc-800 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setSyncMode("distance")}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center space-x-1 transition cursor-pointer ${
                      syncMode === "distance"
                        ? "bg-cyan-400/20 text-cyan-300 border border-cyan-400/50"
                        : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                    }`}
                  >
                    <Route size={11} />
                    <span>Distance %</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSyncMode("time")}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center space-x-1 transition cursor-pointer ${
                      syncMode === "time"
                        ? "bg-rose-500/20 text-rose-300 border border-rose-500/50"
                        : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                    }`}
                  >
                    <Clock size={11} />
                    <span>Real-Time</span>
                  </button>
                </div>

                <div className="relative grow min-w-44 h-6 flex items-center">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.001}
                    value={progress}
                    onChange={(e) => {
                      setIsPlaying(false);
                      setProgress(parseFloat(e.target.value));
                    }}
                    className="w-full accent-cyan-400 h-1.5 bg-zinc-950 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="flex items-center space-x-1">
                  {PLAYBACK_SPEEDS.map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => setPlaybackSpeed(spd)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border transition cursor-pointer ${
                        playbackSpeed === spd
                          ? "bg-zinc-800 border-cyan-400/60 text-cyan-300"
                          : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-zinc-400 border-t border-zinc-800/80 pt-2.5">
                <div className="flex items-center space-x-4">
                  <span>
                    Lap Progress:{" "}
                    <strong className="text-zinc-200">
                      {Math.round(snapshot.pointA.normDist * 100)}%
                    </strong>{" "}
                    ({Math.round(snapshot.pointA.distanceMeters)}m /{" "}
                    {Math.round(lapA.totalDistanceMeters)}m)
                  </span>
                  <span>
                    A Clock:{" "}
                    <strong className="text-cyan-400">
                      {snapshot.pointA.elapsedTime.toFixed(2)}s
                    </strong>
                  </span>
                  <span>
                    B Clock:{" "}
                    <strong className="text-rose-400">
                      {snapshot.pointB.elapsedTime.toFixed(2)}s
                    </strong>
                  </span>
                </div>
                <span className="text-zinc-500 font-sans">
                  {syncMode === "distance"
                    ? "Distance sync aligns both karts at the exact same corner progression."
                    : "Real-time sync launches both karts together at t=0.000s."}
                </span>
              </div>
            </div>

            <LapCompareCharts
              lapA={lapA}
              lapB={lapB}
              snapshot={snapshot}
              progress={progress}
              syncMode={syncMode}
              onScrub={(next) => {
                setIsPlaying(false);
                setProgress(next);
              }}
            />
          </>
        ) : (
          <div className="aspect-16/10 min-h-96 bg-zinc-950 rounded-3xl border border-zinc-800/80 flex flex-col items-center justify-center p-8 text-center space-y-5 shadow-2xl">
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-full text-cyan-400 shadow-[0_0_24px_rgba(34,211,238,0.18)]">
              <GitCompare size={36} />
            </div>
            <div className="space-y-1.5 max-w-md">
              <h3 className="text-lg font-black uppercase tracking-wider text-zinc-100">
                3D Multi-CSV Lap Comparator
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Upload one or multiple AiM RaceStudio CSV files to overlay two
                laps in 3D. Inspect corner entry lines, apex speeds, lateral
                offset, and live time deltas from any angle or chase camera.
              </p>
            </div>
            <label className="flex items-center space-x-2 bg-cyan-400 hover:bg-cyan-500 text-zinc-950 font-black px-5 py-2.5 rounded-xl cursor-pointer text-xs uppercase tracking-wider transition shadow-[0_0_15px_rgba(34,211,238,0.25)]">
              <Upload size={15} />
              <span>Upload RaceStudio CSV(s)</span>
              <input
                type="file"
                accept=".csv"
                multiple
                onChange={handleUploadCSVs}
                className="hidden"
              />
            </label>
          </div>
        )}
      </div>

      <div className="lg:col-span-4 flex flex-col space-y-5">
        <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-5 rounded-3xl flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex items-center space-x-2">
              <FileText size={14} className="text-cyan-400" />
              <span>CSV Sessions ({sessions.length})</span>
            </h3>
            {isParsing && (
              <span className="text-[10px] font-bold text-cyan-400 animate-pulse uppercase">
                Parsing...
              </span>
            )}
          </div>

          <div className="relative border border-dashed border-zinc-800 rounded-xl bg-zinc-950/60 p-4 hover:border-cyan-500/40 transition cursor-pointer text-center">
            <input
              type="file"
              accept=".csv"
              multiple
              onChange={handleUploadCSVs}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="flex flex-col items-center justify-center space-y-1">
              <Upload size={18} className="text-cyan-400" />
              <span className="text-[11px] text-zinc-300 font-bold">
                Add RaceStudio CSV File(s)
              </span>
              <span className="text-[9px] text-zinc-500">
                Select 1 or multiple .csv telemetry exports (max 50 MB)
              </span>
            </div>
          </div>

          {uploadError && (
            <div className="text-[10px] text-rose-400 font-semibold bg-rose-950/30 border border-rose-800/70 rounded-xl p-2.5 flex items-start space-x-2">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              <span>{uploadError}</span>
            </div>
          )}

          {sessions.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="bg-zinc-950 border border-zinc-800/90 rounded-xl px-3 py-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-zinc-200 truncate">
                      {s.racerName} • {s.sessionName}
                    </div>
                    <div className="text-[9px] font-mono text-zinc-500 truncate">
                      {s.fileName} • {s.laps.length} laps • Best{" "}
                      {formatCompareLapTime(
                        s.laps.find((l) => l.lapNumber === s.bestLapNumber)
                          ?.lapTime || 0,
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveSession(s.id)}
                    className="p-1.5 text-zinc-500 hover:text-rose-400 rounded-lg transition cursor-pointer shrink-0"
                    title="Remove CSV session"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-zinc-800/80 pt-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 flex items-center space-x-1.5">
                <MapIcon size={12} className="text-cyan-400" />
                <span>Circuit Track Layout</span>
              </span>
              {customTrack && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomTrack(null);
                    setTrackError("");
                  }}
                  className="text-[9px] font-bold text-zinc-400 hover:text-rose-400 flex items-center space-x-1 cursor-pointer"
                >
                  <X size={11} />
                  <span>Reset Auto</span>
                </button>
              )}
            </div>

            {customTrack ? (
              <div className="bg-cyan-950/25 border border-cyan-500/40 rounded-xl px-3 py-2 text-[10px]">
                <div className="font-bold text-cyan-300 truncate">
                  {customTrack.name} ({customTrack.sourceFormat.toUpperCase()})
                </div>
                <div className="text-zinc-400 font-mono text-[9px]">
                  {customTrack.points.length} GPS centerline points loaded
                </div>
              </div>
            ) : (
              <label className="block relative border border-dashed border-zinc-800 rounded-xl bg-zinc-950/50 p-3 hover:border-cyan-500/40 transition cursor-pointer text-center">
                <input
                  type="file"
                  accept=".ztracks,.tkk,.kml,.gpx,.geojson,.json"
                  onChange={handleTrackFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <span className="text-[10px] text-zinc-300 font-bold block">
                  Optional: Load Track File (.ztracks / .tkk / .kml / .gpx)
                </span>
                <span className="text-[9px] text-zinc-500 block mt-0.5">
                  Uses the exact CSV GPS path by default. Upload a Race Studio
                  .ztracks / .tkk or .kml track export if available.
                </span>
              </label>
            )}

            {trackError && (
              <div className="text-[10px] text-amber-300 font-semibold bg-amber-950/30 border border-amber-700/60 rounded-xl p-2.5 flex items-start space-x-2">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                <span>{trackError}</span>
              </div>
            )}
          </div>
        </div>

        {sessions.length > 0 && effectiveSelectionA && effectiveSelectionB && (
          <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-5 rounded-3xl flex flex-col space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex items-center space-x-2">
              <Flag size={14} className="text-cyan-400" />
              <span>Lap Comparison Setup</span>
            </h3>

            <div className="p-3.5 rounded-2xl bg-cyan-950/20 border border-cyan-500/35 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-cyan-400 flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  <span>Reference Lap A</span>
                </span>
                {lapA && (
                  <span className="font-mono text-xs font-black text-cyan-300">
                    {formatCompareLapTime(lapA.lapTime)}
                  </span>
                )}
              </div>

              <select
                value={effectiveSelectionA.sessionId}
                onChange={(e) => {
                  const nextSession = sessions.find(
                    (s) => s.id === e.target.value,
                  );
                  if (!nextSession) return;
                  setSelectionA({
                    sessionId: nextSession.id,
                    lapNumber: nextSession.bestLapNumber,
                  });
                }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-[11px] text-zinc-200 focus:outline-none focus:border-cyan-400 cursor-pointer"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.racerName} — {s.sessionName} ({s.fileName})
                  </option>
                ))}
              </select>

              <select
                value={effectiveSelectionA.lapNumber}
                onChange={(e) => {
                  setSelectionA({
                    sessionId: effectiveSelectionA.sessionId,
                    lapNumber: Number(e.target.value),
                  });
                }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-cyan-400 cursor-pointer"
              >
                {sessionA?.laps.map((l) => (
                  <option key={l.lapNumber} value={l.lapNumber}>
                    {l.lapNumber === 0 ? "Out Lap" : `Lap ${l.lapNumber}`} —{" "}
                    {formatCompareLapTime(l.lapTime)}
                    {l.isBest ? " ★ Best" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="p-3.5 rounded-2xl bg-rose-950/20 border border-rose-500/35 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-rose-400 flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <span>Comparison Lap B</span>
                </span>
                {lapB && (
                  <span className="font-mono text-xs font-black text-rose-300">
                    {formatCompareLapTime(lapB.lapTime)}
                  </span>
                )}
              </div>

              <select
                value={effectiveSelectionB.sessionId}
                onChange={(e) => {
                  const nextSession = sessions.find(
                    (s) => s.id === e.target.value,
                  );
                  if (!nextSession) return;
                  setSelectionB({
                    sessionId: nextSession.id,
                    lapNumber: nextSession.bestLapNumber,
                  });
                }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-[11px] text-zinc-200 focus:outline-none focus:border-rose-400 cursor-pointer"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.racerName} — {s.sessionName} ({s.fileName})
                  </option>
                ))}
              </select>

              <select
                value={effectiveSelectionB.lapNumber}
                onChange={(e) => {
                  setSelectionB({
                    sessionId: effectiveSelectionB.sessionId,
                    lapNumber: Number(e.target.value),
                  });
                }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-rose-400 cursor-pointer"
              >
                {sessionB?.laps.map((l) => (
                  <option key={l.lapNumber} value={l.lapNumber}>
                    {l.lapNumber === 0 ? "Out Lap" : `Lap ${l.lapNumber}`} —{" "}
                    {formatCompareLapTime(l.lapTime)}
                    {l.isBest ? " ★ Best" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {lapA && lapB && snapshot && (
          <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-5 rounded-3xl flex flex-col space-y-3">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex items-center space-x-2">
              <Gauge size={14} className="text-rose-500" />
              <span>Head-to-Head Metrics</span>
            </h3>

            <div className="grid grid-cols-3 gap-2 text-[10px] font-mono bg-zinc-950 border border-zinc-800/80 rounded-2xl p-3">
              <div className="text-zinc-500 font-sans font-bold uppercase">
                Metric
              </div>
              <div className="text-cyan-400 text-right font-bold">Lap A</div>
              <div className="text-rose-400 text-right font-bold">Lap B</div>

              <div className="text-zinc-400 font-sans">Lap Time</div>
              <div className="text-zinc-200 text-right">
                {formatCompareLapTime(lapA.lapTime)}
              </div>
              <div className="text-zinc-200 text-right">
                {formatCompareLapTime(lapB.lapTime)}
              </div>

              <div className="text-zinc-400 font-sans">Lap Diff</div>
              <div className="text-zinc-500 text-right">ref</div>
              <div
                className={`text-right font-bold ${
                  overallTimeDiff <= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {overallTimeDiff >= 0 ? "+" : ""}
                {overallTimeDiff.toFixed(3)}s
              </div>

              <div className="text-zinc-400 font-sans">Live Speed</div>
              <div className="text-cyan-300 text-right font-bold">
                {snapshot.pointA.speed.toFixed(1)}
              </div>
              <div className="text-rose-300 text-right font-bold">
                {snapshot.pointB.speed.toFixed(1)}
              </div>

              <div className="text-zinc-400 font-sans">Top Speed</div>
              <div className="text-zinc-200 text-right">
                {lapA.maxSpeed.toFixed(1)}
              </div>
              <div className="text-zinc-200 text-right">
                {lapB.maxSpeed.toFixed(1)}
              </div>

              <div className="text-zinc-400 font-sans">Min Apex</div>
              <div className="text-zinc-200 text-right">
                {lapA.minSpeed.toFixed(1)}
              </div>
              <div className="text-zinc-200 text-right">
                {lapB.minSpeed.toFixed(1)}
              </div>

              <div className="text-zinc-400 font-sans">Live RPM</div>
              <div className="text-zinc-200 text-right">
                {Math.round(snapshot.pointA.rpm)}
              </div>
              <div className="text-zinc-200 text-right">
                {Math.round(snapshot.pointB.rpm)}
              </div>

              <div className="text-zinc-400 font-sans">Lat G</div>
              <div className="text-zinc-200 text-right">
                {snapshot.pointA.latAcc.toFixed(2)}g
              </div>
              <div className="text-zinc-200 text-right">
                {snapshot.pointB.latAcc.toFixed(2)}g
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
