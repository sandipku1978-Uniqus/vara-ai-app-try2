'use client';

import dynamic from 'next/dynamic';
import RouteLoading from '../../components/layout/RouteLoading';

const ProjectsIndex = dynamic(() => import('../../views/ProjectsIndex'), {
  loading: () => <RouteLoading label="Loading projects" />,
});

export default function Page() {
  return <ProjectsIndex />;
}
