'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const CommentLetters = dynamic(() => import('../../views/CommentLetters'), {
  loading: () => <RouteLoading label="Loading comment letters" />,
});

export default function Page() {
  return <CommentLetters />;
}
