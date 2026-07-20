'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const SecRegulation = dynamic(() => import('../../views/SecRegulation'), {
  loading: () => <RouteLoading label="Loading securities regulation" />,
});

export default function Page() {
  return <SecRegulation />;
}
