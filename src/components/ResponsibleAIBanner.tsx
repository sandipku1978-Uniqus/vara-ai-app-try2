import { Info } from 'lucide-react';

export default function ResponsibleAIBanner() {
  return (
    <div className="flex items-center gap-2 bg-blue-900/20 border border-blue-500/20 text-blue-200/80 p-3 rounded-lg text-xs mt-4">
      <Info size={14} className="flex-shrink-0 text-blue-400" />
      <p>
        <strong>Protégé AI</strong> generates responses based on public SEC filings and available accounting standards. 
        It does not constitute formal legal or financial advice. Always verify critical data against the original source documents.
      </p>
    </div>
  );
}
