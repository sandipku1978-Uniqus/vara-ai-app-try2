'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const InsiderTrading = dynamic(() => import('../../views/InsiderTrading'), {
  loading: () => <RouteLoading label="Loading insider trading" />,
});

export default function Page() {
  return <InsiderTrading />;
}
