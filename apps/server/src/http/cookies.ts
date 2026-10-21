/** Lecture / écriture minimales de cookies (sans dépendance). */

export const SESSION_COOKIE = 'ar_session';
export const OAUTH_COOKIE = 'ar_oauth';

export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export interface CookieOptions {
  maxAgeS?: number;
  secure: boolean;
  path?: string;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`, 'HttpOnly', `SameSite=${o.sameSite ?? 'Lax'}`];
  if (o.maxAgeS !== undefined) parts.push(`Max-Age=${Math.max(0, Math.round(o.maxAgeS))}`);
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}
