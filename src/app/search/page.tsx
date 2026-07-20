'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const SearchPage = dynamic(() => import('../../views/SearchPage'), {
  loading: () => <RouteLoading label="Loading Research Workbench" />,
});

export default function Page() {
  return <SearchPage />;
}
