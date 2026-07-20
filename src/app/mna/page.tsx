'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const MAResearch = dynamic(() => import('../../views/MAResearch'), {
  loading: () => <RouteLoading label="Loading M&A research" />,
});

export default function Page() {
  return <MAResearch />;
}
