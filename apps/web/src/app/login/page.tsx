import { fetchQuery } from 'convex/nextjs';
import { redirect } from 'next/navigation';

import { loginAdminAction, setupAdminAction } from '@/app/login/actions';
import { readAdminSession } from '@/lib/auth/session';
import { api } from '@convex/_generated/api';

export const dynamic = 'force-dynamic';

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    mode?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await readAdminSession();
  if (session) {
    redirect('/');
  }

  const params = await searchParams;
  const bootstrap = await fetchQuery(api.auth.bootstrapStatus, {});
  const setupMode = !bootstrap.hasCredentials || params.mode === 'setup';
  const errorMessage = params.error ? decodeURIComponent(params.error) : null;

  return (
    <main className="state-screen auth-screen">
      <section className="state-card auth-card">
        <div className="auth-copy">
          <p className="eyebrow">{setupMode ? 'Bootstrap access' : 'Admin access'}</p>
          <h1>{setupMode ? 'Create the first admin' : 'Sign in to Yokai'}</h1>
          <p className="state-copy">
            {setupMode
              ? 'Admin credentials are stored in Convex and passwords are saved as salted hashes.'
              : 'The control room is now protected. Only an authenticated admin session can open the dashboard or its API routes.'}
          </p>
        </div>

        {errorMessage ? <div className="notice-banner auth-notice">{errorMessage}</div> : null}

        <form action={setupMode ? setupAdminAction : loginAdminAction} className="auth-form">
          <label className="field">
            <span>Login</span>
            <input autoCapitalize="none" autoComplete="username" name="login" required />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              autoComplete={setupMode ? 'new-password' : 'current-password'}
              name="password"
              required
              type="password"
            />
          </label>

          {setupMode ? (
            <label className="field">
              <span>Confirm password</span>
              <input autoComplete="new-password" name="confirmPassword" required type="password" />
            </label>
          ) : null}

          <button className="primary-button" type="submit">
            {setupMode ? 'Create admin and enter dashboard' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
