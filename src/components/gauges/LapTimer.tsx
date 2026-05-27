"use client";

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
    <div className="flex flex-col justify-center h-fit w-full max-w-70 bg-zinc-950/70 backdrop-blur-md border-l-[1.5cqw] border-l-cyan-400 border border-zinc-800/80 pt-[5cqw] pb-[6cqw] px-[5cqw] rounded-[6cqw] select-none font-sans shadow-xl">
      <div className="flex items-center justify-between">
        <span className="text-[4.5cqw] font-black tracking-widest text-cyan-400 uppercase">
          LAP {currentLap}
        </span>
        <div className="flex flex-col items-end space-y-[0.5cqw]">
          {bestLapTime !== "0:00.00" && (
            <div className="flex items-center space-x-[1.5cqw]">
              <span className="text-[3.5cqw] font-black text-zinc-555 uppercase tracking-wider">
                BEST{bestLapNum > 0 ? ` (L${bestLapNum})` : ""}:
              </span>
              <span className="text-[4.5cqw] font-black text-emerald-400 font-mono tracking-tight drop-shadow-[0_0_0.2rem_rgba(16,185,129,0.3)]">
                {bestLapTime}
              </span>
            </div>
          )}
          {previousLapTime && previousLapTime !== "0:00.00" && (
            <div className="flex items-center space-x-[1.5cqw]">
              <span className="text-[3.5cqw] font-black text-zinc-500 uppercase tracking-wider">
                LAST:
              </span>
              <span className="text-[4.5cqw] font-bold text-zinc-300 font-mono tracking-tight">
                {previousLapTime}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-[2.5cqw] flex flex-col">
        <span className="text-[3.5cqw] font-bold text-zinc-400 uppercase tracking-widest">
          CURRENT TIME
        </span>
        <span className="text-[12cqw] font-black text-zinc-100 font-mono tracking-tight mt-[0.5cqw] leading-none drop-shadow-[0_0_0.3rem_rgba(244,244,245,0.2)]">
          {currentLapTime}
        </span>
      </div>
    </div>
  );
}
