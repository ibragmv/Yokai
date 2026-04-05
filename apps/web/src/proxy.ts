import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE_NAME = 'yokai_admin_session';
const SANDBOX_ROLLOVER_PATH = '/api/internal/sandbox-rollover';

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === SANDBOX_ROLLOVER_PATH) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (sessionCookie) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Unauthorized',
      },
      { status: 401 },
    );
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|icon.svg|login).*)'],
};
