import type { MetadataRoute } from 'next';
import { PRODUCT_ROUTES, PUBLIC_PAGE_PATHS } from '../config/routes';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://uniqus-research.vercel.app';

export default function robots(): MetadataRoute.Robots {
  const publicPages = new Set<string>(PUBLIC_PAGE_PATHS);
  const protectedPages = PRODUCT_ROUTES
    .map(route => route.path)
    .filter(path => !publicPages.has(path));

  return {
    rules: {
      userAgent: '*',
      allow: [...PUBLIC_PAGE_PATHS],
      disallow: ['/api/', '/company/', '/filing/', ...protectedPages],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
