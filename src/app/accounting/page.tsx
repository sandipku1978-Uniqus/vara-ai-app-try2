'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const AccountingHub = dynamic(() => import('../../views/AccountingHub'), {
  loading: () => <RouteLoading label="Loading accounting standards" />,
});

export default function Page() {
  return <AccountingHub />;
}
