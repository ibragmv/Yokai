import 'server-only';

const DEFAULT_MODELS = [
  'vercel-ai-gateway/google/gemini-3-flash',
  'vercel-ai-gateway/anthropic/claude-sonnet-4.6',
] as const;

function getToken(apiKey?: string) {
  return apiKey || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
}

export async function loadAvailableModels(apiKey?: string): Promise<string[]> {
  const token = getToken(apiKey);
  if (!token) {
    return [...DEFAULT_MODELS];
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

  return normalizedModels.length ? normalizedModels : [...DEFAULT_MODELS];
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
