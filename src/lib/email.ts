import { env } from 'cloudflare:workers';
import { genId } from './db';

const BASE_URL = 'https://strangerhelp.com';

/** Generate a secure token */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Create a token in DB and return it */
export async function createEmailToken(db: D1Database, userId: string, email: string, type: 'reset' | 'verify'): Promise<string> {
  const token = generateToken();
  const id = genId();
  // Expires in 1 hour for reset, 24 hours for verify
  const hours = type === 'reset' ? 1 : 24;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  // Invalidate old tokens of same type for this user
  await db.prepare("UPDATE email_tokens SET used = 1 WHERE user_id = ? AND type = ? AND used = 0").bind(userId, type).run();

  await db.prepare("INSERT INTO email_tokens (id, user_id, email, type, token, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, userId, email, type, token, expiresAt).run();

  return token;
}

/** Verify a token is valid */
export async function verifyEmailToken(db: D1Database, token: string, type: 'reset' | 'verify'): Promise<{ userId: string; email: string } | null> {
  const row: any = await db.prepare("SELECT user_id, email, expires_at, used FROM email_tokens WHERE token = ? AND type = ?")
    .bind(token, type).first();

  if (!row || row.used) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  // Mark as used
  await db.prepare("UPDATE email_tokens SET used = 1 WHERE token = ?").bind(token).run();

  return { userId: row.user_id, email: row.email };
}

/** Send email — PLACEHOLDER: Replace with real email service (Cloudflare Email, Resend, etc.) */
export async function sendEmail(to: string, subject: string, html: string) {
  // TODO: Replace with your no-reply@strangerhelp.com email service
  // Options:
  // 1. Cloudflare Email Routing + Workers Email Send
  // 2. Resend API: await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer YOUR_KEY', 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'no-reply@strangerhelp.com', to, subject, html }) })
  // 3. SMTP via MailChannels (free for Cloudflare Workers)

  console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
  console.log(`[EMAIL] Body: ${html.slice(0, 200)}...`);

  // For now, log to Workers logs (visible via wrangler tail)
  return true;
}

/** Send password reset email */
export async function sendResetEmail(db: D1Database, userId: string, email: string) {
  const token = await createEmailToken(db, userId, email, 'reset');
  const link = `${BASE_URL}/reset-password?token=${token}`;

  await sendEmail(email, 'Reset Your Password — StrangerHelp', `
    <div style="font-family:system-ui;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#171717;margin-bottom:16px;">Reset Your Password</h2>
      <p style="color:#4d4d4d;line-height:1.6;">You requested a password reset. Click the button below to set a new password:</p>
      <a href="${link}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#171717;color:#fff;border-radius:24px;text-decoration:none;font-weight:600;">Reset Password</a>
      <p style="color:#888;font-size:13px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      <hr style="border:none;border-top:1px solid #ebebeb;margin:24px 0;">
      <p style="color:#888;font-size:12px;">StrangerHelp — strangerhelp.com</p>
    </div>
  `);
}

/** Send email verification */
export async function sendVerificationEmail(db: D1Database, userId: string, email: string) {
  const token = await createEmailToken(db, userId, email, 'verify');
  const link = `${BASE_URL}/verify-email?token=${token}`;

  await sendEmail(email, 'Verify Your Email — StrangerHelp', `
    <div style="font-family:system-ui;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#171717;margin-bottom:16px;">Verify Your Email</h2>
      <p style="color:#4d4d4d;line-height:1.6;">Thanks for signing up! Please verify your email address:</p>
      <a href="${link}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#171717;color:#fff;border-radius:24px;text-decoration:none;font-weight:600;">Verify Email</a>
      <p style="color:#888;font-size:13px;">This link expires in 24 hours.</p>
      <hr style="border:none;border-top:1px solid #ebebeb;margin:24px 0;">
      <p style="color:#888;font-size:12px;">StrangerHelp — strangerhelp.com</p>
    </div>
  `);
}
