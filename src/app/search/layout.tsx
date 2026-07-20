import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Research Workbench - Uniqus Research Center',
  description: 'Search SEC filings with deterministic query modes, filters, source links, and evidence-aware analysis.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
