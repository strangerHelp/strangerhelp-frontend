import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { verifySession } from "./lib/session";
import { clearSessionCookie } from "./lib/cookies";

const PROTECTED_ROUTES = ["/dashboard", "/tasks/my-tasks", "/tasks/new", "/chat", "/karma", "/referral", "/admin"];
const AUTH_ROUTES = ["/login", "/register"];

// Cache durations in seconds
const CACHE_RULES: [string, number][] = [
  ["/api/tasks", 30],
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
      // Never serve or populate the shared edge cache for a signed-in request:
      // /api/tasks varies by session, so a cached copy could otherwise be
      // handed to a different user.
      if (!isPersonalized && !userId) {
        const cache = caches.default;
        const cacheKey = new Request(url.toString(), { method: "GET" });
        const cached = await cache.match(cacheKey);
        if (cached) return cached;

        const response = await next();
        const res = new Response(response.body, response);
        res.headers.set("Cache-Control", `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`);
        // Don't cache error responses
        if (res.status === 200) {
          cache.put(cacheKey, res.clone());
        }
        return res;
      }
    }
  }

  return next();
});
