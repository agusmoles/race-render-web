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
      <div className="relative w-full h-full flex items-center justify-center">
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
            className="transform rotate-135 transition-all duration-75 ease-out"
            style={{
              transformOrigin: "50% 50%",
              filter: `drop-shadow(0 0 8px ${arcColor}80)`,
            }}
          />

          <text
            x={center}
            y={center}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#ffffff"
            className="text-[28px] font-extrabold tracking-tight font-mono transform rotate-90"
            style={{ transformOrigin: "50% 50%" }}
          >
            {Math.round(clampedRpm)}
          </text>
          
          <text
            x={center}
            y={center + 20}
            textAnchor="middle"
            dominantBaseline="central"
            fill="rgba(255,255,255,0.5)"
            className="text-[10px] font-sans font-bold tracking-wider uppercase transform rotate-90"
            style={{ transformOrigin: "50% 50%" }}
          >
            rpm
          </text>
        </svg>
      </div>
    </div>
  );
}
