import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Uniqus Research Center',
    short_name: 'Uniqus Research',
    description: 'SEC filing research, comparison, and monitoring workspaces.',
    // A signed-out install must land somewhere useful; the app shell redirects
    // signed-in users onward (readiness finding F-11).
    start_url: '/',
    display: 'standalone',
    background_color: '#FBF6F9',
    theme_color: '#B31F7E',
  };
}
