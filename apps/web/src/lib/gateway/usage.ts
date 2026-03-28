import 'server-only';

import { createHash } from 'node:crypto';

const DEFAULT_MODELS = [
  'vercel-ai-gateway/google/gemini-3-flash',
  'vercel-ai-gateway/anthropic/claude-sonnet-4.6',
] as const;

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const modelCache = new Map<string, { expiresAt: number; models: string[] }>();

function getToken(apiKey?: string) {
  return apiKey || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
}

function getCacheKey(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function loadAvailableModels(apiKey?: string): Promise<string[]> {
  const token = getToken(apiKey);
  if (!token) {
    return [...DEFAULT_MODELS];
  }

  const cacheKey = getCacheKey(token);
  const cached = modelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.models;
  }

  const response = await fetch('https://ai-gateway.vercel.sh/v1/models', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    return [...DEFAULT_MODELS];
  }

  const payload = (await response.json()) as { data?: Array<{ id?: string }> };
  const models = Array.isArray(payload.data) ? payload.data : [];

  const normalizedModels = models
    .map((model) => (model.id ? `vercel-ai-gateway/${model.id}` : null))
    .filter((model): model is string => Boolean(model))
    .slice(0, 50);

  const nextModels = normalizedModels.length ? normalizedModels : [...DEFAULT_MODELS];
  modelCache.set(cacheKey, {
    expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
    models: nextModels,
  });

  return nextModels;
}

export async function fetchGatewayCredits(apiKey?: string) {
  const token = getToken(apiKey);
  if (!token) {
    return null;
  }

  const response = await fetch('https://ai-gateway.vercel.sh/v1/credits', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to load AI Gateway credits (${response.status})`);
  }

  return response.json();
}
