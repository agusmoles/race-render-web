"use client";

import React from "react";

interface SpeedometerProps {
  speed: number;
  unit?: string;
  maxSpeed?: number;
}

export default function Speedometer({
  speed = 0,
  unit = "km/h",
  maxSpeed = 260,
}: SpeedometerProps) {
  const clampedSpeed = Math.max(0, Math.min(speed, maxSpeed));
  const percentage = clampedSpeed / maxSpeed;
  
  const radius = 80;
  const strokeWidth = 10;
  const center = 100;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75;
  const strokeDashoffset = arcLength - percentage * arcLength;

  return (
    <div className="flex flex-col items-center justify-center w-full h-full text-zinc-100 relative select-none">
      <div className="relative w-full h-full flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
            className="transform rotate-[135deg]"
            style={{ transformOrigin: "50% 50%" }}
          />

          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#22d3ee"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transform rotate-[135deg] drop-shadow-[0_0_8px_rgba(34,211,238,0.5)] transition-all duration-75 ease-out"
            style={{ transformOrigin: "50% 50%" }}
          />

          <text
            x={center}
            y={center}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#ffffff"
            className="text-[42px] font-extrabold tracking-tight font-mono transform rotate-90"
            style={{ transformOrigin: "50% 50%" }}
          >
            {Math.round(clampedSpeed)}
          </text>
          
          <text
            x={center}
            y={center + 25}
            textAnchor="middle"
            dominantBaseline="central"
            fill="rgba(255,255,255,0.5)"
            className="text-[12px] font-sans font-bold tracking-wider uppercase transform rotate-90"
            style={{ transformOrigin: "50% 50%" }}
          >
            {unit}
          </text>
        </svg>
      </div>
    </div>
  );
}
