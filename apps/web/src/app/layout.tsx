import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from 'next';
import { Noto_Serif_JP, Space_Mono } from 'next/font/google';

import './globals.css';

const notoSerifJP = Noto_Serif_JP({
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  variable: '--font-display',
  display: 'swap',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Yokai Control Room',
    template: '%s | Yokai',
  },
  description: 'Run OpenClaw inside Vercel Sandbox and monitor sessions, usage, and runtime state.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0d0a08',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${notoSerifJP.variable} ${spaceMono.variable}`}>
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
