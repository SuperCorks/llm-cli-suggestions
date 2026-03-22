import type { Metadata } from "next";
import { Inter, Roboto_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { AppChrome } from "@/components/app-chrome";
import { getRuntimeStatusWithHealth } from "@/lib/server/runtime";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "cli-auto-complete Console",
  description: "Local control app for the cli-auto-complete daemon, SQLite logs, and model benchmarking.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const runtime = await getRuntimeStatusWithHealth();

  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${robotoMono.variable}`}>
      <body>
        <AppChrome runtime={runtime}>{children}</AppChrome>
      </body>
    </html>
  );
}
