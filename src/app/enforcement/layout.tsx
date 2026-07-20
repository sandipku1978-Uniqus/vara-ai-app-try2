import { Metadata } from 'next';
import { ENFORCEMENT_SCOPE_DESCRIPTION, ENFORCEMENT_SCOPE_LABEL } from '../../config/enforcement';

export const metadata: Metadata = {
  title: `${ENFORCEMENT_SCOPE_LABEL} - Uniqus Research Center`,
  description: ENFORCEMENT_SCOPE_DESCRIPTION,
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
