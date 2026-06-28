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
  startFinishCoord?: GPSPoint | null;
}

export default function TrackMap({
  gpsPoints = [],
  currentLat = 0,
  currentLon = 0,
  startFinishCoord = null,
}: TrackMapProps) {
  const validPoints = useMemo(() => {
    return gpsPoints.filter(p => p.lat !== 0 && p.lon !== 0);
  }, [gpsPoints]);

  const { pathData, currentCoords, hasGPS, sfCoords } = useMemo(() => {
    if (validPoints.length < 5) {
      return { pathData: "", currentCoords: null, hasGPS: false, sfCoords: null };
    }

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;

    for (const p of validPoints) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }

    const latSpan = maxLat - minLat;
    const lonSpan = maxLon - minLon;

    if (latSpan === 0 || lonSpan === 0) {
      return { pathData: "", currentCoords: null, hasGPS: false, sfCoords: null };
    }

    const svgWidth = 200;
    const svgHeight = 200;
    const padding = 20;

    const scaleX = (svgWidth - padding * 2) / lonSpan;
    const scaleY = (svgHeight - padding * 2) / latSpan;
    const scale = Math.min(scaleX, scaleY);

    const getSvgCoords = (lat: number, lon: number) => {
      const x = padding + (lon - minLon) * scale + (svgWidth - padding * 2 - lonSpan * scale) / 2;
      const y = padding + (maxLat - lat) * scale + (svgHeight - padding * 2 - latSpan * scale) / 2;
      return { x, y };
    };

    let path = "";
    validPoints.forEach((p, idx) => {
      const { x, y } = getSvgCoords(p.lat, p.lon);
      if (idx === 0) {
        path += `M ${x.toFixed(2)} ${y.toFixed(2)}`;
      } else {
        path += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
      }
    });
    path += " Z";

    let curCoords = null;
    if (currentLat !== 0 && currentLon !== 0) {
      curCoords = getSvgCoords(currentLat, currentLon);
    } else {
      curCoords = getSvgCoords(validPoints[0].lat, validPoints[0].lon);
    }

    let sfCoords = null;
    if (startFinishCoord && startFinishCoord.lat !== 0 && startFinishCoord.lon !== 0) {
      sfCoords = getSvgCoords(startFinishCoord.lat, startFinishCoord.lon);
    }

    return { pathData: path, currentCoords: curCoords, hasGPS: true, sfCoords };
  }, [validPoints, currentLat, currentLon, startFinishCoord]);

  return (
    <div className="flex flex-col items-center justify-center w-full h-full text-zinc-100 relative select-none">
      <div className="relative w-full h-full flex items-center justify-center">
        {hasGPS ? (
          <svg className="w-full h-full max-w-52 max-h-52" viewBox="0 0 200 200">
            <path
              d={pathData}
              fill="none"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={pathData}
              fill="none"
              stroke="rgba(255,255,255,0.75)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {sfCoords && (
              <polygon
                points={`${sfCoords.x},${sfCoords.y - 5} ${sfCoords.x + 4},${sfCoords.y} ${sfCoords.x},${sfCoords.y + 5} ${sfCoords.x - 4},${sfCoords.y}`}
                fill="#f43f5e"
                className="drop-shadow-[0_0_6px_#f43f5e]"
              />
            )}

            {currentCoords && (
              <>
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
