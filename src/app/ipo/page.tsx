'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const IPOCenter = dynamic(() => import('../../views/IPOCenter'), {
  loading: () => <RouteLoading label="Loading IPO Center" />,
});

export default function Page() {
  return <IPOCenter />;
}
