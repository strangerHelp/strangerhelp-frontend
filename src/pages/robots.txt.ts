import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  const body = `User-agent: *
Allow: /
Disallow: /dashboard/
Disallow: /admin/
Disallow: /chat/
Disallow: /api/
Disallow: /tasks/my-tasks
Disallow: /banned

Sitemap: https://strangerhelp.com/sitemap.xml
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
};
