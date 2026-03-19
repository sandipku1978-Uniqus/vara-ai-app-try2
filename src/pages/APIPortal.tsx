import { useState } from 'react';
import { Key, Database, Zap, BookOpen, Copy, CheckCircle2 } from 'lucide-react';
import './APIPortal.css';

export default function APIPortal() {
  const [activeTab, setActiveTab] = useState<'overview' | 'docs' | 'keys'>('overview');
  const [copied, setCopied] = useState(false);

  const handleCopyCode = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="api-container">
      <div className="api-header">
        <div className="api-title">
          <h1>API Data Integration Portal</h1>
          <p>Connect your internal systems directly to our normalized SEC XBRL and full-text databases.</p>
        </div>
        <button className="primary-btn sm shadow-lg shadow-blue-500/20" onClick={() => alert('API Key Generated! Your new key would appear in the API Keys & Usage tab. (Demo)')}><Key size={16}/> Generate New Key</button>
      </div>

      <div className="api-layout">
        <aside className="api-sidebar glass-card">
          <nav className="api-nav">
            <button 
              className={`nav-btn ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <Zap size={18} /> Quick Start
            </button>
            <button 
              className={`nav-btn ${activeTab === 'docs' ? 'active' : ''}`}
              onClick={() => setActiveTab('docs')}
            >
              <BookOpen size={18} /> Endpoints Reference
            </button>
            <button 
              className={`nav-btn ${activeTab === 'keys' ? 'active' : ''}`}
              onClick={() => setActiveTab('keys')}
            >
              <Key size={18} /> API Keys & Usage
            </button>
          </nav>

          <div className="sidebar-widget mt-8">
            <h4>System Status</h4>
            <div className="status-item mt-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
              <span className="text-sm font-medium text-slate-300">Search Endpoint</span>
              <span className="text-xs text-slate-500 ml-auto">99.9%</span>
            </div>
            <div className="status-item mt-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
              <span className="text-sm font-medium text-slate-300">XBRL Facts</span>
              <span className="text-xs text-slate-500 ml-auto">99.9%</span>
            </div>
          </div>
        </aside>

        <main className="api-main glass-card overflow-auto">
          {activeTab === 'overview' && (
            <div className="tab-pane fade-in">
              <div className="pane-header mb-6">
                <h2>Quick Start Guide</h2>
                <p className="text-sm text-slate-400 mt-1">Get up and running with the Intelligize+ REST API in minutes.</p>
              </div>

              <div className="space-y-6">
                <div className="text-content bg-slate-900/50 border border-slate-700 p-6 rounded-xl">
                  <h3 className="text-white text-lg font-medium mb-3 flex items-center gap-2"><Database size={20} className="text-blue-400"/> Normalized Data Infrastructure</h3>
                  <p className="text-slate-400 text-sm leading-relaxed mb-4">
                    Our endpoints sit on top of the SEC EDGAR system, parsing unstructured HTML and arcane XBRL into clean, predictable JSON schemas. We handle the rate limiting, caching, and taxonomy mapping so your quants can focus on modeling.
                  </p>
                  
                  <div className="code-block-container mt-4 relative">
                    <div className="code-header bg-slate-900 border-b border-slate-700 px-4 py-2 flex justify-between items-center rounded-t-lg">
                      <span className="text-xs font-mono text-slate-400">cURL EXAMPlE</span>
                      <button onClick={handleCopyCode} className="text-slate-400 hover:text-white transition-colors">
                        {copied ? <CheckCircle2 size={14} className="text-green-400"/> : <Copy size={14}/>}
                      </button>
                    </div>
                    <pre className="bg-slate-950 p-4 rounded-b-lg overflow-x-auto text-sm font-mono text-blue-300">
                      <code>
{`curl -X GET "https://api.intelligize-plus.com/v1/filings/search?q=cybersecurity&formType=10-K" \\
-H "Authorization: Bearer YOUR_API_KEY"`}
                      </code>
                    </pre>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-slate-900/50 border border-slate-700 p-5 rounded-xl">
                    <h4 className="font-semibold text-white mb-2">Python SDK Available</h4>
                    <p className="text-sm text-slate-400 mb-4">Install our official Python SDK for drop-in Pandas DataFrame compatibility.</p>
                    <code className="bg-slate-950 px-3 py-1.5 rounded text-sm font-mono text-blue-300 border border-slate-700 block">pip install intelligize-sec-api</code>
                  </div>
                  <div className="bg-slate-900/50 border border-slate-700 p-5 rounded-xl">
                    <h4 className="font-semibold text-white mb-2">Webhook Subscriptions</h4>
                    <p className="text-sm text-slate-400 mb-4">Register webhook URLs to receive push notifications the second a targeted filing drops on EDGAR.</p>
                    <button className="text-sm text-blue-400 font-medium mt-auto" onClick={() => alert('Webhook Documentation: Configure push notifications for real-time filing alerts via POST callbacks to your endpoint.')}>View Webhook Docs →</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'docs' && (
            <div className="tab-pane fade-in">
              <div className="pane-header mb-6">
                <h2>Endpoints Reference</h2>
                <p className="text-sm text-slate-400 mt-1">Interactive documentation for core REST endpoints.</p>
              </div>

              <div className="space-y-4">
                <div className="endpoint-item bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="endpoint-header bg-slate-800/50 p-4 border-b border-slate-700 flex items-center justify-between cursor-pointer">
                    <div className="flex items-center gap-3">
                      <span className="bg-blue-600 font-mono text-xs text-white px-2 py-1 rounded font-bold">GET</span>
                      <span className="font-mono text-sm text-slate-300">/v1/filings/search</span>
                    </div>
                    <span className="text-xs text-slate-400">Full-text search across EDGAR</span>
                  </div>
                  <div className="endpoint-body p-4 bg-slate-900">
                    <p className="text-sm text-slate-400 mb-4">Returns an array of filing objects matching the boolean or semantic query string.</p>
                    <h5 className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-2">Parameters</h5>
                    <table className="w-full text-left text-sm text-slate-400">
                      <tbody>
                        <tr className="border-b border-slate-800"><td className="py-2 font-mono text-blue-300 w-32">q</td><td className="py-2">Search query (required)</td></tr>
                        <tr className="border-b border-slate-800"><td className="py-2 font-mono text-blue-300">formType</td><td className="py-2">Filter by 10-K, 8-K, etc (optional)</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="endpoint-item bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="endpoint-header bg-slate-800/50 p-4 border-b border-slate-700 flex items-center justify-between cursor-pointer">
                    <div className="flex items-center gap-3">
                      <span className="bg-blue-600 font-mono text-xs text-white px-2 py-1 rounded font-bold">GET</span>
                      <span className="font-mono text-sm text-slate-300">/v1/xbrl/companyfacts/&#123;cik&#125;</span>
                    </div>
                    <span className="text-xs text-slate-400">Retrieve all financial facts for a CIK</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'keys' && (
            <div className="tab-pane fade-in">
               <div className="pane-header mb-6">
                <h2>API Keys & Usage</h2>
                <p className="text-sm text-slate-400 mt-1">Manage your API credentials and monitor usage limits.</p>
              </div>

              <div className="bg-slate-900/50 border border-slate-700 p-5 rounded-xl mb-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-white font-medium">Production Key</h3>
                  <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs">Active</span>
                </div>
                <div className="flex items-center gap-2 bg-slate-950 p-3 rounded border border-slate-800">
                  <span className="font-mono text-sm text-slate-400 tracking-wider">sk_live_································</span>
                  <button className="ml-auto text-blue-400 hover:text-blue-300 text-sm" onClick={() => alert('Use your real API key from the secured backend or environment settings.')}>Reveal</button>
                </div>
              </div>

              <div className="bg-slate-900/50 border border-slate-700 p-5 rounded-xl">
                 <h3 className="text-white font-medium mb-4">Current Billing Cycle Usage</h3>
                 <div className="flex justify-between text-sm mb-2">
                    <span className="text-slate-400">Total Requests (June)</span>
                    <span className="text-white font-mono">14,204 / 50,000</span>
                 </div>
                 <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-blue-500 h-full" style={{width: '28%'}}></div>
                 </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
