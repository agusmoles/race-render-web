import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Open RaceRender Web",
  title: "Open RaceRender Web HUD - Telemetry Overlay Studio",
  description:
    "Synchronize and render beautiful RPM, Speedometer, G-force, Delta Bar, and track map telemetry overlays onto POV racing videos, fully client-side.",
  keywords: ["racing", "telemetry", "overlay", "hud", "tools", "render"],
  authors: [{ name: "Agustin Moles", url: "https://agustinmoles.com.ar" }],
  creator: "Agustin Moles",
  publisher: "Agustin Moles",
  robots: "index,follow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        {children}
      </body>
    </html>
  );
}
