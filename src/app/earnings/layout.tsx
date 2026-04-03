import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '8-K Event Filings - Uniqus Research Center',
  description: 'Track material events, earnings releases, and corporate announcements via SEC 8-K filings.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
