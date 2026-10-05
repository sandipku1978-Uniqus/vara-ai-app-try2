'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';
import RouteLoading from '../../../components/layout/RouteLoading';

const ProjectsWorkspace = dynamic(() => import('../../../views/ProjectsWorkspace'), {
  loading: () => <RouteLoading label="Loading project" />,
});

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProjectsWorkspace projectId={id} />;
}
