'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import {
  findTextMatches,
  formatMatchCount,
  isFindShortcut,
  locateQueryHits,
  stepMatchIndex,
  type DocumentQueryHits,
} from '../utils/documentFind';
import {
  buildDocumentTextMap,
  clearMarks,
  FIND_MATCH_ATTRIBUTE,
  QUERY_FOCUS_ATTRIBUTE,
  scrollFrameToElement,
  styleFindMatch,
  styleQueryFocus,
  wrapRanges,
} from '../services/documentFindDom';

interface UseDocumentFindOptions {
  /** The viewer's sandboxed document frame. */
  frameRef: RefObject<HTMLIFrameElement | null>;
  /** Changes every time a document finishes loading into the frame. */
  loadToken: number;
  /** Boolean expression of the search that opened this filing ('' for none). */
  hitQuery: string;
}

export interface QueryHitsState extends DocumentQueryHits {
  loading: boolean;
}

const IDLE_HITS: QueryHitsState = { status: 'no-match', total: 0, hits: [], loading: false };

/**
 * Find bar and incoming-query hit list for the filing viewer. All document
 * access goes through the frame's contentDocument from this (parent) page;
 * the frame itself stays inert.
 */
export function useDocumentFind({ frameRef, loadToken, hitQuery }: UseDocumentFindOptions) {
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [wholeWord, setWholeWord] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [queryHits, setQueryHits] = useState<QueryHitsState>(IDLE_HITS);
  const [focusedHit, setFocusedHit] = useState(-1);

  const findInputRef = useRef<HTMLInputElement>(null);
  const findMarksRef = useRef<HTMLElement[][]>([]);
  const activeRef = useRef(-1);

  // Typing re-highlights after a short pause, not on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedQuery(findQuery), 120);
    return () => window.clearTimeout(timer);
  }, [findQuery]);

  const activate = useCallback((index: number) => {
    const marks = findMarksRef.current;
    const previous = activeRef.current;
    if (previous >= 0) marks[previous]?.forEach(mark => styleFindMatch(mark, false));
    activeRef.current = index;
    setActiveIndex(index);
    if (index >= 0 && marks[index]?.length) {
      marks[index].forEach(mark => styleFindMatch(mark, true));
      scrollFrameToElement(frameRef.current, marks[index][0]);
    }
  }, [frameRef]);

  // Find matches: clear, re-find, re-mark whenever the query, the whole-word
  // rule, or the document changes.
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    findMarksRef.current = [];
    activeRef.current = -1;
    if (doc) clearMarks(doc, FIND_MATCH_ATTRIBUTE);
    if (!doc?.body || !findOpen || !appliedQuery.trim()) {
      setMatchCount(0);
      setTruncated(false);
      setActiveIndex(-1);
      return;
    }
    const map = buildDocumentTextMap(doc);
    const found = findTextMatches(map.text, appliedQuery, { wholeWord });
    findMarksRef.current = wrapRanges(doc, map, found.ranges, FIND_MATCH_ATTRIBUTE, mark => styleFindMatch(mark, false));
    setMatchCount(found.ranges.length);
    setTruncated(found.truncated);
    activate(found.ranges.length > 0 ? 0 : -1);
  }, [activate, appliedQuery, findOpen, frameRef, loadToken, wholeWord]);

  // Every hit of the incoming query, once per loaded document. Deferred one
  // tick so the document paints before a long filing is tokenized.
  useEffect(() => {
    setFocusedHit(-1);
    if (!hitQuery.trim()) {
      setQueryHits(IDLE_HITS);
      return;
    }
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body || loadToken === 0) {
      setQueryHits({ ...IDLE_HITS, loading: true });
      return;
    }
    setQueryHits(current => ({ ...current, loading: true }));
    const timer = window.setTimeout(() => {
      const map = buildDocumentTextMap(doc);
      setQueryHits({ ...locateQueryHits(map.text, hitQuery), loading: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [frameRef, hitQuery, loadToken]);

  const focusQueryHit = useCallback((index: number) => {
    const doc = frameRef.current?.contentDocument;
    const hit = queryHits.hits[index];
    if (!doc?.body || !hit) return;
    clearMarks(doc, QUERY_FOCUS_ATTRIBUTE);
    const map = buildDocumentTextMap(doc);
    const [marks] = wrapRanges(doc, map, [hit], QUERY_FOCUS_ATTRIBUTE, styleQueryFocus);
    setFocusedHit(index);
    scrollFrameToElement(frameRef.current, marks?.[0]);
  }, [frameRef, queryHits.hits]);

  const openFind = useCallback(() => {
    // Seed from a short selection in the document, as browsers do.
    const selection = frameRef.current?.contentDocument?.getSelection?.()?.toString().replace(/\s+/g, ' ').trim() || '';
    if (selection && selection.length <= 120) setFindQuery(selection);
    setFindOpen(true);
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, [frameRef]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    window.requestAnimationFrame(() => frameRef.current?.focus());
  }, [frameRef]);

  const step = useCallback((direction: 1 | -1) => {
    activate(stepMatchIndex(activeRef.current, findMarksRef.current.length, direction));
  }, [activate]);

  /** Cmd/Ctrl+F while the viewer (or the document inside it) has focus. */
  const handleShortcut = useCallback((event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'preventDefault'>) => {
    if (!isFindShortcut(event)) return;
    event.preventDefault();
    openFind();
  }, [openFind]);

  // Focus inside the frame sends key events to the frame's document, not to
  // this page, so the shortcut is listened for there too.
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const listener = (event: KeyboardEvent) => handleShortcut(event);
    doc.addEventListener('keydown', listener);
    return () => doc.removeEventListener('keydown', listener);
  }, [frameRef, handleShortcut, loadToken]);

  return {
    find: {
      open: findOpen,
      query: findQuery,
      setQuery: setFindQuery,
      wholeWord,
      toggleWholeWord: () => setWholeWord(value => !value),
      matchCount,
      countLabel: appliedQuery.trim() ? formatMatchCount(activeIndex, matchCount, truncated) : '',
      next: () => step(1),
      previous: () => step(-1),
      openFind,
      closeFind,
    },
    /** Attach to the find input; kept apart from `find`, which is render data. */
    findInputRef,
    hits: {
      ...queryHits,
      focusedIndex: focusedHit,
      focus: focusQueryHit,
    },
    handleShortcut,
  };
}
