import type { Metadata } from "next";
import { Geist, Noto_Sans_JP } from "next/font/google";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const notoSansJP = Noto_Sans_JP({
  display: "swap",
  preload: false,
  variable: "--font-noto-jp",
});

export const metadata: Metadata = {
  title: "TCG Tracker",
  description: "Trading Card Game Tracker",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("dark font-sans", geist.variable, notoSansJP.variable)}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
