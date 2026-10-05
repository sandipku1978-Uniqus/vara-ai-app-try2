/**
 * /accounting/[topic] — one accounting issue page per disclosure topic
 * (src/services/disclosureTopics.ts), e.g. /accounting/revenue-recognition.
 *
 * The set of issues is fixed and known at build time, so every page is
 * prerendered from generateStaticParams and any other segment is a 404
 * rather than an empty issue page. The panels load their evidence in the
 * browser, through the authenticated API routes, after the shell renders.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ACCOUNTING_ISSUES, findAccountingIssue } from '../../../config/accountingTopics';
import AccountingIssuePage from '../../../views/AccountingIssuePage';

export const dynamicParams = false;

export function generateStaticParams(): Array<{ topic: string }> {
  return ACCOUNTING_ISSUES.map(issue => ({ topic: issue.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }): Promise<Metadata> {
  const { topic } = await params;
  const issue = findAccountingIssue(topic);
  if (!issue) return { title: 'Accounting issue not found - Uniqus Research Center' };
  return {
    title: `${issue.label} - Accounting Issues - Uniqus Research Center`,
    description: `Precedent filings, SEC staff comments, authoritative references${issue.asc ? ` for ${issue.asc}` : ''}, internal guidance, and peer comparison for ${issue.label.toLowerCase()}.`,
  };
}

export default async function Page({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  if (!findAccountingIssue(topic)) notFound();
  return <AccountingIssuePage issueId={topic} />;
}
