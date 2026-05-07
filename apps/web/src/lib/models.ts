export type OpenClawProviderModel = {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

type SupportedModelDefinition = {
  id: string;
  isDefault?: boolean;
  openClaw: OpenClawProviderModel;
};

const SUPPORTED_MODEL_DEFINITIONS = [
  {
    id: 'vercel-ai-gateway/google/gemini-3-flash',
    openClaw: {
      id: 'google/gemini-3-flash',
      name: 'Gemini 3 Flash',
      reasoning: false,
      input: ['text'],
      contextWindow: 1_000_000,
      maxTokens: 8_192,
      cost: {
        input: 0.5,
        output: 3,
        cacheRead: 0,
        cacheWrite: 0,
      },
    },
  },
  {
    id: 'vercel-ai-gateway/anthropic/claude-sonnet-4.6',
    isDefault: true,
    openClaw: {
      id: 'anthropic/claude-sonnet-4.6',
      name: 'Claude Sonnet 4.6',
      reasoning: true,
      input: ['text'],
      contextWindow: 200_000,
      maxTokens: 8_192,
      cost: {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
      },
    },
  },
] as const satisfies readonly SupportedModelDefinition[];

export const SUPPORTED_MODEL_IDS = SUPPORTED_MODEL_DEFINITIONS.map((model) => model.id);
export const OPENCLAW_PROVIDER_MODELS = SUPPORTED_MODEL_DEFINITIONS.map((model) => model.openClaw);
export const DEFAULT_MODEL_ID =
  SUPPORTED_MODEL_DEFINITIONS.find((model) => 'isDefault' in model && model.isDefault)?.id ??
  SUPPORTED_MODEL_IDS[0];

const SUPPORTED_MODEL_ID_SET = new Set<string>(SUPPORTED_MODEL_IDS);

export type SupportedModelId = (typeof SUPPORTED_MODEL_IDS)[number];

function normalizeModelId(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function isSupportedModelId(value: string | null | undefined): value is SupportedModelId {
  return SUPPORTED_MODEL_ID_SET.has(normalizeModelId(value));
}

export function resolveSupportedModelId(value: string | null | undefined): SupportedModelId {
  const normalizedValue = normalizeModelId(value);
  return isSupportedModelId(normalizedValue) ? normalizedValue : DEFAULT_MODEL_ID;
}

export function filterSupportedModelIds(models: readonly string[]): SupportedModelId[] {
  const filtered = Array.from(
    new Set(
      models
        .map((model) => normalizeModelId(model))
        .filter((model): model is SupportedModelId => isSupportedModelId(model)),
    ),
  );

  return filtered.length ? filtered : [...SUPPORTED_MODEL_IDS];
}

