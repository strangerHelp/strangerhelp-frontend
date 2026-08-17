import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { verifySession } from "./lib/session";
import { clearSessionCookie } from "./lib/cookies";

const PROTECTED_ROUTES = ["/dashboard", "/tasks/my-tasks", "/tasks/new", "/chat", "/karma", "/referral", "/admin"];
const AUTH_ROUTES = ["/login", "/register"];

// Cache durations in seconds.
//
// /api/tasks is deliberately NOT cached. It now varies by search term, sort,
// six filters, pagination offset and the caller's lat/lng, so the shared edge
// cache would fragment into near-unique keys (almost never hitting), would hold
// a copy keyed by user coordinates, and would keep serving a stale feed for up
// to 90s after someone posts a task. The underlying queries are indexed.
const CACHE_RULES: [string, number][] = [
  ["/api/questions", 60],
  ["/api/pulse", 5],
  ["/blog", 3600],
  ["/how-it-works", 3600],
  ["/about", 3600],
  ["/terms", 3600],
  ["/privacy", 3600],
  ["/help", 3600],
];

// Routes that should NEVER be cached
const NO_CACHE = ["/api/auth", "/api/messages", "/api/notifications", "/api/reports", "/api/admin", "/dashboard", "/chat", "/admin"];

export const onRequest = defineMiddleware(async ({ cookies, url, redirect, request }, next) => {
  const token = cookies.get("session")?.value;
  const userId = token ? await verifySession(token) : null;
  const isProtected = PROTECTED_ROUTES.some((route) => url.pathname.startsWith(route));
  const isAuthPage = AUTH_ROUTES.includes(url.pathname);

  if (userId && isAuthPage) {
    return redirect("/dashboard");
  }

  if (isProtected && !userId) {
    return redirect(`/login?redirect=${encodeURIComponent(url.pathname)}`);
  }

  if (userId && isProtected) {
    try {
      const db = (env as any).DB as D1Database;
      const user: any = await db.prepare("SELECT banned FROM users WHERE id = ?").bind(userId).first();
      if (user?.banned) {
        clearSessionCookie(cookies, url);
        return redirect("/banned");
      }
    } catch {}
  }

  // Only cache GET requests for public data.
  if (request.method === "GET" && !NO_CACHE.some(p => url.pathname.startsWith(p))) {
    const cacheDuration = CACHE_RULES.find(([path]) => url.pathname.startsWith(path))?.[1];
    if (cacheDuration) {
      const isPersonalized = url.searchParams.get('mine') === 'true';
      if (!isPersonalized && !userId) {
        const cache = caches.default;
        const cacheKey = new Request(url.toString(), { method: "GET" });
        const cached = await cache.match(cacheKey);
        if (cached) return cached;

        const response = await next();
        const res = new Response(response.body, response);
        res.headers.set("Cache-Control", `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`);
        if (res.status === 200) {
          cache.put(cacheKey, res.clone());
        }
        return addSecurityHeaders(res);
      }
    }
  }

  const response = await next();
  return addSecurityHeaders(response);
});

/** Append security response headers to every response. */
function addSecurityHeaders(response: Response): Response {
  const res = new Response(response.body, response);
  // HSTS: enforce HTTPS for 6 months, include subdomains
  res.headers.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  // Prevent clickjacking
  res.headers.set("X-Frame-Options", "DENY");
  // Prevent MIME-sniffing
  res.headers.set("X-Content-Type-Options", "nosniff");
  // Limit referrer leakage
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Restrict browser features
  res.headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self), payment=()");
  // CSP: allow own scripts + Google Translate + Google Analytics + MapLibre + Nominatim
  res.headers.set("Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://translate.google.com https://translate.googleapis.com https://www.googletagmanager.com https://www.google-analytics.com https://unpkg.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://translate.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: blob: https://*.openstreetmap.org https://tiles.openfreemap.org https://translate.google.com https://www.google-analytics.com; " +
    "connect-src 'self' https://nominatim.openstreetmap.org https://tiles.openfreemap.org https://api.brevo.com https://www.google-analytics.com https://translate.googleapis.com; " +
    "frame-src https://translate.google.com; " +
    "frame-ancestors 'none';"
  );
  return res;
}
