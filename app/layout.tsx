import type { Metadata, Viewport } from "next";
import Sidebar from "@/components/nav/Sidebar";
import AppHeader from "@/components/nav/AppHeader";
import { MobileTabBar } from "@/components/nav/MobileNav";
import { DataProvider } from "@/components/providers/DataProvider";
import { ZoneProvider } from "@/components/providers/ZoneProvider";
import { PrivacyProvider } from "@/components/providers/PrivacyProvider";
import { BotHealthProvider } from "@/components/providers/BotHealthProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aegis Futures Lab",
  description:
    "Strategy research lab for MES & MNQ futures — pick a strategy, tune it, backtest it. Research edition: delayed data, paper simulation only.",
  appleWebApp: {
    capable: true,
    title: "Aegis",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#05080f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ZoneProvider>
          <DataProvider>
            <PrivacyProvider>
              <BotHealthProvider>
                <div className="shell">
                  <Sidebar />
                  <div className="contentCol">
                    <AppHeader />
                    <main className="main">{children}</main>
                  </div>
                </div>
                <MobileTabBar />
              </BotHealthProvider>
            </PrivacyProvider>
          </DataProvider>
        </ZoneProvider>
      </body>
    </html>
  );
}
