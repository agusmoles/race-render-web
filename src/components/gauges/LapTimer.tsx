"use client";

import React from "react";

interface LapTimerProps {
  currentLap: number;
  currentLapTime: string;
  bestLapTime: string;
  bestLapNum?: number;
  previousLapTime?: string;
}

export default function LapTimer({
  currentLap = 1,
  currentLapTime = "0:00.00",
  bestLapTime = "0:00.00",
  bestLapNum = 0,
  previousLapTime = "0:00.00",
}: LapTimerProps) {
  return (
    <div className="flex flex-col justify-center h-full w-full bg-zinc-950/70 backdrop-blur-md border-l-4 border-l-cyan-400 border border-zinc-800/80 p-3 rounded-2xl select-none font-sans shadow-xl">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black tracking-widest text-cyan-400 uppercase">
          LAP {currentLap}
        </span>
        <div className="flex flex-col items-end space-y-0.5">
          {bestLapTime !== "0:00.00" && (
            <div className="flex items-center space-x-1">
              <span className="text-[8px] font-black text-zinc-555 uppercase tracking-wider">
                BEST{bestLapNum > 0 ? ` (L${bestLapNum})` : ""}:
              </span>
              <span className="text-[10px] font-black text-emerald-400 font-mono tracking-tight drop-shadow-[0_0_6px_rgba(16,185,129,0.3)]">
                {bestLapTime}
              </span>
            </div>
          )}
          {previousLapTime && previousLapTime !== "0:00.00" && (
            <div className="flex items-center space-x-1">
              <span className="text-[8px] font-black text-zinc-500 uppercase tracking-wider">
                LAST:
              </span>
              <span className="text-[10px] font-bold text-zinc-300 font-mono tracking-tight">
                {previousLapTime}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-1 flex flex-col">
        <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">
          CURRENT TIME
        </span>
        <span className="text-2xl font-black text-zinc-100 font-mono tracking-tight mt-0.5 leading-none drop-shadow-[0_0_8px_rgba(244,244,245,0.2)]">
          {currentLapTime}
        </span>
      </div>
    </div>
  );
}
