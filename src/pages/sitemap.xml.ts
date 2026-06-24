import type { APIRoute } from 'astro';

const SITE = 'https://strangerhelp.com';

const staticPages = [
  { url: '/', priority: '1.0', changefreq: 'daily' },
  { url: '/tasks', priority: '0.9', changefreq: 'hourly' },
  { url: '/ask', priority: '0.8', changefreq: 'hourly' },
  { url: '/pulse', priority: '0.7', changefreq: 'always' },
  { url: '/how-it-works', priority: '0.7', changefreq: 'monthly' },
  { url: '/about', priority: '0.5', changefreq: 'monthly' },
  { url: '/register', priority: '0.6', changefreq: 'monthly' },
  { url: '/login', priority: '0.5', changefreq: 'monthly' },
  { url: '/report', priority: '0.4', changefreq: 'monthly' },
  { url: '/privacy', priority: '0.3', changefreq: 'yearly' },
  { url: '/terms', priority: '0.3', changefreq: 'yearly' },
  { url: '/refund', priority: '0.3', changefreq: 'yearly' },
  { url: '/trust-safety', priority: '0.5', changefreq: 'monthly' },
  { url: '/leaderboard', priority: '0.5', changefreq: 'daily' },
  { url: '/emergency', priority: '0.6', changefreq: 'monthly' },
];

const cities = ['delhi', 'mumbai', 'bangalore', 'chennai', 'hyderabad', 'pune', 'kolkata', 'ahmedabad'];
const categories = ['document-submission', 'photo-proof', 'parcel-pickup', 'queue-standing', 'simple-survey', 'receipt-collection', 'verification', 'other'];

export const GET: APIRoute = async () => {
  const today = new Date().toISOString().split('T')[0];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

  for (const page of staticPages) {
    xml += `
  <url>
    <loc>${SITE}${page.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`;
  }

  for (const city of cities) {
    xml += `
  <url>
    <loc>${SITE}/city/${city}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
  }

  for (const cat of categories) {
    xml += `
  <url>
    <loc>${SITE}/category/${cat}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
  }

  xml += `\n</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml' },
  });
};
