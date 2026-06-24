import type { APIRoute } from 'astro';
import bcrypt from 'bcryptjs';

export const GET: APIRoute = async () => {
  try {
    const mod = await import('cloudflare:workers');
    const db = (mod.env as any).DB;
    
    // Test bcrypt
    const hash = await bcrypt.hash("test123", 10);
    const valid = await bcrypt.compare("test123", hash);
    
    // Test user lookup
    const user = await db.prepare("SELECT id, name, email FROM users WHERE email = ?").bind("admin@strangerhelp.com").first();
    
    return new Response(JSON.stringify({ ok: true, bcryptWorks: valid, user: user ? { id: user.id, name: user.name } : null }));
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack?.slice(0, 300) }), { status: 500 });
  }
};
