"use client";

import React from "react";

interface DeltaBarProps {
  delta: number;
  hasBestLap: boolean;
  referenceLabel?: string;
}

export default function DeltaBar({
  delta = 0,
  hasBestLap = false,
  referenceLabel = "LAP DELTA VS BEST",
}: DeltaBarProps) {
  const clampLimit = 2.0;
  const clampedDelta = Math.max(-clampLimit, Math.min(clampLimit, delta));

  const isFaster = delta < 0;
  const isSlower = delta > 0;

  const barPercent = Math.abs(clampedDelta) / clampLimit;
  const widthPct = barPercent * 50;

  let deltaText = "0.00";
  let textColor = "text-zinc-400";
  let glowColor = "drop-shadow-[0_0_0.2rem_rgba(161,161,170,0.2)]";

  if (!hasBestLap) {
    deltaText = "--.--";
    textColor = "text-zinc-500 animate-pulse";
    glowColor = "";
  } else if (isFaster) {
    deltaText = delta.toFixed(2);
    textColor = "text-cyan-400";
    glowColor = "drop-shadow-[0_0_0.3rem_rgba(34,211,238,0.4)]";
  } else if (isSlower) {
    deltaText = `+${delta.toFixed(2)}`;
    textColor = "text-rose-500";
    glowColor = "drop-shadow-[0_0_0.3rem_rgba(244,63,94,0.4)]";
  }

  return (
    <div className="flex flex-col justify-center h-fit w-full select-none font-sans">
      <div className="text-center">
        <span className="block truncate max-w-full text-[3cqw] font-black text-zinc-500 uppercase tracking-widest">
          {referenceLabel}
        </span>
      </div>

      <div
        className={`text-center text-[9cqw] font-mono font-black mt-[0.5cqw] leading-none ${textColor} ${glowColor}`}
      >
        {deltaText}
      </div>

      <div className="mt-[3cqw] relative w-full h-[3.5cqw] bg-zinc-900 border border-zinc-800/60 rounded-full overflow-hidden flex items-center">
        <div className="absolute left-1/2 top-0 bottom-0 w-[0.5cqw] bg-zinc-700/85 z-10" />

        <div className="absolute left-1/4 top-0 bottom-0 w-[0.25cqw] bg-zinc-800/50 z-10" />
        <div className="absolute right-1/4 top-0 bottom-0 w-[0.25cqw] bg-zinc-800/50 z-10" />

        {hasBestLap && isFaster && (
          <div
            className="absolute right-1/2 h-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] rounded-l-full"
            style={{ width: `${widthPct}%` }}
          />
        )}

        {hasBestLap && isSlower && (
          <div
            className="absolute left-1/2 h-full bg-rose-500 shadow-[0_0_8px_#f43f5e] rounded-r-full"
            style={{ width: `${widthPct}%` }}
          />
        )}
      </div>
    </div>
  );
}
