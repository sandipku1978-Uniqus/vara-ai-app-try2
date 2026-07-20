'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const SupportCenter = dynamic(() => import('../../views/SupportCenter'), {
  loading: () => <RouteLoading label="Loading Support Center" />,
});

export default function Page() {
  return <SupportCenter />;
}
