import type { MetadataRoute } from "next";

/* Installable app: "Add to Home Screen" opens on Today — the one screen that
   says whether the bot is working and what is new. Colours match --bg.
   Long-pressing the icon offers shortcuts straight to Ideas and Bot. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aegis Futures Lab",
    short_name: "Aegis",
    description:
      "Practice-only futures lab: a bot tests trading methods on delayed S&P and Nasdaq micro prices and shows, in plain words, what it found. No real money.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#05080f",
    theme_color: "#05080f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Trade ideas", short_name: "Ideas", url: "/signals", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Bot and trial account", short_name: "Bot", url: "/brain", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
