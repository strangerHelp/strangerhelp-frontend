import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/auth';

export const GET: APIRoute = async ({ cookies }) => {
  const user: any = await getUser(cookies);
  if (!user) {
    return new Response(JSON.stringify({ user: null }), { status: 401 });
  }
  return new Response(JSON.stringify({ user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, city: user.city, area: user.area, country: user.country, phone: user.phone, bio: user.bio, is_admin: user.is_admin } }));
};
