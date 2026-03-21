import { useState } from 'react';
import { Filter, X, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import CompanyLookupField from './CompanyLookupField';
import SicLookupField from './SicLookupField';

export interface SearchFilters {
  keyword: string;
  dateFrom: string;
  dateTo: string;
  entityName: string;
  formTypes: string[];
  sectionKeywords: string;
  sicCode: string;
  stateOfInc: string;
  headquarters: string;
  exchange: string[];
  acceleratedStatus: string[];
  accountant: string;
  accessionNumber: string;
  fileNumber: string;
  fiscalYearEnd: string;
}

export const defaultSearchFilters: SearchFilters = {
  keyword: '',
  dateFrom: '',
  dateTo: '',
  entityName: '',
  formTypes: [],
  sectionKeywords: '',
  sicCode: '',
  stateOfInc: '',
  headquarters: '',
  exchange: [],
  acceleratedStatus: [],
  accountant: '',
  accessionNumber: '',
  fileNumber: '',
  fiscalYearEnd: '',
};

export interface SearchFilterBarConfig {
  showEntityName?: boolean;
  showDateRange?: boolean;
  showFormTypes?: boolean;
  showSectionKeywords?: boolean;
  showSIC?: boolean;
  showStateOfInc?: boolean;
  showHeadquarters?: boolean;
  showExchange?: boolean;
  showAcceleratedStatus?: boolean;
  showAccountant?: boolean;
  showAccessionNumber?: boolean;
  showFileNumber?: boolean;
  showFiscalYearEnd?: boolean;
  formTypeOptions?: string[];
}

const EXCHANGES = ['NYSE', 'NASDAQ', 'AMEX', 'CBOE', 'OTC'];
const ACCEL_STATUSES = [
  { key: 'LAF', label: 'Large Accelerated Filer' },
  { key: 'AF', label: 'Accelerated Filer' },
  { key: 'NAF', label: 'Non-Accelerated Filer' },
  { key: 'SRC', label: 'Smaller Reporting Co.' },
  { key: 'EGC', label: 'Emerging Growth Co.' },
  { key: 'WKSI', label: 'Well-Known Seasoned' },
  { key: 'FPI', label: 'Foreign Private Issuer' },
  { key: 'SPAC', label: 'SPAC' },
  { key: 'REIT', label: 'REIT' },
  { key: 'BDC', label: 'Business Dev Co. (BDC)' },
];
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];
const FY_ENDS = ['0131','0228','0331','0430','0531','0630','0731','0831','0930','1031','1130','1231'];
const FY_LABELS: Record<string, string> = {
  '0131':'Jan','0228':'Feb','0331':'Mar','0430':'Apr','0531':'May','0630':'Jun',
  '0731':'Jul','0831':'Aug','0930':'Sep','1031':'Oct','1130':'Nov','1231':'Dec',
};
const DATE_PRESETS = [3, 5, 10, 20, 30];

interface Props {
  config: SearchFilterBarConfig;
  filters: SearchFilters;
  onChange: (f: SearchFilters) => void;
  onSearch: () => void;
  loading?: boolean;
}

const inputStyle: React.CSSProperties = {
  padding: '7px 12px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  color: 'white',
  fontSize: '0.82rem',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  color: '#94A3B8',
  fontSize: '0.72rem',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.03em',
  marginBottom: '4px',
  display: 'block',
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 8px',
  borderRadius: '4px',
  background: 'rgba(59,130,246,0.12)',
  border: '1px solid rgba(59,130,246,0.3)',
  color: '#60A5FA',
  fontSize: '0.73rem',
  fontWeight: 500,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: '100%',
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  paddingRight: '28px',
};

const pillBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '3px 10px',
  borderRadius: '6px',
  border: `1px solid ${active ? '#3B82F6' : 'rgba(255,255,255,0.1)'}`,
  background: active ? 'rgba(59,130,246,0.12)' : 'transparent',
  color: active ? '#60A5FA' : '#94A3B8',
  cursor: 'pointer',
  fontSize: '0.76rem',
  fontWeight: active ? 600 : 400,
  transition: 'all 0.12s',
});

function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: open ? '12px' : '0' }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
        background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0',
        color: '#CBD5E1', fontSize: '0.8rem', fontWeight: 600, textAlign: 'left',
      }}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {title}
      </button>
      {open && <div style={{ paddingLeft: '4px' }}>{children}</div>}
    </div>
  );
}

export default function SearchFilterBar({ config, filters, onChange, onSearch, loading }: Props) {
  const [expanded, setExpanded] = useState(false);

  const applyDatePreset = (years: number) => {
    const end = new Date();
    const start = new Date();
    start.setFullYear(end.getFullYear() - years);
    onChange({
      ...filters,
      dateFrom: start.toISOString().split('T')[0],
      dateTo: end.toISOString().split('T')[0],
    });
  };

  const toggleList = (key: 'formTypes' | 'exchange' | 'acceleratedStatus', value: string) => {
    const current = filters[key];
    const has = current.includes(value);
    onChange({ ...filters, [key]: has ? current.filter((v: string) => v !== value) : [...current, value] });
  };

  const activeCount =
    (filters.entityName ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    filters.formTypes.length +
    (filters.sectionKeywords ? 1 : 0) +
    (filters.sicCode ? 1 : 0) +
    (filters.stateOfInc ? 1 : 0) +
    (filters.headquarters ? 1 : 0) +
    filters.exchange.length +
    filters.acceleratedStatus.length +
    (filters.accountant ? 1 : 0) +
    (filters.accessionNumber ? 1 : 0) +
    (filters.fileNumber ? 1 : 0) +
    (filters.fiscalYearEnd ? 1 : 0);

  const handleClear = () => {
    onChange({ ...defaultSearchFilters, keyword: filters.keyword });
  };

  // Build all active chips for the bottom bar
  const chips: { label: string; clear: () => void }[] = [];
  if (filters.entityName) chips.push({ label: `Entity: ${filters.entityName}`, clear: () => onChange({ ...filters, entityName: '' }) });
  if (filters.dateFrom) chips.push({ label: `From: ${filters.dateFrom}`, clear: () => onChange({ ...filters, dateFrom: '' }) });
  if (filters.dateTo) chips.push({ label: `To: ${filters.dateTo}`, clear: () => onChange({ ...filters, dateTo: '' }) });
  filters.formTypes.forEach(ft => chips.push({ label: ft, clear: () => toggleList('formTypes', ft) }));
  if (filters.sectionKeywords) chips.push({ label: `Section: ${filters.sectionKeywords}`, clear: () => onChange({ ...filters, sectionKeywords: '' }) });
  if (filters.sicCode) chips.push({ label: `SIC: ${filters.sicCode}`, clear: () => onChange({ ...filters, sicCode: '' }) });
  if (filters.stateOfInc) chips.push({ label: `Inc: ${filters.stateOfInc}`, clear: () => onChange({ ...filters, stateOfInc: '' }) });
  if (filters.headquarters) chips.push({ label: `HQ: ${filters.headquarters}`, clear: () => onChange({ ...filters, headquarters: '' }) });
  filters.exchange.forEach(ex => chips.push({ label: ex, clear: () => toggleList('exchange', ex) }));
  filters.acceleratedStatus.forEach(s => chips.push({ label: s, clear: () => toggleList('acceleratedStatus', s) }));
  if (filters.accountant) chips.push({ label: `Auditor: ${filters.accountant}`, clear: () => onChange({ ...filters, accountant: '' }) });
  if (filters.accessionNumber) chips.push({ label: `Acc#: ${filters.accessionNumber}`, clear: () => onChange({ ...filters, accessionNumber: '' }) });
  if (filters.fileNumber) chips.push({ label: `File#: ${filters.fileNumber}`, clear: () => onChange({ ...filters, fileNumber: '' }) });
  if (filters.fiscalYearEnd) chips.push({ label: `FYE: ${FY_LABELS[filters.fiscalYearEnd] || filters.fiscalYearEnd}`, clear: () => onChange({ ...filters, fiscalYearEnd: '' }) });

  return (
    <div style={{ marginBottom: '20px' }}>
      {/* Toggle bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '6px 14px', borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.1)',
          background: expanded ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.03)',
          color: expanded ? '#60A5FA' : '#94A3B8',
          cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500,
          transition: 'all 0.15s',
          marginBottom: expanded ? '12px' : '0',
        }}
      >
        <Filter size={14} />
        Advanced Filters
        {activeCount > 0 && (
          <span style={{ background: '#3B82F6', color: 'white', borderRadius: '10px', padding: '0 6px', fontSize: '0.7rem', fontWeight: 700, minWidth: '18px', textAlign: 'center' }}>
            {activeCount}
          </span>
        )}
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {!expanded && activeCount > 0 && (
        <div style={{
          display: 'flex',
          gap: '6px',
          flexWrap: 'wrap',
          alignItems: 'center',
          marginTop: '10px',
        }}>
          {chips.slice(0, 4).map((c, i) => (
            <span key={i} style={chipStyle}>
              {c.label}
              <button onClick={c.clear} style={{ background: 'none', border: 'none', color: '#60A5FA', cursor: 'pointer', padding: 0 }}>
                <X size={10} />
              </button>
            </span>
          ))}
          {chips.length > 4 && (
            <span style={{ color: '#64748B', fontSize: '0.74rem' }}>+{chips.length - 4} more</span>
          )}
          <button onClick={handleClear} style={{ background: 'none', border: 'none', color: '#F87171', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 500 }}>
            Clear All
          </button>
        </div>
      )}

      {/* Expanded filter panel */}
      {expanded && (
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}>
          {/* Row 1: Core filters — always visible */}
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {config.showEntityName !== false && (
              <div style={{ minWidth: '180px', flex: '1 1 180px' }}>
                <label style={labelStyle}>Company / Entity</label>
                <CompanyLookupField
                  value={filters.entityName}
                  onChange={value => onChange({ ...filters, entityName: value })}
                  placeholder="Type company or ticker"
                />
              </div>
            )}
            {config.showDateRange !== false && (
              <>
                <div style={{ minWidth: '140px' }}>
                  <label style={labelStyle}>Filed After</label>
                  <input type="date" value={filters.dateFrom} onChange={e => onChange({ ...filters, dateFrom: e.target.value })} style={inputStyle} />
                </div>
                <div style={{ minWidth: '140px' }}>
                  <label style={labelStyle}>Filed Before</label>
                  <input type="date" value={filters.dateTo} onChange={e => onChange({ ...filters, dateTo: e.target.value })} style={inputStyle} />
                </div>
                <div style={{ minWidth: '200px' }}>
                  <label style={labelStyle}>Quick Windows</label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {DATE_PRESETS.map(years => (
                      <button
                        key={years}
                        onClick={() => applyDatePreset(years)}
                        style={pillBtnStyle(false)}
                      >
                        {years}Y
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {config.showSectionKeywords && (
              <div style={{ minWidth: '180px', flex: '1 1 180px' }}>
                <label style={labelStyle}>Keywords in Section</label>
                <input value={filters.sectionKeywords} onChange={e => onChange({ ...filters, sectionKeywords: e.target.value })}
                  placeholder="e.g. risk factors, MD&A" style={{ ...inputStyle, width: '100%' }} />
              </div>
            )}
          </div>

          {/* Form Types */}
          {config.showFormTypes && config.formTypeOptions && config.formTypeOptions.length > 0 && (
            <CollapsibleSection title="Form Types" defaultOpen>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {config.formTypeOptions.map(ft => (
                  <button key={ft} onClick={() => toggleList('formTypes', ft)} style={pillBtnStyle(filters.formTypes.includes(ft))}>
                    {ft}
                  </button>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Company & Industry */}
          {(config.showSIC || config.showAccountant || config.showFiscalYearEnd) && (
            <CollapsibleSection title="Company Characteristics">
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {config.showSIC && (
                  <div style={{ minWidth: '160px', flex: '1 1 160px' }}>
                    <label style={labelStyle}>Industry / SIC Code</label>
                    <SicLookupField
                      value={filters.sicCode}
                      onChange={value => onChange({ ...filters, sicCode: value })}
                      placeholder="Browse SIC code or industry"
                    />
                  </div>
                )}
                {config.showAccountant && (
                  <div style={{ minWidth: '160px', flex: '1 1 160px' }}>
                    <label style={labelStyle}>Accountant / Auditor</label>
                    <input value={filters.accountant} onChange={e => onChange({ ...filters, accountant: e.target.value })}
                      placeholder="e.g. Deloitte, PwC" style={{ ...inputStyle, width: '100%' }} />
                  </div>
                )}
                {config.showFiscalYearEnd && (
                  <div style={{ minWidth: '120px' }}>
                    <label style={labelStyle}>Fiscal Year End</label>
                    <select value={filters.fiscalYearEnd} onChange={e => onChange({ ...filters, fiscalYearEnd: e.target.value })} style={selectStyle}>
                      <option value="">Any</option>
                      {FY_ENDS.map(m => <option key={m} value={m}>{FY_LABELS[m]} ({m})</option>)}
                    </select>
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* Geography */}
          {(config.showStateOfInc || config.showHeadquarters) && (
            <CollapsibleSection title="Geography">
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {config.showStateOfInc && (
                  <div style={{ minWidth: '140px' }}>
                    <label style={labelStyle}>Incorporated In</label>
                    <select value={filters.stateOfInc} onChange={e => onChange({ ...filters, stateOfInc: e.target.value })} style={selectStyle}>
                      <option value="">Any State</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                {config.showHeadquarters && (
                  <div style={{ minWidth: '160px', flex: '1 1 160px' }}>
                    <label style={labelStyle}>Headquarters In</label>
                    <input value={filters.headquarters} onChange={e => onChange({ ...filters, headquarters: e.target.value })}
                      placeholder="e.g. California, New York" style={{ ...inputStyle, width: '100%' }} />
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* Exchange */}
          {config.showExchange && (
            <CollapsibleSection title="Exchange">
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {EXCHANGES.map(ex => (
                  <button key={ex} onClick={() => toggleList('exchange', ex)} style={pillBtnStyle(filters.exchange.includes(ex))}>
                    {ex}
                  </button>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Accelerated Status */}
          {config.showAcceleratedStatus && (
            <CollapsibleSection title="Accelerated / Filer Status">
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {ACCEL_STATUSES.map(s => (
                  <button key={s.key} onClick={() => toggleList('acceleratedStatus', s.key)} style={pillBtnStyle(filters.acceleratedStatus.includes(s.key))}>
                    {s.label}
                  </button>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Expert filters */}
          {(config.showAccessionNumber || config.showFileNumber) && (
            <CollapsibleSection title="Expert Filters">
              <div style={{ color: '#64748B', fontSize: '0.74rem', marginBottom: '10px' }}>
                Use accession or file number only when you already know the exact filing you want.
              </div>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {config.showAccessionNumber && (
                  <div style={{ minWidth: '200px', flex: '1 1 200px' }}>
                    <label style={labelStyle}>Accession Number</label>
                    <input value={filters.accessionNumber} onChange={e => onChange({ ...filters, accessionNumber: e.target.value })}
                      placeholder="e.g. 0000320193-24-000081" style={{ ...inputStyle, width: '100%' }} />
                  </div>
                )}
                {config.showFileNumber && (
                  <div style={{ minWidth: '160px', flex: '1 1 160px' }}>
                    <label style={labelStyle}>File Number</label>
                    <input value={filters.fileNumber} onChange={e => onChange({ ...filters, fileNumber: e.target.value })}
                      placeholder="e.g. 001-36743" style={{ ...inputStyle, width: '100%' }} />
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* Active chips & apply */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center', flex: 1, minWidth: 0 }}>
              {chips.map((c, i) => (
                <span key={i} style={chipStyle}>
                  {c.label}
                  <button onClick={c.clear} style={{ background: 'none', border: 'none', color: '#60A5FA', cursor: 'pointer', padding: 0 }}><X size={10} /></button>
                </span>
              ))}
              {activeCount > 0 && (
                <button onClick={handleClear} style={{ background: 'none', border: 'none', color: '#F87171', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 500 }}>
                  Clear All
                </button>
              )}
              {activeCount === 0 && <span style={{ color: '#475569', fontSize: '0.78rem' }}>No filters applied</span>}
            </div>
            <button onClick={onSearch} disabled={loading} style={{
              padding: '7px 18px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '8px',
              cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: '12px',
            }}>
              Apply & Search
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
