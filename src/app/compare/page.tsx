'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const Benchmarking = dynamic(() => import('../../views/Benchmarking'), {
  loading: () => <RouteLoading label="Loading benchmarking workspace" />,
});

export default function Page() {
  return <Benchmarking />;
}
