"use client";

import React from "react";

interface RpmGaugeProps {
  rpm: number;
  maxRpm?: number;
}

export default function RpmGauge({
  rpm = 0,
  maxRpm = 15000,
}: RpmGaugeProps) {
  const clampedRpm = Math.max(0, Math.min(rpm, maxRpm));
  const percentage = clampedRpm / maxRpm;

  const radius = 60;
  const strokeWidth = 8;
  const center = 80;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75;
  const strokeDashoffset = arcLength - percentage * arcLength;

  const getArcColor = (pct: number) => {
    if (pct > 0.85) return "#f43f5e";
    if (pct > 0.65) return "#fb923c";
    if (pct > 0.45) return "#fbbf24";
    return "#10b981";
  };

  const arcColor = getArcColor(percentage);

  return (
    <div className="flex flex-col items-center justify-center w-full h-full text-zinc-100 relative select-none">
      <div className="relative w-28 h-28 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 160 160">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
            className="transform rotate-135"
            style={{ transformOrigin: "50% 50%" }}
          />

          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={arcColor}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transform rotate-135"
            style={{
              transformOrigin: "50% 50%",
              filter: `drop-shadow(0 0 8px ${arcColor}80)`,
            }}
          />

        </svg>

        <div className="absolute flex flex-col items-center justify-center text-center">
          <span className="text-lg font-extrabold tracking-tight font-mono text-zinc-100 leading-none">
            {Math.round(clampedRpm)}
          </span>
          <span className="text-[7px] font-sans font-bold tracking-wider text-zinc-500 uppercase mt-0.5">
            rpm
          </span>
        </div>
      </div>
    </div>
  );
}
