import StudioHeader from "@/components/StudioHeader";
import Workspace from "@/components/Workspace";
import { Flame } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center">
      <StudioHeader activeRoute="hud" />

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
