'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../../components/layout/RouteLoading';

const FilingDetail = dynamic(() => import('../../../views/FilingDetail'), {
  loading: () => <RouteLoading label="Loading filing detail" />,
});

export default function Page() {
  return <FilingDetail />;
}
