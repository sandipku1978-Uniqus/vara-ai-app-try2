import ifrsKnowledgeBase from '../data/standards/ifrs-kb.json';
import indAsKnowledgeBase from '../data/standards/ind-as-kb.json';

type Framework = 'IFRS' | 'Ind AS';

function formatStandards(
  label: Framework,
  knowledgeBase: { standards: Array<{ id: string; keyDifferences: string[] }> }
): string {
  return `\n${label} Context: ${knowledgeBase.standards
    .map(standard => `${standard.id}: ${standard.keyDifferences.join(' ')}`)
    .join('\n')}`;
}

export function buildFrameworkContext(frameworks: Framework[]): string {
  let context = '';
  if (frameworks.includes('IFRS')) context += formatStandards('IFRS', ifrsKnowledgeBase);
  if (frameworks.includes('Ind AS')) context += formatStandards('Ind AS', indAsKnowledgeBase);
  return context;
}
