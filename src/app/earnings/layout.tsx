import { Metadata } from 'next';
import { EARNINGS_SCOPE_DESCRIPTION, EARNINGS_SCOPE_LABEL } from '../../config/earnings';

export const metadata: Metadata = {
  title: `${EARNINGS_SCOPE_LABEL} - Uniqus Research Center`,
  description: EARNINGS_SCOPE_DESCRIPTION,
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
