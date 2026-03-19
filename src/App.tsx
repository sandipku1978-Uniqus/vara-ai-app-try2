import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppState';
import { Layout } from './components/layout/Layout';
import { AIQnAPanel } from './components/AIQnAPanel';

import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';
import SearchPage from './pages/SearchPage';
import FilingDetail from './pages/FilingDetail';
import Benchmarking from './pages/Benchmarking';

// Reporting & Benchmarking
import AccountingHub from './pages/AccountingHub';
import ESGResearch from './pages/ESGResearch';
import BoardProfiles from './pages/BoardProfiles';
import InsiderTrading from './pages/InsiderTrading';

// Business Intelligence
import AccountingAnalytics from './pages/AccountingAnalytics';
import EarningsTranscripts from './pages/EarningsTranscripts';

// Regulation & Compliance
import SecRegulation from './pages/SecRegulation';
import CommentLetters from './pages/CommentLetters';
import NoActionLetters from './pages/NoActionLetters';
import SECEnforcement from './pages/SECEnforcement';

// Transactions
import IPOCenter from './pages/IPOCenter';
import MAResearch from './pages/MAResearch';
import ExhibitSearch from './pages/ExhibitSearch';
import ExemptOfferings from './pages/ExemptOfferings';
import ADVRegistrations from './pages/ADVRegistrations';

// Utilities
import APIPortal from './pages/APIPortal';
import SupportCenter from './pages/SupportCenter';

function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<LandingPage />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="filing/*" element={<FilingDetail />} />
            <Route path="compare" element={<Benchmarking />} />

            {/* Reporting & Benchmarking */}
            <Route path="accounting" element={<AccountingHub />} />
            <Route path="esg" element={<ESGResearch />} />
            <Route path="boards" element={<BoardProfiles />} />
            <Route path="insiders" element={<InsiderTrading />} />

            {/* Business Intelligence */}
            <Route path="accounting-analytics" element={<AccountingAnalytics />} />
            <Route path="earnings" element={<EarningsTranscripts />} />

            {/* Regulation & Compliance */}
            <Route path="regulation" element={<SecRegulation />} />
            <Route path="comment-letters" element={<CommentLetters />} />
            <Route path="no-action-letters" element={<NoActionLetters />} />
            <Route path="enforcement" element={<SECEnforcement />} />

            {/* Transactions */}
            <Route path="ipo" element={<IPOCenter />} />
            <Route path="mna" element={<MAResearch />} />
            <Route path="exhibits" element={<ExhibitSearch />} />
            <Route path="exempt-offerings" element={<ExemptOfferings />} />
            <Route path="adv-registrations" element={<ADVRegistrations />} />

            {/* Utilities */}
            <Route path="api-portal" element={<APIPortal />} />
            <Route path="support" element={<SupportCenter />} />
          </Route>
        </Routes>
        <AIQnAPanel />
      </BrowserRouter>
    </AppProvider>
  );
}

export default App;
