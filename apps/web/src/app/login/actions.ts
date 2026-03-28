'use server';

import { fetchMutation } from 'convex/nextjs';
import { redirect } from 'next/navigation';

import {
  clearAdminSessionCookie,
  persistAdminSessionCookie,
  readSessionCookie,
} from '@/lib/auth/session';
import { api } from '@convex/_generated/api';

function getField(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function toLoginRedirect(error: string, mode: 'login' | 'setup') {
  return `/login?mode=${mode}&error=${encodeURIComponent(error)}`;
}

export async function setupAdminAction(formData: FormData) {
  const login = getField(formData, 'login');
  const password = getField(formData, 'password');
  const confirmPassword = getField(formData, 'confirmPassword');

  if (!login || !password) {
    redirect(toLoginRedirect('Login and password are required.', 'setup'));
  }

  if (password !== confirmPassword) {
    redirect(toLoginRedirect('Passwords must match.', 'setup'));
  }

  const session = await fetchMutation(api.auth.setupAdmin, { login, password }).catch((error) =>
    redirect(
      toLoginRedirect(error instanceof Error ? error.message : 'Failed to create admin.', 'setup'),
    ),
  );

  await persistAdminSessionCookie({
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
  });

  redirect('/');
}

export async function loginAdminAction(formData: FormData) {
  const login = getField(formData, 'login');
  const password = getField(formData, 'password');

  if (!login || !password) {
    redirect(toLoginRedirect('Login and password are required.', 'login'));
  }

  const session = await fetchMutation(api.auth.login, { login, password }).catch((error) =>
    redirect(
      toLoginRedirect(error instanceof Error ? error.message : 'Failed to sign in.', 'login'),
    ),
  );

  await persistAdminSessionCookie({
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
  });

  redirect('/');
}

export async function logoutAdminAction() {
  const sessionCookie = await readSessionCookie();

  if (sessionCookie) {
    try {
      await fetchMutation(api.auth.logout, {
        sessionId: sessionCookie.sessionId,
      });
    } catch {}
  }

  await clearAdminSessionCookie();
  redirect('/login');
}
