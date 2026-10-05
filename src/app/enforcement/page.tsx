'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';
import { ENFORCEMENT_ROUTE_LOADING_LABEL } from '../../config/enforcement';

const SECEnforcement = dynamic(() => import('../../views/SECEnforcement'), {
  loading: () => <RouteLoading label={ENFORCEMENT_ROUTE_LOADING_LABEL} />,
});

export default function Page() {
  return <SECEnforcement />;
}
