import type { AstroCookies } from 'astro';
import { env } from 'cloudflare:workers';
import { getSessionUserId } from './auth';

export async function isAdmin(cookies: AstroCookies): Promise<boolean> {
  const userId = await getSessionUserId(cookies);
  if (!userId) return false;
  try {
    const db = (env as any).DB as D1Database;
    const user: any = await db.prepare("SELECT is_admin FROM users WHERE id = ? AND banned = 0").bind(userId).first();
    return user?.is_admin === 1;
  } catch {
    return false;
  }
}
