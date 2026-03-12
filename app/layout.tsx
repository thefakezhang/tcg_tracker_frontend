import type { Metadata } from "next";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
