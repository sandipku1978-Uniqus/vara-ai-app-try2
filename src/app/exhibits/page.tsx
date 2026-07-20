'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const ExhibitSearch = dynamic(() => import('../../views/ExhibitSearch'), {
  loading: () => <RouteLoading label="Loading exhibits and agreements" />,
});

export default function Page() {
  return <ExhibitSearch />;
}
