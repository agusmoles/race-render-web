"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  Check,
  GitCompareArrows,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import {
  formatLapTime,
  MAX_COMPARISON_SESSIONS,
  PRIMARY_SESSION_ID,
  sanitizeDisplayLabel,
  type ComparisonSelection,
  type ComparisonSession,
  type LiveComparisonMetric,
  type ReferenceLapTarget,
  type SessionLapAnalysis,
} from "@/utils/telemetry-compare";

interface ComparisonPanelProps {
  primaryRacerName: string;
  primarySessionName: string;
  primaryAnalysis: SessionLapAnalysis;
  currentLap: number;
  currentLapElapsed: number;
  currentSpeed: number;
  telemetryLaps: number[];
  comparisonSessions: ComparisonSession[];
  comparisonSelection: ComparisonSelection;
  activeReferenceLap: ReferenceLapTarget | null;
  activeMetric: LiveComparisonMetric;
  sessionLiveMetrics: Record<string, LiveComparisonMetric>;
  showGhostOnMap: boolean;
  isParsingComparison: boolean;
  comparisonError: string;
  onToggleGhostOnMap: () => void;
  onSelectComparison: (sourceId: string, lapNum: number | null) => void;
  onAddComparisonCSVs: (files: FileList) => void;
  onRemoveComparisonSession: (sessionId: string) => void;
  onRenameComparisonSession: (sessionId: string, nextName: string) => void;
  onDismissError: () => void;
}

function formatSignedDelta(delta: number, decimals = 2): string {
  const fixed = delta.toFixed(decimals);
  return delta > 0 ? `+${fixed}` : fixed;
}

export default function ComparisonPanel({
  primaryRacerName,
  primarySessionName,
  primaryAnalysis,
  currentLap,
  currentLapElapsed,
  currentSpeed,
  telemetryLaps,
  comparisonSessions,
  comparisonSelection,
  activeReferenceLap,
  activeMetric,
  sessionLiveMetrics,
  showGhostOnMap,
  isParsingComparison,
  comparisonError,
  onToggleGhostOnMap,
  onSelectComparison,
  onAddComparisonCSVs,
  onRemoveComparisonSession,
  onRenameComparisonSession,
  onDismissError,
}: ComparisonPanelProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const isPrimarySelected = comparisonSelection.sourceId === PRIMARY_SESSION_ID;
  const isDefaultBest = isPrimarySelected && comparisonSelection.lapNum === null;
  const canAddMore = comparisonSessions.length < MAX_COMPARISON_SESSIONS;

  const isOutOrInLap =
    currentLap <= 0 ||
    (telemetryLaps.length >= 3 &&
      (currentLap === telemetryLaps[0] ||
        currentLap === telemetryLaps[telemetryLaps.length - 1]));

  const inactiveHint = !activeReferenceLap
    ? "No Ref"
    : isOutOrInLap
      ? "Out / In Lap"
      : activeReferenceLap.isPrimarySession && currentLap === activeReferenceLap.lapNum
        ? "Same Lap"
        : "Standby";

  const speedDiff =
    activeMetric.active && activeMetric.refSpeed !== null
      ? Math.round(currentSpeed) - Math.round(activeMetric.refSpeed)
      : null;

  const commitRename = (sessionId: string) => {
    const clean = sanitizeDisplayLabel(editingName, 40);
    if (clean) {
      onRenameComparisonSession(sessionId, clean);
    }
    setEditingSessionId(null);
    setEditingName("");
  };

  return (
    <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-5 rounded-3xl flex flex-col space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <GitCompareArrows size={15} className="text-cyan-400" />
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-200">
            Lap &amp; Racer Comparison
          </h3>
          {comparisonSessions.length > 0 && (
            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400">
              {comparisonSessions.length}/{MAX_COMPARISON_SESSIONS} CSV
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleGhostOnMap}
            title={
              activeReferenceLap && !activeReferenceLap.trackCompatible
                ? "Reference GPS does not match primary track"
                : "Toggle reference car ghost dot on Track Map"
            }
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-extrabold uppercase tracking-wider border transition cursor-pointer ${
              showGhostOnMap && activeReferenceLap?.trackCompatible
                ? "bg-cyan-400/15 border-cyan-400/50 text-cyan-300"
                : showGhostOnMap
                  ? "bg-zinc-950 border-zinc-800 text-zinc-400"
                  : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <MapPin size={11} />
            <span>Map Ghost</span>
            <span
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor:
                  showGhostOnMap && activeReferenceLap?.trackCompatible
                    ? activeReferenceLap.accentColor
                    : "#52525b",
              }}
            />
          </button>

          {!isDefaultBest && (
            <button
              type="button"
              onClick={() => onSelectComparison(PRIMARY_SESSION_ID, null)}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-[10px] font-extrabold uppercase tracking-wider border border-zinc-800 bg-zinc-950 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 transition cursor-pointer"
            >
              <RotateCcw size={11} />
              <span>Reset to Best</span>
            </button>
          )}

          <label
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition ${
              canAddMore
                ? "bg-cyan-400 hover:bg-cyan-500 text-zinc-950 cursor-pointer shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
            }`}
          >
            <Plus size={12} />
            <span>Add Racer CSV</span>
            <input
              type="file"
              accept=".csv"
              multiple
              disabled={!canAddMore}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  onAddComparisonCSVs(e.target.files);
                }
                e.target.value = "";
              }}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {isParsingComparison && (
        <div className="flex items-center justify-center space-x-2 text-[10px] text-cyan-400 font-bold uppercase tracking-wider bg-cyan-950/20 border border-cyan-900/40 rounded-xl py-2 animate-pulse">
          <RefreshCw size={12} className="animate-spin" />
          <span>Parsing comparison telemetry...</span>
        </div>
      )}

      {comparisonError && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-rose-400 font-bold bg-rose-950/25 border border-rose-900/60 rounded-xl px-3 py-2">
          <div className="flex items-center space-x-2 min-w-0">
            <AlertTriangle size={12} className="shrink-0 text-rose-500" />
            <span className="truncate">{comparisonError}</span>
          </div>
          <button
            type="button"
            onClick={onDismissError}
            aria-label="Dismiss comparison error"
            className="text-rose-400 hover:text-rose-200 cursor-pointer shrink-0"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-2xl p-3 flex flex-col justify-between min-w-0">
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
            Active Reference
          </span>
          {activeReferenceLap ? (
            <div className="mt-1 flex flex-col min-w-0">
              <div className="flex items-center space-x-1.5 min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: activeReferenceLap.accentColor }}
                />
                <span className="text-xs font-bold text-zinc-100 truncate">
                  {activeReferenceLap.isPrimarySession
                    ? "Your Session"
                    : activeReferenceLap.racerName}
                </span>
              </div>
              <span className="text-[11px] font-mono font-bold text-zinc-400 mt-0.5 truncate">
                {activeReferenceLap.isBestOfSource ? "Best " : ""}L
                {activeReferenceLap.lapNum} ·{" "}
                {formatLapTime(activeReferenceLap.lapTime)}
              </span>
            </div>
          ) : (
            <span className="text-xs font-mono text-zinc-500 mt-1">
              No valid lap
            </span>
          )}
        </div>

        <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-2xl p-3 flex flex-col justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
            Live Delta
          </span>
          {activeMetric.active ? (
            <div className="mt-1 flex items-baseline space-x-1.5">
              <span
                className={`text-base font-mono font-black leading-none ${
                  activeMetric.delta < 0
                    ? "text-cyan-400"
                    : activeMetric.delta > 0
                      ? "text-rose-500"
                      : "text-zinc-300"
                }`}
              >
                {formatSignedDelta(activeMetric.delta)}s
              </span>
              <span className="text-[9px] font-bold uppercase text-zinc-500">
                {activeMetric.delta < 0
                  ? "ahead"
                  : activeMetric.delta > 0
                    ? "behind"
                    : "even"}
              </span>
            </div>
          ) : (
            <span className="text-xs font-mono font-semibold text-zinc-500 mt-1">
              {inactiveHint}
            </span>
          )}
        </div>

        <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-2xl p-3 flex flex-col justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
            Speed vs Ref
          </span>
          {activeMetric.active && activeMetric.refSpeed !== null ? (
            <div className="mt-1 flex items-baseline space-x-1.5">
              <span className="text-xs font-mono font-bold text-zinc-100">
                {Math.round(currentSpeed)} vs {Math.round(activeMetric.refSpeed)}
              </span>
              {speedDiff !== null && (
                <span
                  className={`text-[10px] font-mono font-black ${
                    speedDiff > 0
                      ? "text-cyan-400"
                      : speedDiff < 0
                        ? "text-rose-500"
                        : "text-zinc-500"
                  }`}
                >
                  {speedDiff > 0 ? `+${speedDiff}` : speedDiff}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs font-mono text-zinc-500 mt-1">--</span>
          )}
        </div>

        <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-2xl p-3 flex flex-col justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
            Current POV Lap
          </span>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-xs font-mono font-black text-cyan-400 uppercase">
              {currentLap === 0 ? "Out" : `Lap ${currentLap}`}
            </span>
            <span className="text-xs font-mono font-bold text-zinc-200">
              {formatLapTime(currentLapElapsed)}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-2xl p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)] shrink-0" />
            <span className="text-xs font-black uppercase tracking-wider text-zinc-100">
              Your Session
            </span>
            {primaryRacerName && (
              <span className="text-[10px] font-semibold text-zinc-400 truncate">
                · {primaryRacerName}
              </span>
            )}
            {primarySessionName && (
              <span className="hidden sm:inline text-[10px] text-zinc-500 truncate">
                ({primarySessionName})
              </span>
            )}
            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-cyan-400/10 border border-cyan-400/30 text-cyan-300">
              POV
            </span>
          </div>

          {isPrimarySelected && (
            <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">
              HUD Active
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {primaryAnalysis.bestLap.lap > 0 && (
            <button
              type="button"
              onClick={() => onSelectComparison(PRIMARY_SESSION_ID, null)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold border transition cursor-pointer ${
                isPrimarySelected && comparisonSelection.lapNum === null
                  ? "bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.2)]"
                  : "bg-zinc-900 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              }`}
            >
              ★ Best (L{primaryAnalysis.bestLap.lap} ·{" "}
              {formatLapTime(primaryAnalysis.bestLap.time)})
            </button>
          )}

          {primaryAnalysis.selectableLaps.map((lapNum) => {
            const dur = primaryAnalysis.laps[lapNum] || 0;
            const isSelected =
              isPrimarySelected && comparisonSelection.lapNum === lapNum;
            const isBestLap = lapNum === primaryAnalysis.bestLap.lap;
            const isCurrent = lapNum === currentLap;
            const deltaVsBest =
              primaryAnalysis.bestLap.time > 0 && dur > 0
                ? dur - primaryAnalysis.bestLap.time
                : null;

            return (
              <button
                key={lapNum}
                type="button"
                onClick={() => onSelectComparison(PRIMARY_SESSION_ID, lapNum)}
                title={
                  deltaVsBest !== null && !isBestLap
                    ? `Compare against Lap ${lapNum} (${formatSignedDelta(deltaVsBest)}s vs best)`
                    : `Compare against Lap ${lapNum}`
                }
                className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border transition flex items-center space-x-1.5 cursor-pointer ${
                  isSelected
                    ? "bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.2)]"
                    : isBestLap
                      ? "bg-zinc-900 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                      : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700"
                }`}
              >
                {isCurrent && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-cyan-400"
                    title="Currently playing"
                  />
                )}
                <span>L{lapNum}</span>
                <span className="text-zinc-500">{formatLapTime(dur)}</span>
              </button>
            );
          })}

          {primaryAnalysis.selectableLaps.length === 0 && (
            <span className="text-[10px] text-zinc-500">
              No timed laps detected in primary CSV.
            </span>
          )}
        </div>
      </div>

      {comparisonSessions.length === 0 ? (
        <label className="flex flex-col items-center justify-center text-center border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 rounded-2xl p-4 cursor-pointer transition">
          <span className="text-[11px] font-bold text-zinc-300">
            Compare against other racers&apos; CSV sessions
          </span>
          <span className="text-[10px] text-zinc-500 mt-0.5">
            Upload one or more AiM / telemetry CSV files to compare lap deltas,
            speed, and track map ghost positions.
          </span>
          <input
            type="file"
            accept=".csv"
            multiple
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onAddComparisonCSVs(e.target.files);
              }
              e.target.value = "";
            }}
            className="hidden"
          />
        </label>
      ) : (
        <div className="space-y-2.5">
          {comparisonSessions.map((session) => {
            const isActiveSession = comparisonSelection.sourceId === session.id;
            const liveMetric = sessionLiveMetrics[session.id];
            const isEditing = editingSessionId === session.id;
            const effectiveLap =
              isActiveSession && comparisonSelection.lapNum !== null
                ? comparisonSelection.lapNum
                : session.selectedLapNum;

            return (
              <div
                key={session.id}
                className="bg-zinc-950/70 rounded-2xl p-3.5 space-y-2.5 border transition"
                style={{
                  borderColor: isActiveSession
                    ? `${session.color}88`
                    : "rgba(39, 39, 42, 0.85)",
                  borderLeftWidth: "3px",
                  borderLeftColor: session.color,
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: session.color }}
                    />

                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          commitRename(session.id);
                        }}
                        className="flex items-center space-x-1"
                      >
                        <input
                          type="text"
                          value={editingName}
                          maxLength={40}
                          autoFocus
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => commitRename(session.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              setEditingSessionId(null);
                              setEditingName("");
                            }
                          }}
                          className="bg-zinc-900 border border-cyan-400/60 rounded-lg px-2 py-0.5 text-xs font-bold text-zinc-100 focus:outline-none w-36"
                        />
                        <button
                          type="submit"
                          aria-label="Save racer name"
                          className="p-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                        >
                          <Check size={12} />
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSessionId(session.id);
                          setEditingName(session.racerName);
                        }}
                        title="Rename racer"
                        className="flex items-center space-x-1 text-xs font-black text-zinc-100 hover:text-cyan-300 transition cursor-pointer"
                      >
                        <span className="truncate max-w-44">
                          {session.racerName}
                        </span>
                        <Pencil size={10} className="text-zinc-500" />
                      </button>
                    )}

                    {session.vehicle && (
                      <span className="text-[10px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded truncate max-w-32">
                        {session.vehicle}
                      </span>
                    )}
                    {session.sessionName && (
                      <span className="text-[10px] text-zinc-500 truncate max-w-32">
                        {session.sessionName}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-zinc-500">
                      {session.analysis.selectableLaps.length} laps
                    </span>

                    {!session.trackCompatible && (
                      <span
                        title="GPS coordinates do not match primary track. Distance-normalized delta is active; map ghost is hidden."
                        className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/40 text-amber-400"
                      >
                        Different GPS track
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    {liveMetric?.active ? (
                      <span
                        className={`text-[10px] font-mono font-black px-2 py-0.5 rounded-md border ${
                          liveMetric.delta < 0
                            ? "bg-cyan-400/10 border-cyan-400/30 text-cyan-300"
                            : liveMetric.delta > 0
                              ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                              : "bg-zinc-900 border-zinc-800 text-zinc-300"
                        }`}
                      >
                        {formatSignedDelta(liveMetric.delta)}s
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-zinc-600 px-1.5">
                        --.--
                      </span>
                    )}

                    {isActiveSession ? (
                      <span
                        className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border"
                        style={{
                          backgroundColor: `${session.color}22`,
                          borderColor: `${session.color}80`,
                          color: session.color,
                        }}
                      >
                        HUD Active
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          onSelectComparison(session.id, session.selectedLapNum)
                        }
                        className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 transition cursor-pointer"
                      >
                        Use on HUD
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onRemoveComparisonSession(session.id)}
                      aria-label={`Remove ${session.racerName}`}
                      className="p-1 text-zinc-500 hover:text-rose-400 transition cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {session.analysis.bestLap.lap > 0 && (
                    <button
                      type="button"
                      onClick={() => onSelectComparison(session.id, null)}
                      style={
                        isActiveSession && effectiveLap === null
                          ? {
                              backgroundColor: `${session.color}28`,
                              borderColor: session.color,
                              color: session.color,
                            }
                          : undefined
                      }
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold border transition cursor-pointer ${
                        isActiveSession && effectiveLap === null
                          ? ""
                          : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700"
                      }`}
                    >
                      ★ Best (L{session.analysis.bestLap.lap} ·{" "}
                      {formatLapTime(session.analysis.bestLap.time)})
                    </button>
                  )}

                  {session.analysis.selectableLaps.map((lapNum) => {
                    const dur = session.analysis.laps[lapNum] || 0;
                    const isSelected = isActiveSession && effectiveLap === lapNum;
                    const deltaVsPrimaryBest =
                      primaryAnalysis.bestLap.time > 0 && dur > 0
                        ? dur - primaryAnalysis.bestLap.time
                        : null;

                    return (
                      <button
                        key={lapNum}
                        type="button"
                        onClick={() => onSelectComparison(session.id, lapNum)}
                        title={
                          deltaVsPrimaryBest !== null
                            ? `${session.racerName} Lap ${lapNum}: ${formatLapTime(dur)} (${formatSignedDelta(deltaVsPrimaryBest)}s vs your best)`
                            : `${session.racerName} Lap ${lapNum}: ${formatLapTime(dur)}`
                        }
                        style={
                          isSelected
                            ? {
                                backgroundColor: `${session.color}28`,
                                borderColor: session.color,
                                color: session.color,
                              }
                            : undefined
                        }
                        className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border transition flex items-center space-x-1.5 cursor-pointer ${
                          isSelected
                            ? ""
                            : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700"
                        }`}
                      >
                        <span>L{lapNum}</span>
                        <span className="text-zinc-500">{formatLapTime(dur)}</span>
                      </button>
                    );
                  })}

                  {session.analysis.selectableLaps.length === 0 && (
                    <span className="text-[10px] text-zinc-500">
                      No timed laps detected in this CSV.
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
