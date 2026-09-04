import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Inter everywhere, matching the live Pulse 3D site. No monospace font is
// loaded on purpose: the rules file forbids one anywhere in the interface.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pulse 3D Patient Education",
  description: "Surgical patient education animations from Pulse 3D Media.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
