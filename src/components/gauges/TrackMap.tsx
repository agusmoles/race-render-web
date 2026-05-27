"use client";

import React, { useMemo } from "react";

interface GPSPoint {
  lat: number;
  lon: number;
}

interface TrackMapProps {
  gpsPoints: GPSPoint[];
  currentLat: number;
  currentLon: number;
}

export default function TrackMap({
  gpsPoints = [],
  currentLat = 0,
  currentLon = 0,
}: TrackMapProps) {
  // 1. Filter out invalid/zero coordinates
  const validPoints = useMemo(() => {
    return gpsPoints.filter(p => p.lat !== 0 && p.lon !== 0);
  }, [gpsPoints]);

  // 2. Calculate min/max bounds and generate SVG path
  const { pathData, currentCoords, hasGPS } = useMemo(() => {
    if (validPoints.length < 5) {
      return { pathData: "", currentCoords: null, hasGPS: false };
    }

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;

    // Scan bounds
    for (const p of validPoints) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }

    const latSpan = maxLat - minLat;
    const lonSpan = maxLon - minLon;

    if (latSpan === 0 || lonSpan === 0) {
      return { pathData: "", currentCoords: null, hasGPS: false };
    }

    // Standard aspect ratio math
    const svgWidth = 160;
    const svgHeight = 160;
    const padding = 20;

    const scaleX = (svgWidth - padding * 2) / lonSpan;
    const scaleY = (svgHeight - padding * 2) / latSpan;
    // Maintain uniform scaling (square aspect ratio)
    const scale = Math.min(scaleX, scaleY);

    const getSvgCoords = (lat: number, lon: number) => {
      // Scale longitude to X axis
      const x = padding + (lon - minLon) * scale + (svgWidth - padding * 2 - lonSpan * scale) / 2;
      // In SVG, Y axis goes DOWN, so invert latitude
      const y = padding + (maxLat - lat) * scale + (svgHeight - padding * 2 - latSpan * scale) / 2;
      return { x, y };
    };

    // Build the SVG path string
    let path = "";
    validPoints.forEach((p, idx) => {
      const { x, y } = getSvgCoords(p.lat, p.lon);
      if (idx === 0) {
        path += `M ${x.toFixed(2)} ${y.toFixed(2)}`;
      } else {
        path += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
      }
    });
    path += " Z"; // Close path

    // Map current position
    let curCoords = null;
    if (currentLat !== 0 && currentLon !== 0) {
      curCoords = getSvgCoords(currentLat, currentLon);
    } else {
      // Fallback: draw first point
      curCoords = getSvgCoords(validPoints[0].lat, validPoints[0].lon);
    }

    return { pathData: path, currentCoords: curCoords, hasGPS: true };
  }, [validPoints, currentLat, currentLon]);

  return (
    <div className="flex flex-col items-center justify-center bg-zinc-900/85 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 w-full h-full text-zinc-100 shadow-2xl relative select-none">
      <div className="absolute top-2 left-3 text-[10px] uppercase tracking-wider text-zinc-500 font-sans">
        Circuit Map
      </div>

      <div className="relative w-full h-full flex items-center justify-center min-h-35 mt-2">
        {hasGPS ? (
          <svg className="w-full h-full max-w-40 max-h-40" viewBox="0 0 160 160">
            {/* Full Track outline */}
            <path
              d={pathData}
              fill="none"
              stroke="#27272a"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={pathData}
              fill="none"
              stroke="#3f3f46"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Current Position Marker */}
            {currentCoords && (
              <>
                {/* Pulsing glow ring */}
                <circle
                  cx={currentCoords.x}
                  cy={currentCoords.y}
                  r={8}
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  className="animate-ping opacity-75"
                />
                
                {/* Active marker dot */}
                <circle
                  cx={currentCoords.x}
                  cy={currentCoords.y}
                  r={5}
                  fill="#22d3ee"
                  className="drop-shadow-[0_0_8px_#22d3ee]"
                />
                
                <circle
                  cx={currentCoords.x}
                  cy={currentCoords.y}
                  r={1.5}
                  fill="#ffffff"
                />
              </>
            )}
          </svg>
        ) : (
          <div className="flex flex-col items-center justify-center text-zinc-600 text-center text-xs p-2">
            <span className="font-bold text-[10px] tracking-wider uppercase mb-1">
              No Track GPS Signal
            </span>
            <span className="text-[9px] text-zinc-500">
              Upload telemetry CSV with valid Latitude and Longitude channels.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
