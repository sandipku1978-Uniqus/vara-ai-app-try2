import { AI_MODELS, type AiModelDefinition, type ReasoningEffort } from '../../lib/ai-models';

const EFFORT_SHORT: Record<ReasoningEffort, string> = {
  none: 'off',
  low: 'low',
  medium: 'med',
  high: 'high',
  max: 'max',
};

const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  none: 'Off',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  max: 'Max',
};

/** Tiny trigger suffix: "med", "high", "off". */
export function effortShort(effort: ReasoningEffort): string {
  return EFFORT_SHORT[effort];
}

/** Segment label in the effort control. */
export function effortLabel(effort: ReasoningEffort): string {
  return EFFORT_LABEL[effort];
}

/** Sentence form for the answer footer: "high effort", "reasoning off". */
export function effortPhrase(effort: ReasoningEffort): string {
  return effort === 'none' ? 'reasoning off' : `${effort} effort`;
}

/** 1_000_000 → "1M", 1_050_000 → "1.05M", 500_000 → "500K". */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number(millions.toFixed(2))}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/** USD per token → "$2", "$0.20", "$3.75" per million tokens. */
export function formatPerMillion(perToken: number): string {
  const perMillion = Math.round(perToken * 1_000_000 * 1000) / 1000;
  if (Number.isInteger(perMillion)) return `$${perMillion}`;
  return `$${perMillion.toFixed(perMillion < 0.1 ? 3 : 2)}`;
}

export interface ProviderGroup {
  providerLabel: string;
  models: AiModelDefinition[];
}

/** Registry order, grouped by vendor label in first-appearance order. */
export function groupModelsByProvider(models: readonly AiModelDefinition[] = AI_MODELS): ProviderGroup[] {
  const groups: ProviderGroup[] = [];
  for (const model of models) {
    const existing = groups.find(group => group.providerLabel === model.providerLabel);
    if (existing) existing.models.push(model);
    else groups.push({ providerLabel: model.providerLabel, models: [model] });
  }
  return groups;
}
