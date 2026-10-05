import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnswerModelLine, WebSourcesList } from '../components/ai/AnswerModelMeta';
import { fetchAvailableModelIds, parseAvailableModelIds } from '../components/ai/modelAvailability';
import {
  aiDraftMemoFromCitations,
  answeredByFallback,
  askAi,
  callClaudeStreaming,
  generateAgentAnswerStreaming,
  readAiAnswerMeta,
  type AiAnswerMeta,
} from '../services/aiApi';
import { resetAiModelPreferenceCache, setAiModelPreference } from '../services/aiModelPreference';
import { buildStorageScope, setActiveBrowserStorageScope } from '../services/storageNamespace';

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  };
}

function sseResponse(events: string[]) {
  const encoder = new TextEncoder();
  const chunks = events.map(event => encoder.encode(event));
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: {
      getReader: () => ({
        read: () => Promise.resolve(index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }),
      }),
    },
  };
}

function sentBody(call = 0) {
  return JSON.parse(mockFetch.mock.calls[call][1].body);
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  window.localStorage.clear();
  resetAiModelPreferenceCache();
  setActiveBrowserStorageScope(buildStorageScope('user_a', null));
  setAiModelPreference({ modelId: 'openai/gpt-6.1-sol', effort: 'high', webSearch: true });
});

afterEach(() => {
  setActiveBrowserStorageScope(null);
  resetAiModelPreferenceCache();
  vi.unstubAllGlobals();
});

describe('client AI calls send the model selection', () => {
  it('askAi sends model, effort and the web-search choice', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ text: 'ok' }));
    await askAi('What changed in ASC 842?');
    expect(sentBody()).toMatchObject({ model: 'openai/gpt-6.1-sol', reasoningEffort: 'high', webSearch: true });
  });

  it('the memo draft uses the same model but never web search', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ text: '# Research memo — X' }));
    await aiDraftMemoFromCitations([{ company: 'X', form: '10-K', fileDate: '2026-01-01', accessionNumber: '1', excerpt: 'e', note: '' }]);
    expect(sentBody()).toMatchObject({ model: 'openai/gpt-6.1-sol', reasoningEffort: 'high', webSearch: false });
  });

  it('streams the copilot answer with the selection and reports what answered', async () => {
    mockFetch.mockResolvedValueOnce(sseResponse([
      'data: {"text":"Hello "}\n\n',
      'data: {"text":"world"}\n\n',
      'data: {"model":"anthropic/claude-sonnet-5.5","provider":"anthropic","reasoningEffort":"medium","webSources":[{"url":"https://www.sec.gov/news","title":"SEC news"},"ftp://bad","https://www.sec.gov/news"]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const chunks: string[] = [];
    const onMeta = vi.fn();
    const text = await generateAgentAnswerStreaming(
      { title: 't', summary: 's', findings: [], citations: [], followUps: [], notes: [] },
      { pagePath: '/', pageLabel: 'Home', filing: null, search: null, compare: null, conversation: [] },
      chunk => chunks.push(chunk),
      onMeta,
    );
    expect(text).toBe('Hello world');
    expect(sentBody()).toMatchObject({ model: 'openai/gpt-6.1-sol', reasoningEffort: 'high', webSearch: true });
    expect(onMeta).toHaveBeenCalledTimes(1);
    const meta: AiAnswerMeta = onMeta.mock.calls[0][0];
    expect(meta).toEqual({
      requestedModel: 'openai/gpt-6.1-sol',
      requestedEffort: 'high',
      model: 'anthropic/claude-sonnet-5.5',
      provider: 'anthropic',
      reasoningEffort: 'medium',
      webSources: [{ url: 'https://www.sec.gov/news', title: 'SEC news' }],
    });
    expect(answeredByFallback(meta)).toBe(true);
  });

  it('reports no metadata when the server does not send any', async () => {
    mockFetch.mockResolvedValueOnce(sseResponse(['data: {"text":"plain"}\n\n', 'data: [DONE]\n\n']));
    const onMeta = vi.fn();
    await callClaudeStreaming('p', { onChunk: () => undefined, onMeta });
    expect(onMeta).not.toHaveBeenCalled();
    expect(sentBody().webSearch).toBe(false);
  });
});

describe('readAiAnswerMeta', () => {
  const requested = { model: 'anthropic/claude-opus-5.5', reasoningEffort: 'max' as const, webSearch: false };

  it('ignores payloads without metadata and malformed fields', () => {
    expect(readAiAnswerMeta({ text: 'x' }, requested)).toBeNull();
    expect(readAiAnswerMeta({ model: 'anthropic/claude-opus-5.5', reasoningEffort: 'turbo', webSources: 'x' }, requested)).toEqual({
      requestedModel: 'anthropic/claude-opus-5.5',
      requestedEffort: 'max',
      model: 'anthropic/claude-opus-5.5',
      provider: null,
      reasoningEffort: null,
      webSources: [],
    });
  });

  it('reads a nested meta object', () => {
    expect(readAiAnswerMeta({ meta: { model: 'zai/glm-5.3' } }, requested)?.model).toBe('zai/glm-5.3');
  });
});

describe('answer footer', () => {
  const base: AiAnswerMeta = {
    requestedModel: 'openai/gpt-6.1-sol',
    requestedEffort: 'high',
    model: 'openai/gpt-6.1-sol',
    provider: 'openai',
    reasoningEffort: 'high',
    webSources: [],
  };

  it('names the model and effort the server reported', () => {
    render(<AnswerModelLine meta={base} />);
    expect(screen.getByText('Answered by GPT-6.1 Sol · high effort')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('says so when the server fell back to another model', () => {
    render(<AnswerModelLine meta={{ ...base, model: 'anthropic/claude-sonnet-5.5', reasoningEffort: 'none' }} />);
    expect(screen.getByText('Answered by Claude Sonnet 5.5 · reasoning off')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('You chose GPT-6.1 Sol; the gateway answered with Claude Sonnet 5.5 instead.');
  });

  it('claims nothing when the server did not name a model', () => {
    const { container } = render(<AnswerModelLine meta={{ ...base, model: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists web sources apart from filing citations', () => {
    render(<WebSourcesList sources={[{ url: 'https://www.example.com/a', title: null }, { url: 'https://news.test/b', title: 'Story' }]} />);
    const region = screen.getByRole('region', { name: 'Web sources' });
    expect(region).toHaveTextContent('Open web, not SEC filings');
    expect(screen.getByRole('link', { name: 'example.com' })).toHaveAttribute('href', 'https://www.example.com/a');
    expect(screen.getByRole('link', { name: 'Story' })).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('model availability', () => {
  it('parses the registry list in its likely shapes', () => {
    expect(parseAvailableModelIds({ models: [{ id: 'a/b' }, { id: 'c/d' }] })).toEqual(new Set(['a/b', 'c/d']));
    expect(parseAvailableModelIds([{ id: 'a/b' }, 'c/d'])).toEqual(new Set(['a/b', 'c/d']));
    expect(parseAvailableModelIds({ data: [] })).toEqual(new Set());
    expect(parseAvailableModelIds({ error: 'nope' })).toBeNull();
  });

  it('treats a missing route or failed request as unknown', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, 404));
    await expect(fetchAvailableModelIds()).resolves.toBeNull();
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchAvailableModelIds()).resolves.toBeNull();
    mockFetch.mockResolvedValueOnce(jsonResponse({ models: [{ id: 'anthropic/claude-sonnet-5.5' }] }));
    await expect(fetchAvailableModelIds()).resolves.toEqual(new Set(['anthropic/claude-sonnet-5.5']));
    expect(mockFetch).toHaveBeenLastCalledWith('/api/ai/models', expect.anything());
  });
});
