'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const NoActionLetters = dynamic(() => import('../../views/NoActionLetters'), {
  loading: () => <RouteLoading label="Loading no-action letters" />,
});

export default function Page() {
  return <NoActionLetters />;
}
