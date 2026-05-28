"use client";

import React from "react";

interface DeltaBarProps {
  delta: number;
  hasBestLap: boolean;
}

export default function DeltaBar({ delta = 0, hasBestLap = false }: DeltaBarProps) {
  // Clamp delta to [-2.0, 2.0] for the visual bar display
  const clampLimit = 2.0;
  const clampedDelta = Math.max(-clampLimit, Math.min(clampLimit, delta));
  
  // Calculate width percentages
  // Center is at 50%
  const isFaster = delta < 0;
  const isSlower = delta > 0;
  const isZero = delta === 0;

  const barPercent = Math.abs(clampedDelta) / clampLimit; // 0 to 1
  const widthPct = barPercent * 50; // Max 50% width from center

  // Styling properties
  let deltaText = "0.00";
  let textColor = "text-zinc-400";
  let glowColor = "drop-shadow-[0_0_0.2rem_rgba(161,161,170,0.2)]";

  if (!hasBestLap) {
    deltaText = "--.--";
    textColor = "text-zinc-500 animate-pulse";
    glowColor = "";
  } else if (isFaster) {
    deltaText = delta.toFixed(2); // will naturally include negative sign e.g. -0.45
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
        <span className="text-[3cqw] font-black text-zinc-500 uppercase tracking-widest">
          LAP DELTA
        </span>
      </div>
      
      <div className={`text-center text-[9cqw] font-mono font-black mt-[0.5cqw] leading-none ${textColor} ${glowColor}`}>
        {deltaText}
      </div>

      {/* Delta Bar visual representation */}
      <div className="mt-[3cqw] relative w-full h-[3.5cqw] bg-zinc-900 border border-zinc-800/60 rounded-full overflow-hidden flex items-center">
        {/* Center line dividing faster and slower */}
        <div className="absolute left-1/2 top-0 bottom-0 w-[0.5cqw] bg-zinc-700/85 z-10" />

        {/* Muted ticks at -1.0s and +1.0s */}
        <div className="absolute left-1/4 top-0 bottom-0 w-[0.25cqw] bg-zinc-800/50 z-10" />
        <div className="absolute right-1/4 top-0 bottom-0 w-[0.25cqw] bg-zinc-800/50 z-10" />

        {/* Faster (Negative Delta) bar growing left from center */}
        {hasBestLap && isFaster && (
          <div
            className="absolute right-1/2 h-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] rounded-l-full"
            style={{ width: `${widthPct}%` }}
          />
        )}

        {/* Slower (Positive Delta) bar growing right from center */}
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
