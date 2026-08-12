import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import { publicEnv } from '@/lib/env';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
});

const title = 'Lidera — Сквозная аналитика рекламы до реальной продажи';
const description =
  'Анализируйте рекламу, креативы, лиды, продажи и выручку в одной платформе.';

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: {
    default: title,
    template: '%s — Lidera',
  },
  description,
  applicationName: 'Lidera',
  keywords: [
    'сквозная аналитика',
    'аналитика рекламы',
    'Meta Ads',
    'TikTok Ads',
    'ROAS',
    'CPL',
    'аналитика креативов',
    'Lidera',
  ],
  authors: [{ name: 'Lidera' }],
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    url: publicEnv.siteUrl,
    siteName: 'Lidera',
    title,
    description,
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: '#08090A',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={inter.variable}>
      <body className="min-h-dvh bg-base text-ink antialiased">{children}</body>
    </html>
  );
}
