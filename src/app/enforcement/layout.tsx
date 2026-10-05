import { Metadata } from 'next';
import { ENFORCEMENT_ROUTE_DESCRIPTION, ENFORCEMENT_ROUTE_LABEL } from '../../config/enforcement';

export const metadata: Metadata = {
  title: `${ENFORCEMENT_ROUTE_LABEL} - Uniqus Research Center`,
  description: ENFORCEMENT_ROUTE_DESCRIPTION,
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
