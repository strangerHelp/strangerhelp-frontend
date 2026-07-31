import type { APIRoute } from 'astro';
import { clearSessionCookie } from '../../../lib/cookies';

export const POST: APIRoute = async ({ cookies, redirect, url }) => {
  // The cookie is set with domain=.strangerhelp.com in production. Deleting it
  // without that same domain left the session cookie in place, so logout did
  // not actually log anyone out. clearSessionCookie matches the attributes.
  clearSessionCookie(cookies, url);
  return redirect('/');
};
