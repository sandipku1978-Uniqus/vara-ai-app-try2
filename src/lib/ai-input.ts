const CHAT_BODY_LIMIT = 256 * 1024;
const COMPARE_BODY_LIMIT = 768 * 1024;
const MAX_PROMPT_CHARS = 60_000;
const MAX_MESSAGE_CHARS = 40_000;
const MAX_TOTAL_MESSAGE_CHARS = 120_000;
const MAX_COMPARISON_TEXT_CHARS = 40_000;
const MAX_TOTAL_COMPARISON_CHARS = 600_000;
const BODY_READ_TIMEOUT_MS = 10_000;

export type ChatMessageInput = { role: 'user' | 'assistant'; content: string };

/**
 * Asks the route to answer only from relevance-selected excerpts of the
 * curated framework knowledge base (Accounting Hub "Ask AI"). `topic` is an
 * optional curated ASC topic number ("842") that steers excerpt selection.
 */
export interface ChatGroundingInput {
  source: 'framework-kb';
  topic: string | null;
}

export interface ValidatedChatInput {
  prompt: string;
  messages: ChatMessageInput[];
  maxTokens: number;
  frameworks: Array<'IFRS' | 'Ind AS'>;
  grounding: ChatGroundingInput | null;
}

export interface FilingContextInput {
  ticker: string;
  companyName: string;
  text: string;
}

export interface ValidatedCompareInput {
  tickers: string[];
  section: string;
  filingContexts: FilingContextInput[];
}

export type ValidationResult<T> =
  | { value: T; response?: never }
  | { value?: never; response: Response };

function badRequest(error: string, status = 400): ValidationResult<never> {
  return {
    response: Response.json({ error }, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    }),
  };
}

class BodyReadError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function readBodyBytes(request: Request, maxBytes: number, timeoutMs: number): Promise<Uint8Array> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new BodyReadError('Request body is too large.', 413);
  }
  if (request.signal.aborted) throw new BodyReadError('Request was cancelled.', 499);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let cancellation: 'request' | 'timeout' | null = null;
  const cancelForRequest = () => {
    cancellation = 'request';
    void reader.cancel(request.signal.reason).catch(() => undefined);
  };
  const timeout = setTimeout(() => {
    cancellation = 'timeout';
    void reader.cancel('Request body read timed out.').catch(() => undefined);
  }, timeoutMs);
  request.signal.addEventListener('abort', cancelForRequest, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (cancellation === 'request') throw new BodyReadError('Request was cancelled.', 499);
      if (cancellation === 'timeout') throw new BodyReadError('Request body read timed out.', 408);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BodyReadError('Request body is too large.', 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (cancellation === 'request') throw new BodyReadError('Request was cancelled.', 499);
    if (cancellation === 'timeout') throw new BodyReadError('Request body read timed out.', 408);
    throw error;
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', cancelForRequest);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJsonBody(
  request: Request,
  maxBytes: number,
  timeoutMs = BODY_READ_TIMEOUT_MS
): Promise<ValidationResult<unknown>> {
  try {
    const bytes = await readBodyBytes(request, maxBytes, timeoutMs);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    if (error instanceof BodyReadError) return badRequest(error.message, error.status);
    return badRequest('Request body must be valid UTF-8 JSON.');
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function validateChatRequest(request: Request): Promise<ValidationResult<ValidatedChatInput>> {
  const parsed = await readJsonBody(request, CHAT_BODY_LIMIT);
  if (parsed.response) return parsed;
  const body = asRecord(parsed.value);
  if (!body) return badRequest('Request body must be a JSON object.');

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length > MAX_PROMPT_CHARS) return badRequest(`Prompt exceeds ${MAX_PROMPT_CHARS} characters.`);

  if (body.messages !== undefined && !Array.isArray(body.messages)) {
    return badRequest('Messages must be an array.');
  }
  const rawMessages = (body.messages || []) as unknown[];
  if (rawMessages.length > 50) return badRequest('Too many messages (max 50).');

  const messages: ChatMessageInput[] = [];
  let totalMessageChars = 0;
  for (const rawMessage of rawMessages) {
    const message = asRecord(rawMessage);
    if (!message || (message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') {
      return badRequest('Each message must have a user/assistant role and string content.');
    }
    if (message.content.length > MAX_MESSAGE_CHARS) {
      return badRequest(`A message exceeds ${MAX_MESSAGE_CHARS} characters.`);
    }
    totalMessageChars += message.content.length;
    messages.push({ role: message.role, content: message.content });
  }
  if (totalMessageChars > MAX_TOTAL_MESSAGE_CHARS) {
    return badRequest(`Messages exceed ${MAX_TOTAL_MESSAGE_CHARS} total characters.`);
  }
  if (messages.length > 0 && messages[messages.length - 1].role !== 'user') {
    return badRequest('The final conversation message must be from the user.');
  }
  if (!prompt && messages.length === 0) return badRequest('Missing prompt or messages.');

  if (body.frameworks !== undefined && !Array.isArray(body.frameworks)) {
    return badRequest('Frameworks must be an array.');
  }
  const frameworks = [...new Set((body.frameworks || []).filter(
    (value): value is 'IFRS' | 'Ind AS' => value === 'IFRS' || value === 'Ind AS'
  ))];
  if (Array.isArray(body.frameworks) && frameworks.length !== body.frameworks.length) {
    return badRequest('Unsupported framework value.');
  }

  const maxTokensValue = Number(body.maxTokens ?? 4096);
  const maxTokens = Math.min(Math.max(Number.isFinite(maxTokensValue) ? Math.floor(maxTokensValue) : 4096, 1), 16_384);

  let grounding: ChatGroundingInput | null = null;
  if (body.grounding !== undefined && body.grounding !== null) {
    const rawGrounding = asRecord(body.grounding);
    if (!rawGrounding || rawGrounding.source !== 'framework-kb') {
      return badRequest('Unsupported grounding source.');
    }
    const rawTopic = rawGrounding.topic;
    if (rawTopic !== undefined && rawTopic !== null && (typeof rawTopic !== 'string' || !/^\d{3}$/.test(rawTopic))) {
      return badRequest('Grounding topic must be a three-digit ASC topic number.');
    }
    // A grounded answer is a single question against selected excerpts: a
    // conversation would carry earlier unguarded turns, and the framework
    // flag would append the entire knowledge base, defeating the selection.
    if (!prompt || messages.length > 0) {
      return badRequest('Grounded requests take a single prompt and no conversation messages.');
    }
    if (frameworks.length > 0) {
      return badRequest('Grounded requests select their own knowledge base excerpts; omit frameworks.');
    }
    grounding = { source: 'framework-kb', topic: typeof rawTopic === 'string' ? rawTopic : null };
  }

  // Claude Sonnet 5 rejects non-default sampling parameters. A legacy
  // `temperature` field is tolerated for older clients but has no effect.
  return { value: { prompt, messages, maxTokens, frameworks, grounding } };
}

export async function validateCompareRequest(request: Request): Promise<ValidationResult<ValidatedCompareInput>> {
  const parsed = await readJsonBody(request, COMPARE_BODY_LIMIT);
  if (parsed.response) return parsed;
  const body = asRecord(parsed.value);
  if (!body) return badRequest('Request body must be a JSON object.');

  if (!Array.isArray(body.tickers) || body.tickers.length < 2 || body.tickers.length > 20) {
    return badRequest('Between 2 and 20 tickers are required.');
  }
  const tickers = body.tickers.map(value => typeof value === 'string' ? value.trim().toUpperCase() : '');
  if (tickers.some(ticker => !/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker))) {
    return badRequest('Ticker values are invalid.');
  }
  if (new Set(tickers).size !== tickers.length) {
    return badRequest('Ticker values must be unique.');
  }

  const section = typeof body.section === 'string' ? body.section.trim() : '';
  if (!section || section.length > 200) return badRequest('Section must contain 1 to 200 characters.');
  if (!Array.isArray(body.filingContexts) || body.filingContexts.length !== tickers.length) {
    return badRequest('One filing context is required for each ticker.');
  }

  const filingContexts: FilingContextInput[] = [];
  let totalChars = 0;
  for (const [index, rawContext] of body.filingContexts.entries()) {
    const context = asRecord(rawContext);
    if (!context || typeof context.ticker !== 'string' || typeof context.companyName !== 'string' || typeof context.text !== 'string') {
      return badRequest('Each filing context requires ticker, companyName, and text strings.');
    }
    const ticker = context.ticker.trim().toUpperCase();
    const companyName = context.companyName.trim();
    if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker) || !companyName || companyName.length > 300) {
      return badRequest('A filing context has invalid issuer metadata.');
    }
    if (ticker !== tickers[index]) {
      return badRequest('Filing contexts must match the requested tickers in order.');
    }
    if (context.text.length > MAX_COMPARISON_TEXT_CHARS) {
      return badRequest(`A filing context exceeds ${MAX_COMPARISON_TEXT_CHARS} characters.`);
    }
    totalChars += context.text.length;
    filingContexts.push({ ticker, companyName, text: context.text });
  }
  if (totalChars > MAX_TOTAL_COMPARISON_CHARS) {
    return badRequest(`Filing contexts exceed ${MAX_TOTAL_COMPARISON_CHARS} total characters.`);
  }

  return { value: { tickers, section, filingContexts } };
}
