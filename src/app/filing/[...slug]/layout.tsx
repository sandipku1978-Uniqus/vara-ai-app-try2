import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Filing Detail - Uniqus Research Center',
  description: 'Review an SEC filing, its metadata, tables, annotations, and evidence-linked comparisons.',
};

export default function FilingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
