import '../index.css';
import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://uniqus-research.vercel.app'),
  title: 'Uniqus Research Center - SEC Intelligence Platform',
  description: 'A comprehensive, production-grade SEC compliance and research platform for legal, financial, and compliance professionals.',
  openGraph: {
    title: 'Uniqus Research Center - SEC Intelligence Platform',
    description: 'A comprehensive, production-grade SEC compliance and research platform for legal, financial, and compliance professionals.',
    url: 'https://research.uniqus.com',
    siteName: 'Uniqus Research Center',
    images: [
      {
        url: '/api/og?title=SEC%20Intelligence%20Platform',
        width: 1200,
        height: 630,
        alt: 'Uniqus Research Center',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Uniqus Research Center - SEC Intelligence Platform',
    description: 'A comprehensive, production-grade SEC compliance and research platform for legal, financial, and compliance professionals.',
    images: ['/api/og?title=SEC%20Intelligence%20Platform'],
  },
};

import { AppProvider } from '../context/AppState';
import { Layout } from '../components/layout/Layout';
import { AIQnAPanel } from '../components/AIQnAPanel';
import { PostHogProvider } from '../components/providers/PostHogProvider';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <PostHogProvider>
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        </head>
        <body>
          <div id="root">
            <AppProvider>
              <Layout>
                {children}
              </Layout>
              <AIQnAPanel />
            </AppProvider>
          </div>
        </body>
        </PostHogProvider>
      </html>
    </ClerkProvider>
  );
}
