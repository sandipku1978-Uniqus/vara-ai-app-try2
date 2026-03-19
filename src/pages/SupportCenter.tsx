import { useState } from 'react';
import { Search, Book, Video, MessageSquare, ArrowRight, PlayCircle } from 'lucide-react';
import './SupportCenter.css';

export default function SupportCenter() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="support-container">
      <div className="support-header">
        <h1>How can we help you today?</h1>
        <div className="support-search-wrapper">
          <Search className="support-search-icon" size={20} />
          <input
            type="text"
            placeholder="Search for articles, tutorials, or FAQs..."
          />
        </div>
      </div>

      <div className="support-grid">
        <div className="support-card glass-card" onClick={() => setChatOpen(true)}>
          <div className="icon-wrapper blue">
            <MessageSquare size={28} />
          </div>
          <h3>Live Chat Support</h3>
          <p>Connect instantly with our product experts and specialized SEC analysts.</p>
          <span className="card-link blue">
            Start Chat <ArrowRight size={14} />
          </span>
        </div>

        <div className="support-card glass-card">
          <div className="icon-wrapper purple">
            <Book size={28} />
          </div>
          <h3>Knowledge Base</h3>
          <p>Read detailed guides on advanced Boolean search and XBRL extraction.</p>
          <span className="card-link purple">
            Browse Articles <ArrowRight size={14} />
          </span>
        </div>

        <div className="support-card glass-card">
          <div className="icon-wrapper green">
            <Video size={28} />
          </div>
          <h3>Video Training</h3>
          <p>Watch on-demand webinars and quick-start feature walkthroughs.</p>
          <span className="card-link green">
            Watch Videos <ArrowRight size={14} />
          </span>
        </div>
      </div>

      <div className="tutorials-section">
        <h2>Popular Tutorials</h2>
        <div className="tutorials-grid">
          <div className="tutorial-card">
            <div className="tutorial-thumb">
              <PlayCircle size={40} />
            </div>
            <div className="tutorial-info">
              <h4>Mastering the Section Matrix</h4>
              <p>Learn how to compare Risk Factors across 10 peers simultaneously using our AI redlining tool.</p>
            </div>
          </div>
          <div className="tutorial-card">
            <div className="tutorial-thumb">
              <PlayCircle size={40} />
            </div>
            <div className="tutorial-info">
              <h4>Exporting Custom Financial Data</h4>
              <p>A guide to extracting specific XBRL metrics directly into CSV datasets for modeling.</p>
            </div>
          </div>
        </div>
      </div>

      {chatOpen && (
        <div className="chat-widget">
          <div className="chat-widget-header" onClick={() => setChatOpen(false)}>
            <div className="chat-widget-header-info">
              <div className="chat-agent-avatar">
                CS
                <div className="online-dot"></div>
              </div>
              <div>
                <div className="chat-agent-name">Customer Success</div>
                <div className="chat-agent-status">Typically replies in under 2m</div>
              </div>
            </div>
          </div>
          <div className="chat-widget-body">
            <div className="chat-bubble-agent">
              Hi there! I'm Sarah from the Client Success team. How can I help you navigate Vara AI today?
            </div>
          </div>
          <div className="chat-widget-input">
            <input type="text" placeholder="Type a message..." />
          </div>
        </div>
      )}
    </div>
  );
}
