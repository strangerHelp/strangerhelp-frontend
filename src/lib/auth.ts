import type { AstroCookies } from "astro";
import { env } from "cloudflare:workers";
import { verifySessionWithMeta } from "./session";
import { SESSION_COOKIE } from "./cookies";

const USER_FIELDS =
  "id, name, email, handle, avatar, city, area, country, phone, bio, skills, is_admin, banned, verified, email_verified, token_valid_from";

/**
 * Resolve the current user from the session cookie.
 *
 * This is the single chokepoint for authentication, so it enforces:
 *  - a valid, unexpired HMAC signature (verifySessionWithMeta)
 *  - the user still exists
 *  - the user is not banned  (previously only checked on page routes, which
 *    let banned users keep using every /api/* endpoint)
 *  - the token was issued after the last credential change, giving us
 *    session revocation on password reset
 *
 * Returns null for any failure so callers can treat it as "unauthenticated".
 */
export async function getUser(cookies: AstroCookies) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const meta = await verifySessionWithMeta(token);
  if (!meta) return null;

  try {
    const db = (env as any).DB as D1Database;
    const user: any = await db
      .prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`)
      .bind(meta.userId)
      .first();

    if (!user) return null;
    if (user.banned) return null;

    // Reject tokens minted before the last password reset / forced logout.
    const validFrom = Number(user.token_valid_from || 0);
    if (validFrom && meta.issuedAt < validFrom) return null;

    return user;
  } catch {
    return null;
  }
}

/**
 * Returns the authenticated, non-banned user's id, or null.
 * Every API route uses this, so the ban and revocation checks above apply
 * across the whole API surface.
 */
export async function getSessionUserId(cookies: AstroCookies): Promise<string | null> {
  const user = await getUser(cookies);
  return user ? (user.id as string) : null;
}
