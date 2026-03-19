import { useState } from 'react';
import { Filter, X, ChevronDown, ChevronRight } from 'lucide-react';
import CompanySearchInput from './CompanySearchInput';
import './AdvancedFilterPanel.css';

export interface FilterState {
  companies: { ticker: string; cik: string }[];
  formTypes: string[];
  dateFrom: string;
  dateTo: string;
  sicCodes: string[];
  stateOfInc: string[];
  exchange: string[];
  acceleratedStatus: Record<string, boolean>;
  keyword: string;
}

export const defaultFilterState: FilterState = {
  companies: [],
  formTypes: [],
  dateFrom: '',
  dateTo: '',
  sicCodes: [],
  stateOfInc: [],
  exchange: [],
  acceleratedStatus: {},
  keyword: '',
};

export interface FilterPanelConfig {
  showCompanySearch?: boolean;
  showFormTypes?: boolean;
  showDateRange?: boolean;
  showIndustry?: boolean;
  showStateOfInc?: boolean;
  showExchange?: boolean;
  showAcceleratedStatus?: boolean;
  showKeyword?: boolean;
  formTypeOptions?: string[];
  title?: string;
}

const EXCHANGES = ['NYSE', 'NASDAQ', 'AMEX', 'CBOE', 'OTC'];
const ACCEL_STATUS = [
  { key: 'bdc', label: 'Business Dev Company (BDC)' },
  { key: 'egc', label: 'Emerging Growth (EGC)' },
  { key: 'fpi', label: 'Foreign Private Issuer (FPI)' },
  { key: 'investment', label: 'Investment Company' },
  { key: 'reit', label: 'REIT' },
  { key: 'shell', label: 'Shell Company' },
  { key: 'src', label: 'Smaller Reporting (SRC)' },
  { key: 'spac', label: 'SPAC' },
  { key: 'wksi', label: 'Well-Known Seasoned (WKSI)' },
];

interface Props {
  config: FilterPanelConfig;
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  onApply?: () => void;
}

export default function AdvancedFilterPanel({ config, filters, onChange, onApply }: Props) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    company: true, formType: true, date: true, industry: false, state: false, exchange: false, accelStatus: false
  });

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleAddCompany = (ticker: string, cik: string) => {
    if (!filters.companies.find(c => c.ticker === ticker)) {
      onChange({ ...filters, companies: [...filters.companies, { ticker, cik }] });
    }
  };

  const handleRemoveCompany = (ticker: string) => {
    onChange({ ...filters, companies: filters.companies.filter(c => c.ticker !== ticker) });
  };

  const toggleFormType = (ft: string) => {
    const has = filters.formTypes.includes(ft);
    onChange({ ...filters, formTypes: has ? filters.formTypes.filter(f => f !== ft) : [...filters.formTypes, ft] });
  };

  const toggleExchange = (ex: string) => {
    const has = filters.exchange.includes(ex);
    onChange({ ...filters, exchange: has ? filters.exchange.filter(e => e !== ex) : [...filters.exchange, ex] });
  };

  const toggleAccelStatus = (key: string) => {
    onChange({ ...filters, acceleratedStatus: { ...filters.acceleratedStatus, [key]: !filters.acceleratedStatus[key] } });
  };

  const handleClearAll = () => {
    onChange({ ...defaultFilterState });
  };

  const activeCount = filters.companies.length + filters.formTypes.length +
    (filters.dateFrom ? 1 : 0) + filters.exchange.length +
    Object.values(filters.acceleratedStatus).filter(Boolean).length +
    (filters.keyword ? 1 : 0);

  return (
    <div className="adv-filter-panel">
      <div className="afp-header">
        <div className="afp-title">
          <Filter size={16} />
          <span>{config.title || 'Filters'}</span>
          {activeCount > 0 && <span className="afp-count">{activeCount}</span>}
        </div>
        {activeCount > 0 && (
          <button className="afp-clear" onClick={handleClearAll}>Clear All</button>
        )}
      </div>

      {config.showKeyword !== false && (
        <div className="afp-section">
          <input
            type="text"
            placeholder="Keyword search..."
            value={filters.keyword}
            onChange={e => onChange({ ...filters, keyword: e.target.value })}
            className="afp-keyword-input"
          />
        </div>
      )}

      {config.showCompanySearch !== false && (
        <div className="afp-section">
          <div className="afp-section-header" onClick={() => toggleSection('company')}>
            {expandedSections.company ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Company List & Peers</span>
          </div>
          {expandedSections.company && (
            <div className="afp-section-body">
              <CompanySearchInput onSelect={handleAddCompany} placeholder="Add company..." />
              {filters.companies.length > 0 && (
                <div className="afp-chips">
                  {filters.companies.map(c => (
                    <span key={c.ticker} className="afp-chip">
                      {c.ticker}
                      <button onClick={() => handleRemoveCompany(c.ticker)}><X size={10} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {config.showFormTypes !== false && (
        <div className="afp-section">
          <div className="afp-section-header" onClick={() => toggleSection('formType')}>
            {expandedSections.formType ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Form Type</span>
          </div>
          {expandedSections.formType && (
            <div className="afp-section-body">
              <div className="afp-checkboxes">
                {(config.formTypeOptions || ['10-K', '10-Q', '8-K', 'S-1', 'DEF 14A', '20-F', 'SC 13D']).map(ft => (
                  <label key={ft} className="afp-checkbox">
                    <input type="checkbox" checked={filters.formTypes.includes(ft)} onChange={() => toggleFormType(ft)} />
                    <span>{ft}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {config.showDateRange !== false && (
        <div className="afp-section">
          <div className="afp-section-header" onClick={() => toggleSection('date')}>
            {expandedSections.date ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Date Filed</span>
          </div>
          {expandedSections.date && (
            <div className="afp-section-body">
              <div className="afp-date-row">
                <input type="date" value={filters.dateFrom} onChange={e => onChange({ ...filters, dateFrom: e.target.value })} className="afp-date-input" />
                <span style={{ color: '#64748B', fontSize: '0.75rem' }}>to</span>
                <input type="date" value={filters.dateTo} onChange={e => onChange({ ...filters, dateTo: e.target.value })} className="afp-date-input" />
              </div>
            </div>
          )}
        </div>
      )}

      {config.showExchange && (
        <div className="afp-section">
          <div className="afp-section-header" onClick={() => toggleSection('exchange')}>
            {expandedSections.exchange ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Exchange</span>
          </div>
          {expandedSections.exchange && (
            <div className="afp-section-body">
              <div className="afp-checkboxes">
                {EXCHANGES.map(ex => (
                  <label key={ex} className="afp-checkbox">
                    <input type="checkbox" checked={filters.exchange.includes(ex)} onChange={() => toggleExchange(ex)} />
                    <span>{ex}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {config.showAcceleratedStatus && (
        <div className="afp-section">
          <div className="afp-section-header" onClick={() => toggleSection('accelStatus')}>
            {expandedSections.accelStatus ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Accelerated Status</span>
          </div>
          {expandedSections.accelStatus && (
            <div className="afp-section-body">
              <div className="afp-checkboxes">
                {ACCEL_STATUS.map(s => (
                  <label key={s.key} className="afp-checkbox">
                    <input type="checkbox" checked={!!filters.acceleratedStatus[s.key]} onChange={() => toggleAccelStatus(s.key)} />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {onApply && (
        <button className="afp-apply-btn" onClick={onApply}>
          Apply Filters
        </button>
      )}
    </div>
  );
}
