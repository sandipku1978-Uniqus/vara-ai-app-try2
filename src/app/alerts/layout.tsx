import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Alert digest - Uniqus Research Center',
  description: 'Hits your saved alerts found on the server in the last day or week, with the matched passages and a Word export.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
