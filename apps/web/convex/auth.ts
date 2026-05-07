import { ConvexError, v } from 'convex/values';

import { mutation, query } from './_generated/server';
import {
  authResultValidator,
  bootstrapStatusValidator,
  validatedSessionValidator,
} from './validators';

const PASSWORD_ITERATIONS = 120_000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const PRIMARY_CREDENTIAL_KEY = 'primary';

function normalizeLogin(login: string) {
  return login.trim().toLowerCase();
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Base64Url(value: string) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(hashBuffer));
}

async function hashPassword(password: string, salt: string) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PASSWORD_ITERATIONS,
      salt: new TextEncoder().encode(salt),
    },
    keyMaterial,
    256,
  );

  return bytesToBase64Url(new Uint8Array(derivedBits));
}

function createRandomSecret(byteLength: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64Url(bytes);
}

function assertCredentialInput(login: string, password: string) {
  if (login.length < 3) {
    throw new ConvexError({
      code: 'INVALID_LOGIN',
      message: 'Login must be at least 3 characters long.',
    });
  }

  if (password.length < 10) {
    throw new ConvexError({
      code: 'WEAK_PASSWORD',
      message: 'Password must be at least 10 characters long.',
    });
  }
}

export const bootstrapStatus = query({
  args: {},
  returns: bootstrapStatusValidator,
  handler: async (ctx) => {
    const credential = await ctx.db
      .query('credentials')
      .withIndex('by_key', (q) => q.eq('key', PRIMARY_CREDENTIAL_KEY))
      .unique();
    return { hasCredentials: Boolean(credential) };
  },
});

export const setupAdmin = mutation({
  args: {
    login: v.string(),
    password: v.string(),
  },
  returns: authResultValidator,
  handler: async (ctx, args) => {
    const login = normalizeLogin(args.login);
    assertCredentialInput(login, args.password);

    const existingCredential = await ctx.db
      .query('credentials')
      .withIndex('by_key', (q) => q.eq('key', PRIMARY_CREDENTIAL_KEY))
      .unique();
    if (existingCredential) {
      throw new ConvexError({
        code: 'ADMIN_EXISTS',
        message: 'Admin credentials have already been configured.',
      });
    }

    const now = Date.now();
    const passwordSalt = createRandomSecret(16);
    const passwordHash = await hashPassword(args.password, passwordSalt);
    const credentialId = await ctx.db.insert('credentials', {
      key: PRIMARY_CREDENTIAL_KEY,
      login,
      passwordHash,
      passwordSalt,
      createdAt: now,
      updatedAt: now,
    });

    const sessionToken = createRandomSecret(32);
    const tokenHash = await sha256Base64Url(sessionToken);
    const sessionId = await ctx.db.insert('sessions', {
      credentialId,
      tokenHash,
      expiresAt: now + SESSION_TTL_MS,
      createdAt: now,
    });

    return {
      sessionId,
      sessionToken,
    };
  },
});

export const login = mutation({
  args: {
    login: v.string(),
    password: v.string(),
  },
  returns: authResultValidator,
  handler: async (ctx, args) => {
    const login = normalizeLogin(args.login);
    const credential = await ctx.db
      .query('credentials')
      .withIndex('by_login', (q) => q.eq('login', login))
      .unique();

    if (!credential) {
      throw new ConvexError({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid login or password.',
      });
    }

    const passwordHash = await hashPassword(args.password, credential.passwordSalt);
    if (passwordHash !== credential.passwordHash) {
      throw new ConvexError({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid login or password.',
      });
    }

    const sessionToken = createRandomSecret(32);
    const tokenHash = await sha256Base64Url(sessionToken);
    const now = Date.now();
    const sessionId = await ctx.db.insert('sessions', {
      credentialId: credential._id,
      tokenHash,
      expiresAt: now + SESSION_TTL_MS,
      createdAt: now,
    });

    return {
      sessionId,
      sessionToken,
    };
  },
});

export const validateSession = query({
  args: {
    sessionId: v.id('sessions'),
    sessionToken: v.string(),
  },
  returns: validatedSessionValidator,
  handler: async (ctx, args) => {
    const session = await ctx.db.get('sessions', args.sessionId);
    const now = Date.now();
    if (!session || session.expiresAt <= now) {
      return false;
    }

    const tokenHash = await sha256Base64Url(args.sessionToken);
    if (tokenHash !== session.tokenHash) {
      return false;
    }

    const credential = await ctx.db.get('credentials', session.credentialId);
    return Boolean(credential);
  },
});

export const logout = mutation({
  args: {
    sessionId: v.id('sessions'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get('sessions', args.sessionId);
    if (session) {
      await ctx.db.delete('sessions', args.sessionId);
    }
    return null;
  },
});

