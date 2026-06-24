import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId, fileToDataUrl } from '../../../lib/db';
import { getSessionUserId } from '../../../lib/auth';

export const GET: APIRoute = async ({ cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ status: null }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const user: any = await db.prepare("SELECT verification_status, verified FROM users WHERE id = ?").bind(session).first();
  return new Response(JSON.stringify({ status: user?.verification_status || '', verified: user?.verified === 1 }));
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;

  const user: any = await db.prepare("SELECT verification_status FROM users WHERE id = ?").bind(session).first();
  if (user?.verification_status === 'pending' || user?.verification_status === 'approved') {
    return new Response(JSON.stringify({ error: 'Verification already submitted' }), { status: 409 });
  }

  const formData = await request.formData();
  const idType = formData.get('idType') as string;
  const idNumber = formData.get('idNumber') as string;
  const front = formData.get('front') as File;
  const selfie = formData.get('selfie') as File;
  const back = formData.get('back') as File | null;

  if (!idType || !idNumber || !front || !selfie) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  const frontB64 = await fileToDataUrl(front);
  const selfieB64 = await fileToDataUrl(selfie);
  const backB64 = back ? await fileToDataUrl(back) : '';

  if (!frontB64 || !selfieB64) {
    return new Response(JSON.stringify({ error: 'File upload failed. Max 5MB per file.' }), { status: 400 });
  }

  const id = genId();
  await db.prepare(
    "INSERT INTO reports (id, reporter_id, reporter_name, type, reason, description, status) VALUES (?, ?, ?, 'verification', ?, ?, 'open')"
  ).bind(id, session, idType, `ID: ${idNumber}`, JSON.stringify({ idType, idNumber, front: frontB64, back: backB64, selfie: selfieB64 })).run();

  await db.prepare("UPDATE users SET verification_status = 'pending' WHERE id = ?").bind(session).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
