export async function loadAvailableModels(apiKey?: string): Promise<string[]> {
  const token = apiKey || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) {
    return [
      'vercel-ai-gateway/google/gemini-3-flash',
      'vercel-ai-gateway/anthropic/claude-sonnet-4.6',
    ];
  }

  const response = await fetch('https://ai-gateway.vercel.sh/v1/models', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    return [
      'vercel-ai-gateway/google/gemini-3-flash',
      'vercel-ai-gateway/anthropic/claude-sonnet-4.6',
    ];
  }

  const payload = (await response.json()) as { data?: Array<{ id?: string }> };
  const models = Array.isArray(payload.data) ? payload.data : [];

  return models
    .map((model) => (model.id ? `vercel-ai-gateway/${model.id}` : null))
    .filter((model): model is string => Boolean(model))
    .slice(0, 50);
}

export async function fetchGatewayCredits(apiKey?: string) {
  const token = apiKey || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
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
