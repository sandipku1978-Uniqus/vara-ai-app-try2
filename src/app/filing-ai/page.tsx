'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const FilingAIConsole = dynamic(() => import('../../views/filing-ai/FilingAIConsole'), {
  loading: () => <RouteLoading label="Loading Filing AI" />,
});

export default function Page() {
  return <FilingAIConsole />;
}
