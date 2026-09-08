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
    // translate="no" is not decoration. The buying agent's screens render in
    // Japanese while this document is served as lang="en", and Chrome decides
    // whether to machine-translate from the INITIAL html - long before
    // LanguageContext corrects documentElement.lang on hydration. A real agent
    // opened his list and got the page rewritten by Google Translate: the shop
    // name "snkrdunk" translated, every outcome in the dropdown reworded, and
    // our hand-written Japanese replaced with worse Japanese. The app carries
    // its own language selector, so a browser rewriting these strings can only
    // do harm.
    <html
      lang="en"
      translate="no"
      className={cn("notranslate dark font-sans", geist.variable, notoSansJP.variable)}
    >
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
