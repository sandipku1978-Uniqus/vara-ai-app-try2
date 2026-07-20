'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const Dashboard = dynamic(() => import('../../views/Dashboard'), {
  loading: () => <RouteLoading label="Loading dashboard" />,
});

export default function Page() {
  return <Dashboard />;
}
