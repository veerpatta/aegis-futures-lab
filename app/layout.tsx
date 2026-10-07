import type { Metadata, Viewport } from "next";
import Sidebar from "@/components/nav/Sidebar";
import AppHeader from "@/components/nav/AppHeader";
import { MobileTabBar } from "@/components/nav/MobileNav";
import { DataProvider } from "@/components/providers/DataProvider";
import { ZoneProvider } from "@/components/providers/ZoneProvider";
import { PrivacyProvider } from "@/components/providers/PrivacyProvider";
import { BotHealthProvider } from "@/components/providers/BotHealthProvider";
import "./globals.css";
import { PaperProvider } from "@/components/providers/PaperProvider";
import { ExperimentProvider } from "@/components/providers/ExperimentProvider";
import { QuoteProvider } from "@/components/providers/QuoteProvider";
import { SignalFeedProvider } from "@/components/signals/useSignalFeed";
import { GlossaryProvider } from "@/components/ui/Glossary";
import PullToRefresh from "@/components/ui/PullToRefresh";
import ServiceWorker from "@/components/ui/ServiceWorker";

export const metadata: Metadata = {
  title: "Aegis Futures Lab",
  description:
    "Virtual-only futures lab: a bot trades pretend money on delayed S&P and Nasdaq micro prices, learns under fixed rules and shows, in plain words, what it found. No real money.",
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
                <PaperProvider>
                  <ExperimentProvider>
                    <SignalFeedProvider>
                      <QuoteProvider>
                        <GlossaryProvider>
                          <div className="shell">
                            <Sidebar />
                            <div className="contentCol">
                              <AppHeader />
                              <PullToRefresh />
                              <main className="main">{children}</main>
                            </div>
                          </div>
                          <MobileTabBar />
                          <ServiceWorker />
                        </GlossaryProvider>
                      </QuoteProvider>
                    </SignalFeedProvider>
                  </ExperimentProvider>
                </PaperProvider>
              </BotHealthProvider>
            </PrivacyProvider>
          </DataProvider>
        </ZoneProvider>
      </body>
    </html>
  );
}
