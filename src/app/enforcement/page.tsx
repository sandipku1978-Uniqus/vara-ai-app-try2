'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const SECEnforcement = dynamic(() => import('../../views/SECEnforcement'), {
  loading: () => <RouteLoading label="Loading SEC litigation releases" />,
});

export default function Page() {
  return <SECEnforcement />;
}
