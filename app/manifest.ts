import type { MetadataRoute } from "next";

/* Installable app: "Add to Home Screen" opens straight onto the signal
   feed — the page you actually check from a phone between sessions. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aegis Futures Lab",
    short_name: "Aegis",
    description:
      "Paper-signal terminal for MES & MNQ futures — tiered signals, zones, and journal on delayed data.",
    start_url: "/signals",
    display: "standalone",
    background_color: "#070b12",
    theme_color: "#070b12",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
