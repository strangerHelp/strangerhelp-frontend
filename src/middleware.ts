import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { verifySession } from "./lib/session";

const PROTECTED_ROUTES = ["/dashboard", "/tasks/my-tasks", "/tasks/new", "/chat", "/karma"];
const AUTH_ROUTES = ["/login", "/register"];

export const onRequest = defineMiddleware(async ({ cookies, url, redirect }, next) => {
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
        cookies.delete("session", { path: "/" });
        return redirect("/banned");
      }
    } catch {}
  }

  return next();
});
