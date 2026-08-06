'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../../components/layout/RouteLoading';

const FilingAIGovernance = dynamic(() => import('../../../views/filing-ai/FilingAIGovernance'), {
  loading: () => <RouteLoading label="Loading engagements" />,
});

export default function Page() {
  return <FilingAIGovernance />;
}
