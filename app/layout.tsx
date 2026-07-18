import type { Metadata } from "next";
import Sidebar from "@/components/nav/Sidebar";
import { DataProvider } from "@/components/providers/DataProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aegis Futures Lab",
  description:
    "Strategy research lab for MES & MNQ futures — pick a strategy, tune it, backtest it. Research edition: delayed data, paper simulation only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <DataProvider>
          <div className="shell">
            <Sidebar />
            <main className="main">{children}</main>
          </div>
        </DataProvider>
      </body>
    </html>
  );
}
