'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../../components/layout/RouteLoading';

const FilingAICatalog = dynamic(() => import('../../../views/filing-ai/FilingAICatalog'), {
  loading: () => <RouteLoading label="Loading rule catalog" />,
});

export default function Page() {
  return <FilingAICatalog />;
}
