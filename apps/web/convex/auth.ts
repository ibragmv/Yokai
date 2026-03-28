import { ConvexError, v } from 'convex/values';

import { mutation, query } from './_generated/server';

const PASSWORD_ITERATIONS = 120_000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

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
  returns: v.object({
    hasCredentials: v.boolean(),
  }),
  handler: async (ctx) => {
    const firstCredential = await ctx.db.query('adminCredentials').first();
    return { hasCredentials: Boolean(firstCredential) };
  },
});

export const setupAdmin = mutation({
  args: {
    login: v.string(),
    password: v.string(),
  },
  returns: v.object({
    sessionId: v.id('adminSessions'),
    sessionToken: v.string(),
    login: v.string(),
  }),
  handler: async (ctx, args) => {
    const login = normalizeLogin(args.login);
    assertCredentialInput(login, args.password);

    const firstCredential = await ctx.db.query('adminCredentials').first();
    if (firstCredential) {
      throw new ConvexError({
        code: 'ADMIN_EXISTS',
        message: 'Admin credentials have already been configured.',
      });
    }

    const passwordSalt = createRandomSecret(16);
    const passwordHash = await hashPassword(args.password, passwordSalt);
    const credentialId = await ctx.db.insert('adminCredentials', {
      login,
      passwordHash,
      passwordSalt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const sessionToken = createRandomSecret(32);
    const tokenHash = await sha256Base64Url(sessionToken);
    const sessionId = await ctx.db.insert('adminSessions', {
      credentialId,
      tokenHash,
      expiresAt: Date.now() + SESSION_TTL_MS,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });

    return {
      sessionId,
      sessionToken,
      login,
    };
  },
});

export const login = mutation({
  args: {
    login: v.string(),
    password: v.string(),
  },
  returns: v.object({
    sessionId: v.id('adminSessions'),
    sessionToken: v.string(),
    login: v.string(),
  }),
  handler: async (ctx, args) => {
    const login = normalizeLogin(args.login);
    const credential = await ctx.db
      .query('adminCredentials')
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
    const sessionId = await ctx.db.insert('adminSessions', {
      credentialId: credential._id,
      tokenHash,
      expiresAt: Date.now() + SESSION_TTL_MS,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });

    return {
      sessionId,
      sessionToken,
      login,
    };
  },
});

export const validateSession = mutation({
  args: {
    sessionId: v.id('adminSessions'),
    sessionToken: v.string(),
  },
  returns: v.union(
    v.object({
      credentialId: v.id('adminCredentials'),
      login: v.string(),
      expiresAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      return null;
    }

    const tokenHash = await sha256Base64Url(args.sessionToken);
    if (tokenHash !== session.tokenHash) {
      return null;
    }

    const credential = await ctx.db.get(session.credentialId);
    if (!credential) {
      return null;
    }

    await ctx.db.patch(args.sessionId, {
      lastSeenAt: Date.now(),
    });

    return {
      credentialId: credential._id,
      login: credential.login,
      expiresAt: session.expiresAt,
    };
  },
});

export const logout = mutation({
  args: {
    sessionId: v.id('adminSessions'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (session) {
      await ctx.db.delete(args.sessionId);
    }
    return null;
  },
});
