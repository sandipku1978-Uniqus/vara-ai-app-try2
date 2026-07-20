'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const BoardProfiles = dynamic(() => import('../../views/BoardProfiles'), {
  loading: () => <RouteLoading label="Loading board profiles" />,
});

export default function Page() {
  return <BoardProfiles />;
}
