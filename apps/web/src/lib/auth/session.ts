import 'server-only';

import { fetchMutation } from 'convex/nextjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';

const SESSION_COOKIE_NAME = 'yokai_admin_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

type SessionCookiePayload = {
  sessionId: Id<'sessions'>;
  sessionToken: string;
};

export type AdminSession = {
  credentialId: Id<'credentials'>;
  login: string;
  expiresAt: number;
  sessionId: Id<'sessions'>;
};

function encodeCookieValue(payload: SessionCookiePayload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCookieValue(value: string): SessionCookiePayload | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as SessionCookiePayload | null;

    if (!decoded?.sessionId || !decoded.sessionToken) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

export async function persistAdminSessionCookie(session: SessionCookiePayload) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, encodeCookieValue(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearAdminSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function readSessionCookie() {
  const cookieStore = await cookies();
  const rawValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!rawValue) {
    return null;
  }

  return decodeCookieValue(rawValue);
}

export async function readAdminSession(): Promise<AdminSession | null> {
  const sessionCookie = await readSessionCookie();
  if (!sessionCookie) {
    return null;
  }

  const session = await fetchMutation(api.auth.validateSession, {
    sessionId: sessionCookie.sessionId,
    sessionToken: sessionCookie.sessionToken,
  });

  if (!session) {
    return null;
  }

  return {
    ...session,
    sessionId: sessionCookie.sessionId,
  };
}

export async function requireAdminSession() {
  const session = await readAdminSession();

  if (!session) {
    redirect('/login');
  }

  return session;
}
