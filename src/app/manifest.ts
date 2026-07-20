import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Uniqus Research Center',
    short_name: 'Uniqus Research',
    description: 'SEC filing research, comparison, and monitoring workspaces.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#FBF6F9',
    theme_color: '#B31F7E',
  };
}
