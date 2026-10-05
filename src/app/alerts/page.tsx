'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const AlertsDigest = dynamic(() => import('../../views/AlertsDigest'), {
  loading: () => <RouteLoading label="Loading alert digest" />,
});

export default function Page() {
  return <AlertsDigest />;
}
