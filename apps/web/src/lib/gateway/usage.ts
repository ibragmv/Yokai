import 'server-only';

import { SUPPORTED_MODEL_IDS, filterSupportedModelIds } from '@/lib/models';

function getToken(apiKey?: string) {
  return apiKey || process.env.AI_GATEWAY_API_KEY;
}

export async function loadAvailableModels(apiKey?: string): Promise<string[]> {
  const token = getToken(apiKey);
  if (!token) {
    return [...SUPPORTED_MODEL_IDS];
  }

  const response = await fetch('https://ai-gateway.vercel.sh/v1/models', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    return [...SUPPORTED_MODEL_IDS];
  }

  const payload = (await response.json()) as { data?: Array<{ id?: string }> };
  const models = Array.isArray(payload.data) ? payload.data : [];

  const normalizedModels = models
    .map((model) => (model.id ? `vercel-ai-gateway/${model.id}` : null))
    .filter((model): model is string => Boolean(model))
    .slice(0, 50);

  return filterSupportedModelIds(normalizedModels);
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

