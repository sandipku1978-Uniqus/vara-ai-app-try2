/**
 * Real SEC comment-letter episodes fetched from EDGAR (UPLOAD / CORRESP
 * submissions), extracted with the ingest pipeline's own extractor
 * (data-pipeline/fetch-letter-text.ts → extractLetterText), so each fixture
 * is the text urc_comment_letters.content holds for that accession.
 * episodes.json lists each episode's letters with accession, form, filing
 * date and SEC index URL; every text file is named by its accession.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IssueLetter } from '../../../services/commentIssues';

interface ManifestLetter {
  accession: string;
  form: string;
  date_filed: string;
  source: string;
}

interface ManifestEpisode {
  company: string;
  cik: number;
  review: string;
  letters: ManifestLetter[];
}

const directory = resolve(process.cwd(), 'src/__tests__/fixtures/letters');

export const EPISODES = JSON.parse(readFileSync(resolve(directory, 'episodes.json'), 'utf8')) as Record<string, ManifestEpisode>;

export function letterText(accession: string): string {
  return readFileSync(resolve(directory, `${accession}.txt`), 'utf8');
}

export function loadEpisode(name: string): IssueLetter[] {
  const episode = EPISODES[name];
  if (!episode) throw new Error(`unknown fixture episode ${name}`);
  return episode.letters.map(letter => ({
    accession: letter.accession,
    cik: episode.cik,
    form: letter.form,
    date_filed: letter.date_filed,
    content: letterText(letter.accession),
  }));
}
