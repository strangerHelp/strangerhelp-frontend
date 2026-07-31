import type { AstroCookies } from 'astro';

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/**
 * Resolve the cookie domain for the current host.
 *
 * A cookie set with `domain` MUST be deleted with the same `domain`, otherwise
 * the browser keeps it. Centralising this is what keeps logout working.
 *
 * Returns undefined for localhost / *.workers.dev so the cookie becomes
 * host-only and still works outside production.
 */
export function cookieDomain(url: URL): string | undefined {
  const host = url.hostname;
  if (host === 'strangerhelp.com' || host.endsWith('.strangerhelp.com')) {
    return '.strangerhelp.com';
  }
  // localhost, 127.0.0.1, *.workers.dev, preview URLs -> host-only cookie
  return undefined;
}

function baseOptions(url: URL) {
  return {
    httpOnly: true,
    // Secure breaks plain-http localhost, so only force it off there.
    secure: url.protocol === 'https:',
    path: '/',
    sameSite: 'lax' as const,
    domain: cookieDomain(url),
  };
}

export function setSessionCookie(cookies: AstroCookies, url: URL, token: string) {
  cookies.set(SESSION_COOKIE, token, {
    ...baseOptions(url),
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * Delete the session cookie using the same attributes it was set with.
 *
 * Only ONE delete call is made on purpose. Astro stores outgoing cookies in a
 * map keyed by cookie name, so a second delete for the same name replaces the
 * first and only the last one is sent. An extra host-only delete here would
 * therefore emit `Set-Cookie: session=deleted; Path=/` with no Domain, which
 * cannot clear the domain-scoped production cookie - leaving logout broken.
 */
export function clearSessionCookie(cookies: AstroCookies, url: URL) {
  const opts = baseOptions(url);
  cookies.delete(SESSION_COOKIE, { path: opts.path, domain: opts.domain });
}
