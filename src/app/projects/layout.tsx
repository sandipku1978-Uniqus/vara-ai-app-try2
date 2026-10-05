import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Projects - Uniqus Research Center',
  description: 'Research projects: saved searches, alerts, peer sets, memo, annotations and research tabs filed under one question.',
};

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
