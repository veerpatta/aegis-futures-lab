import type { Metadata, Viewport } from "next";
import Sidebar from "@/components/nav/Sidebar";
import { MobileTopBar, MobileTabBar } from "@/components/nav/MobileNav";
import { DataProvider } from "@/components/providers/DataProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aegis Futures Lab",
  description:
    "Strategy research lab for MES & MNQ futures — pick a strategy, tune it, backtest it. Research edition: delayed data, paper simulation only.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070b12",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <DataProvider>
          <div className="shell">
            <Sidebar />
            <div className="contentCol">
              <MobileTopBar />
              <main className="main">{children}</main>
            </div>
          </div>
          <MobileTabBar />
        </DataProvider>
      </body>
    </html>
  );
}
