import { createRef, type ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { defaultSearchFilters } from '../components/filters/SearchFilterBar';
import ResearchResultsWorkspace from '../components/research/ResearchResultsWorkspace';
import type { FilingResearchResult } from '../services/filingResearch';

function filing(overrides: Partial<FilingResearchResult> = {}): FilingResearchResult {
  return {
    id: 'filing-1',
    entityName: 'Older Corp',
    fileDate: '2025-01-01',
    formType: '10-K',
    documentType: '10-K',
    cik: '1',
    accessionNumber: '0000000001-25-000001',
    primaryDocument: 'report.htm',
    filingPrimaryDocument: 'report.htm',
    description: 'Annual report',
    matchSnippet: 'A material weakness was remediated.',
    matchReason: 'Validated filing text',
    score: 1,
    relevanceScore: 1,
    filingUrl: 'https://www.sec.gov/example',
    companyName: 'Older Corp',
    tickers: ['OLD'],
    sic: '1000',
    sicDescription: 'Industrial',
    exchange: 'NYSE',
    stateOfIncorporation: 'DE',
    fiscalYearEnd: '1231',
    headquarters: 'New York, NY',
    fileNumber: '001-00001',
    auditor: 'Example LLP',
    acceleratedStatus: 'Large accelerated filer',
    ...overrides,
  };
}

function props(overrides: Partial<ComponentProps<typeof ResearchResultsWorkspace>> = {}): ComponentProps<typeof ResearchResultsWorkspace> {
  return {
    activeSession: null,
    results: [],
    candidateCoverage: null,
    resultLimit: 500,
    resultPageSize: 50,
    canCountExactly: false,
    exactCountProgress: null,
    onCountExactly: vi.fn(),
    loading: false,
    degradedNotice: '',
    onDismissDegradedNotice: vi.fn(),
    activeResolvedSearch: {
      query: 'material weakness',
      mode: 'semantic',
      filters: { ...defaultSearchFilters },
    },
    isRefiningResults: false,
    issuerFreshness: null,
    searched: false,
    errorMsg: '',
    selectedResult: null,
    previewHighlightTerms: ['material weakness'],
    onSelectResult: vi.fn(),
    onExportResults: vi.fn(),
    onOpenInsiders: vi.fn(),
    onOpenFiling: vi.fn(),
    previewError: false,
    selectedPrimaryDocument: '',
    selectedDocumentUrl: '',
    selectedProxyUrl: '',
    previewFrameRef: createRef<HTMLIFrameElement>(),
    onPreviewLoad: vi.fn(),
    onPreviewError: vi.fn(),
    selectedIsCited: false,
    onToggleCitation: vi.fn(),
    ...overrides,
  };
}

describe('ResearchResultsWorkspace', () => {
  it('keeps relevance order by default and lets the visitor switch to newest', () => {
    const older = filing();
    const newer = filing({ id: 'filing-2', entityName: 'Newer Corp', companyName: 'Newer Corp', fileDate: '2026-01-01' });
    render(<ResearchResultsWorkspace {...props({ results: [older, newer], resultPageSize: 1 })} />);

    expect(screen.getByText('Older Corp')).toBeTruthy();
    expect(screen.queryByText('Newer Corp')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Newest' }));
    expect(screen.getByText('Newer Corp')).toBeTruthy();
    expect(screen.queryByText('Older Corp')).toBeNull();
  });

  it('keeps selection and export actions owned by SearchPage', () => {
    const result = filing();
    const onSelectResult = vi.fn();
    const onExportResults = vi.fn();
    render(
      <ResearchResultsWorkspace
        {...props({ results: [result], onSelectResult, onExportResults })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /older corp/i }));
    expect(onSelectResult).toHaveBeenCalledWith(result.id);

    fireEvent.click(screen.getByRole('button', { name: /export \.xlsx/i }));
    expect(onExportResults).toHaveBeenCalledOnce();
  });

  it('wires exact-count and preview evidence actions without owning their effects', () => {
    const result = filing();
    const onCountExactly = vi.fn();
    const onOpenFiling = vi.fn();
    const onToggleCitation = vi.fn();
    render(
      <ResearchResultsWorkspace
        {...props({
          results: [result],
          selectedResult: result,
          canCountExactly: true,
          candidateCoverage: { examined: 1, upstreamTotal: 10, complete: false },
          selectedPrimaryDocument: 'report.htm',
          selectedDocumentUrl: 'https://www.sec.gov/report.htm',
          previewError: true,
          onCountExactly,
          onOpenFiling,
          onToggleCitation,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /count exactly/i }));
    expect(onCountExactly).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Cite' }));
    expect(onToggleCitation).toHaveBeenCalledOnce();

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Filing' })[0]);
    expect(onOpenFiling).toHaveBeenCalledWith(result);
  });

  it('does not render or save an official source until a real SEC document URL exists', () => {
    const result = filing({
      primaryDocument: 'edgar/data/1/0000000001-25-000001.txt',
      filingUrl: 'https://www.sec.gov/Archives/edgar/data/1/edgar/data/1/0000000001-25-000001.txt',
    });
    const onToggleCitation = vi.fn();
    render(<ResearchResultsWorkspace {...props({
      results: [result],
      selectedResult: result,
      selectedPrimaryDocument: '',
      selectedDocumentUrl: '',
      selectedProxyUrl: '',
      previewError: true,
      onToggleCitation,
    })} />);

    expect(screen.queryByRole('link', { name: /SEC\.gov/i })).toBeNull();
    expect(screen.queryByTitle(/filing preview/i)).toBeNull();
    expect(screen.getByText(/Locating the official document/i)).toBeInTheDocument();
    const cite = screen.getByRole('button', { name: 'Cite' });
    expect(cite).toBeDisabled();
    fireEvent.click(cite);
    expect(onToggleCitation).not.toHaveBeenCalled();
  });
});
