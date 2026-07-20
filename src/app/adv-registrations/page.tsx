'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const ADVRegistrations = dynamic(() => import('../../views/ADVRegistrations'), {
  loading: () => <RouteLoading label="Loading ADV registrations" />,
});

export default function Page() {
  return <ADVRegistrations />;
}
