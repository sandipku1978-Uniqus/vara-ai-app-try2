import { useRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentFindBar, DocumentHitList } from '../components/research/DocumentFind';
import { useDocumentFind } from '../hooks/useDocumentFind';

const FILING_HTML = `
  <p>Item 1. Business</p>
  <p>Management identified a material weakness last year.</p>
  <p>Item 9A. Controls and Procedures</p>
  <p>The material <b>weak</b>ness was remediated. Weaknesses in other areas were not material.</p>
`;

/** A stand-in for the sandboxed viewer frame: same-origin document, no scripts. */
function fakeFrame(doc: Document) {
  const scrollTo = vi.fn();
  return {
    contentDocument: doc,
    contentWindow: { scrollY: 0, innerHeight: 600, scrollTo },
    clientHeight: 600,
    focus: vi.fn(),
    scrollTo,
  };
}

function Harness({ frame, hitQuery, loadToken = 1 }: { frame: ReturnType<typeof fakeFrame>; hitQuery: string; loadToken?: number }) {
  const frameRef = useRef(frame as unknown as HTMLIFrameElement);
  const state = useDocumentFind({ frameRef, loadToken, hitQuery });
  return (
    <div onKeyDown={event => state.handleShortcut(event)}>
      <button type="button" onClick={state.find.openFind}>Find in document</button>
      <DocumentFindBar id="find" find={state.find} inputRef={state.findInputRef} />
      <DocumentHitList hits={state.hits} query={hitQuery} mode="boolean" />
    </div>
  );
}

function setup(hitQuery = '') {
  const doc = new DOMParser().parseFromString(`<html><body>${FILING_HTML}</body></html>`, 'text/html');
  const frame = fakeFrame(doc);
  render(<Harness frame={frame} hitQuery={hitQuery} />);
  return { doc, frame };
}

describe('filing viewer find bar', () => {
  it('opens from Ctrl/Cmd+F inside the document, counts and steps through matches, and closes on Escape', async () => {
    const { doc, frame } = setup();
    expect(screen.queryByRole('search')).toBeNull();

    // Focus inside the frame sends keys to the frame's document.
    act(() => {
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    const input = await screen.findByRole('textbox', { name: 'Find in document' });

    fireEvent.change(input, { target: { value: 'material' } });
    await waitFor(() => expect(screen.getByText('1 of 3')).toBeInTheDocument());
    expect(doc.querySelectorAll('mark[data-vara-find-hit]')).toHaveLength(3);
    // Find marks never masquerade as the incoming query's highlight.
    expect(doc.querySelectorAll('mark[data-vara-search-hit]')).toHaveLength(0);
    expect(doc.querySelector('mark[data-vara-find-active]')?.textContent).toBe('material');
    expect(frame.scrollTo).toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(screen.getByText('3 of 3')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('search')).toBeNull());
    expect(doc.querySelectorAll('mark[data-vara-find-hit]')).toHaveLength(0);
    expect(doc.body.textContent).toContain('The material weakness was remediated.');
  });

  it('applies the whole-word rule and matches across inline markup', async () => {
    const { doc } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Find in document' }));
    const input = await screen.findByRole('textbox', { name: 'Find in document' });

    fireEvent.change(input, { target: { value: 'WEAKNESS' } });
    await waitFor(() => expect(screen.getByText('1 of 3')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Whole word' }));
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Whole word' })).toHaveAttribute('aria-pressed', 'true');
    const second = Array.from(doc.querySelectorAll('mark[data-vara-find-hit]')).slice(1).map(mark => mark.textContent).join('');
    expect(second).toBe('weakness');

    fireEvent.change(input, { target: { value: 'goodwill' } });
    await waitFor(() => expect(screen.getByText('No matches')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
  });
});

describe('all hits in this filing', () => {
  it('lists every hit of the incoming Boolean query with its section and jumps to one', async () => {
    const { doc, frame } = setup('"material weakness"');
    await waitFor(() => expect(screen.getByText(/2 hits of the Boolean query/)).toBeInTheDocument());
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Item 1 · Business');
    expect(items[1]).toHaveTextContent('Item 9A · Controls and Procedures');
    expect(items[1]).toHaveTextContent('The material weakness was remediated.');

    fireEvent.click(items[1].querySelector('button')!);
    const focus = doc.querySelectorAll('mark[data-vara-hit-focus]');
    expect(Array.from(focus).map(mark => mark.textContent).join('')).toBe('material weakness');
    expect(items[1].querySelector('button')).toHaveAttribute('aria-current', 'true');
    expect(frame.scrollTo).toHaveBeenCalled();
  });

  it('says so when the query has no hits in the document', async () => {
    setup('goodwill W/5 impairment');
    await waitFor(() => expect(screen.getByText("No hits of the Boolean query in this document's text.")).toBeInTheDocument());
  });
});
