import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { X, Send, Bot, User, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppState';
import ResponsibleAIBanner from './ResponsibleAIBanner';
import { renderMarkdown } from '../utils/markdownRenderer';
import './AIQnA.css';

import { askGemini } from '../services/geminiApi';

export function AIQnAPanel() {
  const { isChatOpen, setChatOpen, chatHistory, addChatMessage, currentFilingContext } = useApp();
  const location = useLocation();
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isChatOpen, isTyping]);

  if (!isChatOpen) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isTyping) return;

    addChatMessage({
      role: 'user',
      content: inputValue
    });
    
    const userQ = inputValue;
    setInputValue('');
    setIsTyping(true);

    try {
      let context = '';
      if (currentFilingContext) {
        context = `User is viewing a ${currentFilingContext.formType || 'SEC'} filing for ${currentFilingContext.companyName || 'a company'} (CIK: ${currentFilingContext.cik}), filed ${currentFilingContext.filingDate || 'unknown date'}. Accession: ${currentFilingContext.accessionNumber}. Document: ${currentFilingContext.primaryDocument}.`;
      } else {
        const path = location.pathname;
        const pageContextMap: Record<string, string> = {
          '/dashboard': 'User is on the Dashboard viewing watchlist companies, filing volume trends, and market overview.',
          '/search': 'User is on the Research Search page querying SEC EDGAR filings.',
          '/compare': 'User is on the Benchmarking page comparing financial metrics across peer companies.',
          '/boards': 'User is on the Board Profiles page analyzing corporate governance, director data, and executive compensation.',
          '/esg': 'User is on the ESG Research page analyzing environmental, social, and governance disclosures.',
          '/ipo': 'User is on the IPO Center analyzing S-1 registration statements and IPO pipeline data.',
          '/mna': 'User is on the M&A Research page reviewing merger agreements, deal data, and clause analysis.',
          '/accounting': 'User is on the Accounting Standards Hub looking up US GAAP / ASC guidance.',
          '/api-portal': 'User is on the API Portal page.',
        };
        context = pageContextMap[path] || 'User is browsing the Vara AI SEC Intelligence Platform.';
      }
      const aiResponseText = await askGemini(userQ, context);
      
      addChatMessage({
        role: 'ai',
        content: aiResponseText
      });
    } catch (e) {
      addChatMessage({
        role: 'ai',
        content: "Sorry, I encountered an error connecting to Gemini 2.5 Flash."
      });
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="ai-panel glass-card">
      <div className="ai-panel-header">
        <div className="ai-title">
          <Sparkles size={18} className="ai-icon" />
          <span>Vara AI AI</span>
        </div>
        <button className="icon-btn-small" onClick={() => setChatOpen(false)}>
          <X size={18} />
        </button>
      </div>

      <div className="ai-chat-history">
        {chatHistory.map(msg => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            <div className="chat-avatar">
              {msg.role === 'ai' ? <Bot size={16} /> : <User size={16} />}
            </div>
            {msg.role === 'ai' ? (
              <div className="chat-bubble md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
            ) : (
              <div className="chat-bubble">{msg.content}</div>
            )}
          </div>
        ))}
        {isTyping && (
          <div className="chat-message ai">
            <div className="chat-avatar"><Bot size={16} /></div>
            <div className="chat-bubble typing-indicator">
               Gemini is thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <ResponsibleAIBanner />

      <form className="ai-input-area mt-4" onSubmit={handleSend}>
        <input 
          type="text" 
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          placeholder="Ask a question about SEC filings..." 
        />
        <button type="submit" disabled={!inputValue.trim()} className="send-btn">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
