'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const ExemptOfferings = dynamic(() => import('../../views/ExemptOfferings'), {
  loading: () => <RouteLoading label="Loading exempt offerings" />,
});

export default function Page() {
  return <ExemptOfferings />;
}
