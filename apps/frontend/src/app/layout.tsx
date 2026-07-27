import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import TradingModeBanner from "@/components/layout/TradingModeBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Caliana Scalper - Crypto Dashboard",
  description: "Real-time cryptocurrency monitoring dashboard with advanced charting",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden flex">
        <Sidebar />
        <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
          <TradingModeBanner />
          <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
