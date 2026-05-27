"use client";

import React from "react";

interface SpeedometerProps {
  speed: number; // in km/h or mph
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
  
  // SVG Arc calculation for 270 degree dial (from 135 to 405 degrees)
  const radius = 80;
  const strokeWidth = 10;
  const center = 100;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75; // 270 degrees
  const strokeDashoffset = arcLength - percentage * arcLength;

  return (
    <div className="flex flex-col items-center justify-center bg-zinc-900/85 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 w-full h-full text-zinc-100 shadow-2xl relative select-none">
      <div className="absolute top-2 left-3 text-[10px] uppercase tracking-wider text-zinc-500 font-sans">
        Velocity
      </div>
      <div className="relative w-36 h-36 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
          {/* Base track */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#27272a"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
            className="transform rotate-[135deg]"
            style={{ transformOrigin: "50% 50%" }}
          />

          {/* Active speed track */}
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
            className="transform rotate-[135deg] transition-all duration-75 ease-out drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]"
            style={{ transformOrigin: "50% 50%" }}
          />

          {/* Glowing tick marker */}
          {percentage > 0 && (
            <circle
              cx={center + radius * Math.cos(((135 + percentage * 270) * Math.PI) / 180)}
              cy={center + radius * Math.sin(((135 + percentage * 270) * Math.PI) / 180)}
              r={4}
              fill="#ffffff"
              className="drop-shadow-[0_0_4px_#22d3ee]"
            />
          )}
        </svg>

        {/* Speed readout */}
        <div className="absolute flex flex-col items-center justify-center text-center">
          <span className="text-4xl font-extrabold tracking-tight font-mono text-zinc-100 leading-none">
            {Math.round(clampedSpeed)}
          </span>
          <span className="text-[10px] font-sans font-bold tracking-wider text-zinc-500 uppercase mt-1">
            {unit}
          </span>
        </div>
      </div>
    </div>
  );
}
