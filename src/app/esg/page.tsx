'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const ESGResearch = dynamic(() => import('../../views/ESGResearch'), {
  loading: () => <RouteLoading label="Loading ESG research" />,
});

export default function Page() {
  return <ESGResearch />;
}
