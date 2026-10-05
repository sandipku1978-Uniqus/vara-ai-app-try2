/**
 * Server-side storage of the issue-level split (urc_letter_issues, migration
 * 027), stored the way episode summaries are: one row per Staff letter of an
 * episode, keyed by (thread_id, staff_accession), regenerated whenever the
 * episode's letter set or any letter's text changes (episode_fingerprint) or
 * the parser changes (parser_version). Node-only (hashing); the split itself
 * is the pure services/commentIssues.ts.
 */

import { createHash } from 'node:crypto';
import {
  buildEpisodeIssues,
  COMMENT_ISSUES_PARSER_VERSION,
  orderEpisodeLetters,
  type CommentIssue,
  type EpisodeIssues,
  type IssueLetter,
  type StaffLetterIssues,
  type StaffLetterKind,
} from './commentIssues';

export interface LetterIssueRow {
  thread_id: string;
  staff_accession: string;
  cik: number;
  staff_date: string;
  round: number;
  letter_kind: StaffLetterKind;
  issues: CommentIssue[];
  parser_version: number;
  episode_fingerprint: string;
  generated_at: string;
}

/** sha256 over every letter's identity and text, in reading order. */
export function episodeFingerprint(letters: IssueLetter[]): string {
  const hash = createHash('sha256');
  for (const letter of orderEpisodeLetters(letters)) {
    hash.update(letter.accession);
    hash.update('\0');
    hash.update(String(letter.form));
    hash.update('\0');
    hash.update(String(letter.date_filed).slice(0, 10));
    hash.update('\0');
    hash.update(letter.content ?? '[missing]');
    hash.update('\0\0');
  }
  return hash.digest('hex');
}

export function issueRowsFromEpisode(
  threadId: string,
  episode: EpisodeIssues,
  fingerprint: string,
  generatedAt: string
): LetterIssueRow[] {
  return episode.letters.map(letter => ({
    thread_id: threadId,
    staff_accession: letter.staffAccession,
    cik: Number(letter.cik),
    staff_date: letter.staffDate,
    round: letter.round,
    letter_kind: letter.kind,
    issues: letter.issues,
    parser_version: episode.parserVersion,
    episode_fingerprint: fingerprint,
    generated_at: generatedAt,
  }));
}

/**
 * Stored rows are current only if every Staff letter of the episode has a
 * row from this parser version over exactly this letter set and text.
 */
export function storedIssuesAreCurrent(
  rows: Array<Pick<LetterIssueRow, 'staff_accession' | 'parser_version' | 'episode_fingerprint'>>,
  letters: IssueLetter[],
  fingerprint: string
): boolean {
  const staff = letters.filter(letter => letter.form.toUpperCase() === 'UPLOAD').map(letter => letter.accession).sort();
  const stored = rows.map(row => row.staff_accession).sort();
  return staff.length > 0
    && staff.length === stored.length
    && staff.every((accession, index) => accession === stored[index])
    && rows.every(row => Number(row.parser_version) === COMMENT_ISSUES_PARSER_VERSION && row.episode_fingerprint === fingerprint);
}

/** Rebuild the episode view from stored rows; coverage is counted from the letters on file. */
export function episodeFromRows(rows: LetterIssueRow[], letters: IssueLetter[]): EpisodeIssues {
  const ordered = [...rows].sort((a, b) => a.round - b.round);
  const staffLetters: StaffLetterIssues[] = ordered.map(row => ({
    staffAccession: row.staff_accession,
    staffDate: String(row.staff_date).slice(0, 10),
    cik: String(row.cik),
    round: row.round,
    kind: row.letter_kind,
    issues: Array.isArray(row.issues) ? row.issues : [],
  }));
  const closing = staffLetters.find(letter => letter.kind === 'review-complete');
  const responses = letters.filter(letter => letter.form.toUpperCase() === 'CORRESP');
  const staff = letters.filter(letter => letter.form.toUpperCase() === 'UPLOAD');
  const issues = staffLetters.flatMap(letter => letter.issues);
  return {
    parserVersion: COMMENT_ISSUES_PARSER_VERSION,
    letters: staffLetters,
    closedBy: closing ? { accession: closing.staffAccession, date_filed: closing.staffDate } : null,
    coverage: {
      staffLetters: staff.length,
      staffLettersWithText: staff.filter(letter => Boolean(letter.content)).length,
      responseLetters: responses.length,
      responseLettersWithText: responses.filter(letter => Boolean(letter.content)).length,
      issues: issues.length,
      issuesWithResponse: issues.filter(issue => issue.response).length,
    },
  };
}

export function computeEpisodeIssues(letters: IssueLetter[]): { episode: EpisodeIssues; fingerprint: string } {
  return { episode: buildEpisodeIssues(letters), fingerprint: episodeFingerprint(letters) };
}
