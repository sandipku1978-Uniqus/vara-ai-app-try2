'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const AccountingAnalytics = dynamic(() => import('../../views/AccountingAnalytics'), {
  loading: () => <RouteLoading label="Loading accounting analytics" />,
});

export default function Page() {
  return <AccountingAnalytics />;
}
