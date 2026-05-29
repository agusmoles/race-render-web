import Workspace from "@/components/Workspace";
import { Flame } from "lucide-react";
import Image from "next/image";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center">
      <header className="w-full border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-30 select-none py-4 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Image
              src="/assets/images/logo.png"
              alt="Logo"
              width={52}
              height={52}
            />
            <div className="flex flex-col">
              <h1 className="text-sm font-black uppercase tracking-widest text-zinc-100 flex items-center space-x-1.5">
                <span>Open RaceRender</span>
                <span className="text-[10px] bg-rose-500 text-zinc-950 font-black px-1.5 py-0.5 rounded-md">
                  HUD
                </span>
              </h1>
              <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">
                Carbon Edition Overlay Studio
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-6 text-[10px] text-zinc-550 uppercase tracking-wider font-semibold">
            <div>100% Offline Client Studio</div>
            <div>•</div>
            <div>GPU Accelerated Export</div>
          </div>
        </div>
      </header>

      <Workspace />

      <section className="w-full max-w-4xl mx-auto my-12 px-6 flex flex-col items-center">
        <h2 className="text-xl font-bold text-zinc-100 mb-6 uppercase tracking-widest flex items-center space-x-2">
          <Flame className="w-5 h-5 text-rose-500" />
          <span>Example Render</span>
        </h2>
        <div className="w-full aspect-video rounded-xl overflow-hidden border border-zinc-800 shadow-2xl">
          <iframe 
            width="100%" 
            height="100%" 
            src="https://www.youtube.com/embed/31G7PHYFvWI" 
            title="Open RaceRender Example Video" 
            frameBorder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
            allowFullScreen
          />
        </div>
      </section>

      <footer className="w-full mt-auto border-t border-zinc-900/60 py-6 text-center select-none">
        <p className="text-[9px] text-zinc-650 uppercase tracking-widest font-bold">
          Open RaceRender Web • Crafted with precision • GPU Accelerated
          Rendering
        </p>
      </footer>
    </main>
  );
}
