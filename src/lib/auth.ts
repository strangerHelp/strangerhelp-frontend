import type { AstroCookies } from "astro";
import { env } from "cloudflare:workers";
import { verifySession } from "./session";

export async function getSessionUserId(cookies: AstroCookies): Promise<string | null> {
  const token = cookies.get("session")?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function getUser(cookies: AstroCookies) {
  const userId = await getSessionUserId(cookies);
  if (!userId) return null;
  try {
    const db = (env as any).DB as D1Database;
    const user: any = await db.prepare("SELECT id, name, email, handle, avatar, city, area, country, phone, bio, is_admin, banned, verified, email_verified FROM users WHERE id = ?").bind(userId).first();
    if (user?.banned) return null;
    return user;
  } catch {
    return null;
  }
}
