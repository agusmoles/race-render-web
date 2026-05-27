"use client";

import React from "react";

interface RpmGaugeProps {
  rpm: number;
  maxRpm?: number;
  redline?: number;
}

export default function RpmGauge({
  rpm = 0,
  maxRpm = 10000,
  redline = 8500,
}: RpmGaugeProps) {
  const clampedRpm = Math.max(0, Math.min(rpm, maxRpm));
  const percentage = clampedRpm / maxRpm;
  const isShiftWarning = clampedRpm >= redline + 1000;

  // Let's draw a linear series of LED indicator blocks (e.g. 20 blocks)
  const totalLeds = 20;
  const activeLeds = Math.round(percentage * totalLeds);

  return (
    <div
      className={`flex flex-col justify-center bg-zinc-900/85 backdrop-blur-md border rounded-2xl p-4 w-full h-full text-zinc-100 shadow-2xl transition-all select-none ${
        isShiftWarning
          ? "border-rose-500 animate-pulse bg-rose-950/20 shadow-[0_0_20px_rgba(244,63,94,0.3)]"
          : "border-zinc-800"
      }`}
    >
      <div className="flex justify-between items-center mb-1">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-sans">
          Engine Speed
        </div>
        <div className="flex items-baseline space-x-1">
          <span className="text-xl font-bold font-mono text-zinc-100">
            {Math.round(clampedRpm)}
          </span>
          <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-sans font-bold">
            rpm
          </span>
        </div>
      </div>

      {/* LED segments */}
      <div className="flex items-center space-x-0.75 h-5 w-full bg-zinc-950 rounded-lg p-1 border border-zinc-850 overflow-hidden">
        {Array.from({ length: totalLeds }).map((_, idx) => {
          const ledRpmValue = ((idx + 1) / totalLeds) * maxRpm;
          const isActive = idx < activeLeds;
          
          let activeColor = "bg-emerald-500 shadow-[0_0_8px_#10b981]";
          let inactiveColor = "bg-emerald-950/30";

          if (ledRpmValue >= redline + 1000) {
            // Shift point
            activeColor = "bg-blue-400 shadow-[0_0_10px_#60a5fa] animate-ping";
            inactiveColor = "bg-blue-950/20";
          } else if (ledRpmValue >= redline) {
            // Redline alert
            activeColor = "bg-rose-500 shadow-[0_0_8px_#f43f5e]";
            inactiveColor = "bg-rose-950/30";
          } else if (ledRpmValue >= redline - 2500) {
            // High RPM warnings
            activeColor = "bg-amber-400 shadow-[0_0_8px_#fbbf24]";
            inactiveColor = "bg-amber-950/30";
          }

          return (
            <div
              key={idx}
              className={`flex-1 h-full rounded-[1px] transition-all duration-75 ${
                isActive ? activeColor : inactiveColor
              }`}
            />
          );
        })}
      </div>

      <div className="flex justify-between items-center text-[8px] text-zinc-600 font-sans font-semibold mt-1 uppercase tracking-wider px-1">
        <span>0</span>
        <span>{Math.round(redline / 1000)}k redline</span>
        <span>{Math.round(maxRpm / 1000)}k</span>
      </div>
    </div>
  );
}
