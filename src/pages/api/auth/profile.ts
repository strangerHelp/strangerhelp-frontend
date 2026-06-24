import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { fileToDataUrl } from '../../../lib/db';
import { getSessionUserId } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const formData = await request.formData();

  const name = formData.get('name') as string;
  const city = formData.get('city') as string;
  const area = formData.get('area') as string;
  const country = formData.get('country') as string;
  const phone = formData.get('phone') as string;
  const bio = formData.get('bio') as string;
  const file = formData.get('avatar') as File | null;

  let avatar = '';
  if (file && file.size > 0) {
    avatar = await fileToDataUrl(file);
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (name) { updates.push("name = ?"); values.push(name); }
  if (city) { updates.push("city = ?"); values.push(city); }
  if (area !== undefined) { updates.push("area = ?"); values.push(area); }
  if (country) { updates.push("country = ?"); values.push(country); }
  if (phone) { updates.push("phone = ?"); values.push(phone); }
  if (bio !== undefined) { updates.push("bio = ?"); values.push(bio); }
  if (avatar) { updates.push("avatar = ?"); values.push(avatar); }

  if (updates.length > 0) {
    values.push(session);
    await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  }

  return new Response(JSON.stringify({ ok: true }));
};
