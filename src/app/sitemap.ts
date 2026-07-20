import type { MetadataRoute } from 'next';
import { PUBLIC_PAGE_PATHS } from '../config/routes';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://uniqus-research.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PUBLIC_PAGE_PATHS.map(path => ({
    url: path === '/' ? siteUrl : `${siteUrl}${path}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: path === '/' ? 1 : 0.6,
  }));
}
