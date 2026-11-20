import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SAKITO ガチャ",
  icons: { icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23265e48'/%3E%3Ctext x='32' y='45' text-anchor='middle' font-family='Georgia' font-size='40' fill='%23fff7de'%3ES%3C/text%3E%3C/svg%3E" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#efede5",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body data-phase="idle">{children}</body>
    </html>
  );
}
