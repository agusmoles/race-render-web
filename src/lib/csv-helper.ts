export interface TelemetryRow {
  time: number;
  speed: number;
  rpm: number;
  latAcc: number;
  lonAcc: number;
  lat: number;
  lon: number;
}

export interface ParsedTelemetry {
  headers: string[];
  units: string[];
  metadata: Record<string, string>;
  rows: TelemetryRow[];
  channelMapping: Record<string, string>;
}

interface ChannelIndices {
  time: number;
  speed: number;
  rpm: number;
  latAcc: number;
  lonAcc: number;
  lat: number;
  lon: number;
}

function parseFloatClean(val: string): number {
  if (!val) return 0;
  // Remove all quotes, spaces, and replace comma decimals with dots for European CSV format
  const cleanStr = val.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "").replace(",", ".");
  const match = cleanStr.match(/[-+]?[0-9]*\.?[0-9]+/);
  if (match) {
    const num = parseFloat(match[0]);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  // Auto-detect column separator
  let separator = ",";
  if (line.includes(";")) separator = ";";
  else if (line.includes("\t")) separator = "\t";

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === separator && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseTelemetryCSV(csvText: string): ParsedTelemetry {
  const lines = csvText.split(/\r?\n/);
  const metadata: Record<string, string> = {};
  let headerIndex = -1;
  let unitIndex = -1;
  let dataStartIndex = -1;

  // Scan first 100 lines for the column headers row
  for (let i = 0; i < Math.min(lines.length, 100); i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = parseCSVLine(line);
    
    const hasTimeCol = parts.some(p => {
      const c = p.toLowerCase();
      return c === "time" || c.startsWith("time ") || c.startsWith("time(") || c.startsWith("time[") || c === "seconds" || c === "sec";
    });
    
    const hasSpeedOrRpmCol = parts.some(p => {
      const c = p.toLowerCase();
      return c.includes("speed") || c.includes("rpm") || c.includes("velocity") || c.includes("engine") || c.includes("revs");
    });

    if (hasTimeCol && hasSpeedOrRpmCol) {
      headerIndex = i;
      unitIndex = i + 1;
      dataStartIndex = i + 2;
      break;
    }

    // Save key-value metadata pairs if seen
    if (parts.length === 2) {
      metadata[parts[0]] = parts[1];
    } else if (parts.length > 2 && parts[0] && parts[1]) {
      metadata[parts[0]] = parts.slice(1).join(" ");
    }
  }

  // Fallback heuristic: search for first numeric data block
  if (headerIndex === -1) {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = parseCSVLine(line);
      const numericCount = parts.filter(p => p !== "" && !isNaN(Number(p))).length;
      if (numericCount > 2 && parts.length > 2) {
        headerIndex = i - 1;
        unitIndex = -1;
        dataStartIndex = i;
        break;
      }
    }
  }

  if (headerIndex === -1) {
    throw new Error("Could not detect headers in telemetry CSV. Please make sure the file contains column names like 'Time', 'Speed' or 'RPM'.");
  }

  const headers = parseCSVLine(lines[headerIndex]).map(h => h.trim().replace(/^["']|["']$/g, ""));
  const units = unitIndex !== -1 && unitIndex < lines.length
    ? parseCSVLine(lines[unitIndex]).map(u => u.trim().replace(/^["']|["']$/g, ""))
    : new Array(headers.length).fill("");

  if (dataStartIndex === -1) {
    dataStartIndex = Math.max(headerIndex + 1, unitIndex + 1);
  }

  const indices = detectChannelIndices(headers);

  // Convert indices back to string mapping for UI visibility
  const mapping: Record<string, string> = {
    time: indices.time !== -1 ? headers[indices.time] : "",
    speed: indices.speed !== -1 ? headers[indices.speed] : "",
    rpm: indices.rpm !== -1 ? headers[indices.rpm] : "",
    latAcc: indices.latAcc !== -1 ? headers[indices.latAcc] : "",
    lonAcc: indices.lonAcc !== -1 ? headers[indices.lonAcc] : "",
    lat: indices.lat !== -1 ? headers[indices.lat] : "",
    lon: indices.lon !== -1 ? headers[indices.lon] : ""
  };

  const rows: TelemetryRow[] = [];

  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = parseCSVLine(line);
    if (parts.length < Math.min(3, headers.length)) continue;

    const time = indices.time !== -1 ? parseFloatClean(parts[indices.time]) : (rows.length * 0.05); // fallback 20Hz
    const speed = indices.speed !== -1 ? parseFloatClean(parts[indices.speed]) : 0;
    const rpm = indices.rpm !== -1 ? parseFloatClean(parts[indices.rpm]) : 0;
    const latAcc = indices.latAcc !== -1 ? parseFloatClean(parts[indices.latAcc]) : 0;
    const lonAcc = indices.lonAcc !== -1 ? parseFloatClean(parts[indices.lonAcc]) : 0;
    const lat = indices.lat !== -1 ? parseFloatClean(parts[indices.lat]) : 0;
    const lon = indices.lon !== -1 ? parseFloatClean(parts[indices.lon]) : 0;

    rows.push({
      time,
      speed,
      rpm,
      latAcc,
      lonAcc,
      lat,
      lon
    });
  }

  // NORMALIZE TIMELINE TO START EXACTLY AT 0.0
  const startTime = rows.length > 0 ? rows[0].time : 0;
  if (startTime > 0) {
    for (const r of rows) {
      r.time = parseFloat((r.time - startTime).toFixed(3));
    }
  }

  return {
    headers,
    units,
    metadata,
    rows,
    channelMapping: mapping
  };
}

function detectChannelIndices(headers: string[]): ChannelIndices {
  const indices: ChannelIndices = {
    time: -1,
    speed: -1,
    rpm: -1,
    latAcc: -1,
    lonAcc: -1,
    lat: -1,
    lon: -1
  };

  for (let i = 0; i < headers.length; i++) {
    const name = headers[i].toLowerCase().trim();

    // 1. Time channel
    if (indices.time === -1 && (name === "time" || name.startsWith("time ") || name.startsWith("time(") || name.startsWith("time[") || name === "seconds" || name === "sec")) {
      indices.time = i;
    }
    // 2. RPM channel
    else if (indices.rpm === -1 && (name.includes("rpm") || name.includes("engine speed") || name.includes("revs") || name.includes("engine_speed"))) {
      indices.rpm = i;
    }
    // 3. Speed channel
    else if (indices.speed === -1 && (name.includes("speed") || name.includes("velocity") || name.includes("gps speed") || name === "vgps" || name === "v_gps" || name.includes("kmh") || name.includes("mph"))) {
      indices.speed = i;
    }
    // 4. Lat Acceleration channel
    else if (indices.latAcc === -1 && (name.includes("latacc") || name.includes("lat acc") || name.includes("lateral acc") || name.includes("lat_acc") || name.includes("side acc") || (name.includes("lat") && name.includes("acc")))) {
      indices.latAcc = i;
    }
    // 5. Lon Acceleration channel
    else if (indices.lonAcc === -1 && (name.includes("lonacc") || name.includes("lon acc") || name.includes("long acc") || name.includes("lon_acc") || name.includes("accel acc") || (name.includes("lon") && name.includes("acc")))) {
      indices.lonAcc = i;
    }
    // 6. Latitude channel (exclude Accel/G columns)
    else if (indices.lat === -1 && (name.includes("latitude") || name.includes("gps lat") || name === "lat" || name === "gps_lat") && !name.includes("acc") && (!name.includes("g") || name.includes("gps"))) {
      indices.lat = i;
    }
    // 7. Longitude channel (exclude Accel/G columns)
    else if (indices.lon === -1 && (name.includes("longitude") || name.includes("gps lon") || name.includes("gps lng") || name === "lon" || name === "lng" || name === "gps_lon") && !name.includes("acc") && (!name.includes("g") || name.includes("gps"))) {
      indices.lon = i;
    }
  }

  // Fallbacks if not matches
  if (indices.time === -1) {
    indices.time = headers.findIndex(h => h.toLowerCase().includes("time") || h.toLowerCase().includes("sec"));
  }
  if (indices.speed === -1) {
    indices.speed = headers.findIndex(h => h.toLowerCase().includes("speed") || h.toLowerCase().includes("vel"));
  }
  if (indices.rpm === -1) {
    indices.rpm = headers.findIndex(h => h.toLowerCase().includes("rpm") || h.toLowerCase().includes("eng"));
  }

  return indices;
}
