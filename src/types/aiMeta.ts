/**
 * What an AI route reports about the reply that answered: the model, effort,
 * provider, usage and any web pages it read. Kept apart from `aiApi.ts` so
 * `types/agent.ts` can name it without importing the client (which imports
 * the planner, which imports the agent types — a cycle the gate rejects).
 */

import type { ReasoningEffort } from '../lib/ai-models';

/** A web page the model read when web search was on — never an SEC filing citation. */
export interface AiWebSource {
  url: string;
  title: string | null;
}

/**
 * What the server says actually answered. Every field is as reported; a field
 * the server did not report stays null rather than being filled from the
 * request, so the UI never claims a model it was not told about.
 */
export interface AiAnswerMeta {
  requestedModel: string | null;
  requestedEffort: ReasoningEffort | null;
  model: string | null;
  provider: string | null;
  reasoningEffort: ReasoningEffort | null;
  webSources: AiWebSource[];
  /** Token usage as the route reported it; absent when it reported none. */
  usage?: AiReportedUsage;
}

/** The route's `usage` (lib/ai-gateway AiUsage), reduced to finite counts. */
export interface AiReportedUsage {
  input: number;
  output: number;
  reasoning?: number;
  webSearchCalls?: number;
}
