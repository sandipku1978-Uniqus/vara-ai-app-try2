import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Exempt Offerings - Uniqus Research Center',
  description: 'Search SEC Form D and D/A exempt offering notices.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
