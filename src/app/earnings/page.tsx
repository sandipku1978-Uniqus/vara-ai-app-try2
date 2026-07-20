'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const EarningsTranscripts = dynamic(() => import('../../views/EarningsTranscripts'), {
  loading: () => <RouteLoading label="Loading earnings-release exhibits" />,
});

export default function Page() {
  return <EarningsTranscripts />;
}
