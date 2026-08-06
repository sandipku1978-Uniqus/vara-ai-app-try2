'use client';

import dynamic from 'next/dynamic';
import { use } from 'react';
import RouteLoading from '../../../../components/layout/RouteLoading';

const FilingAIRunReport = dynamic(() => import('../../../../views/filing-ai/FilingAIRunReport'), {
  loading: () => <RouteLoading label="Loading exception report" />,
});

export default function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  return <FilingAIRunReport runId={runId} />;
}
