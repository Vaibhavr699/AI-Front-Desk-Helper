import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLeadsByTenant } from '../api';
import FollowUps from './FollowUps';
import Conversations from './Conversations';

// ── Tab config ─────────────────────────────────────────────────────────────
const LEADS_TABS = [
  { id: "pipeline",      label: "Pipeline"          },
  { id: "followups",     label: "Follow-ups"        },
  { id: "conversations", label: "AI Conversations"  },
];

const STATUS_CONFIG = {
  'New Lead':      { color: 'bg-blue-50 text-blue-700 border-blue-200',       dot: '#3b82f6' },
  'Qualified':     { color: 'bg-violet-50 text-violet-700 border-violet-200', dot: '#8b5cf6' },
  'Estimate Sent': { color: 'bg-amber-50 text-amber-700 border-amber-200',    dot: '#f59e0b' },
  'FollowUp':      { color: 'bg-orange-50 text-orange-700 border-orange-200', dot: '#f97316' },
  'Won':           { color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: '#22c55e' },
  'Booked':        { color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: '#22c55e' },
  'Lost':          { color: 'bg-rose-50 text-rose-700 border-rose-200',       dot: '#f43f5e' },
  'Closed':        { color: 'bg-stone-100 text-stone-600 border-stone-200',   dot: '#a8a29e' },
};

const SOURCE_CONFIG = {
  facebook:  { label: 'Facebook',  bg: 'bg-blue-50 text-blue-600 border-blue-100'       },
  website:   { label: 'Website',   bg: 'bg-indigo-50 text-indigo-600 border-indigo-100' },
  google:    { label: 'Google',    bg: 'bg-red-50 text-red-500 border-red-100'          },
  dripjobs:  { label: 'DripJobs',  bg: 'bg-teal-50 text-teal-600 border-teal-100'       },
  referral:  { label: 'Referral',  bg: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
};

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function Avatar({ name, phone }) {
  const letter = (name || phone || '?').charAt(0).toUpperCase();
  const colors = [
    'bg-blue-100 text-blue-600', 'bg-violet-100 text-violet-600',
    'bg-amber-100 text-amber-600', 'bg-emerald-100 text-emerald-600',
    'bg-rose-100 text-rose-600',  'bg-teal-100 text-teal-600',
  ];
  const color = colors[letter.charCodeAt(0) % colors.length];
  return (
    <div className={`h-9 w-9 flex-shrink-0 rounded-full flex items-center justify-center text-sm font-bold border border-white shadow-sm ${color}`}>
      {letter}
    </div>
  );
}

// ── Pipeline tab content ───────────────────────────────────────────────────
function Pipeline({ tenantId }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const navigate = useNavigate();

  useEffect(() => { fetchLeads(); }, [tenantId]);

  async function fetchLeads() {
    try {
      setLoading(true);
      const data = await getLeadsByTenant(tenantId);
      setLeads(data || []);
    } catch (err) {
      console.error("Failed to fetch leads:", err);
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;
    return {
      total:         leads.length,
      newThisWeek:   leads.filter(l => new Date(l.created_at) > weekAgo).length,
      openEstimates: leads.filter(l => l.status === 'Estimate Sent').length,
      won:           leads.filter(l => l.status === 'Won' || l.status === 'Booked').length,
    };
  }, [leads]);

  const statusCounts = useMemo(() => {
    const counts = { All: leads.length };
    leads.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });
    return counts;
  }, [leads]);

  const FILTER_TABS = ['All', 'New Lead', 'FollowUp', 'Estimate Sent', 'Won', 'Lost'];

  const filtered = useMemo(() => {
    let list = leads;
    if (activeFilter !== 'All') list = list.filter(l => l.status === activeFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(l =>
        (l.name || '').toLowerCase().includes(q) ||
        (l.phone || '').includes(q) ||
        (l.email || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [leads, activeFilter, searchTerm]);

  const displayName = (lead) => {
    if (lead.name) return lead.name;
    if (lead.phone?.startsWith('fb-')) return 'Facebook Visitor';
    if (lead.phone?.startsWith('web-')) return 'Website Visitor';
    return lead.phone || 'Unknown';
  };

  const displayPhone = (lead) => {
    if (lead.phone?.startsWith('fb-') || lead.phone?.startsWith('web-')) return 'Anonymous';
    return lead.phone || '—';
  };

  const sourceInfo = (lead) => {
    const key = (lead.channel || lead.lead_source || '').toLowerCase();
    return SOURCE_CONFIG[key] || { label: lead.lead_source || 'SMS', bg: 'bg-stone-50 text-stone-500 border-stone-200' };
  };

  const estValue = (lead) => {
    const cents = lead.estimated_revenue_cents || lead.estimate_value_cents || 0;
    if (!cents) return null;
    return `$${(cents / 100).toLocaleString()}`;
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <p className="mt-1 text-stone-500 text-sm">
          Pre-booking contacts · Booked appointments live in{' '}
          <button onClick={() => navigate('/bookings')} className="text-brand-600 font-medium hover:underline">Bookings →</button>
        </p>
        <div className="relative">
          <input
            type="text"
            placeholder="Search by name, phone, email…"
            className="w-full md:w-80 pl-10 pr-4 py-2.5 bg-white border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent shadow-sm transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <svg className="h-4 w-4 text-stone-400 absolute left-3 top-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Leads',    value: stats.total,         color: 'text-stone-900'   },
          { label: 'New This Week',  value: stats.newThisWeek,   color: 'text-blue-600'    },
          { label: 'Open Estimates', value: stats.openEstimates, color: 'text-amber-600'   },
          { label: 'Won / Booked',   value: stats.won,           color: 'text-emerald-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-stone-200 px-4 py-3 shadow-sm">
            <p className="text-xs text-stone-400 font-semibold uppercase tracking-wider">{s.label}</p>
            <p className={`text-2xl font-black mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {FILTER_TABS.map(tab => {
          const count = statusCounts[tab] || 0;
          const isActive = activeFilter === tab;
          const cfg = STATUS_CONFIG[tab];
          return (
            <button key={tab} onClick={() => setActiveFilter(tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all border ${
                isActive ? 'bg-stone-900 text-white border-stone-900 shadow-sm' : 'bg-white text-stone-500 border-stone-200 hover:border-stone-300 hover:text-stone-700'
              }`}
            >
              {cfg && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: isActive ? 'white' : cfg.dot }} />}
              {tab}
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-black ${isActive ? 'bg-white/20' : 'bg-stone-100 text-stone-500'}`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-16 text-center">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-stone-800 mx-auto" />
            <p className="mt-3 text-stone-400 text-sm">Loading leads…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-14 h-14 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="h-7 w-7 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 className="font-semibold text-stone-700">No leads found</h3>
            <p className="text-stone-400 text-sm mt-1">Try a different filter or search term.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-100">
              <thead className="bg-stone-50/80">
                <tr>
                  {['Contact','Status','Est. Value','Source','Last Activity','Project',''].map((h,i) => (
                    <th key={i} className="px-5 py-3.5 text-left text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {filtered.map((lead) => {
                  const statusCfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG['New Lead'];
                  const src = sourceInfo(lead);
                  const value = estValue(lead);
                  const lastActivity = lead.last_contact_at || lead.updated_at || lead.created_at;
                  const days = daysSince(lastActivity);
                  return (
                    <tr key={lead.id} className="hover:bg-stone-50/60 cursor-pointer transition-colors group" onClick={() => navigate(`/leads/${lead.id}`)}>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <Avatar name={lead.name} phone={lead.phone} />
                          <div>
                            <div className="text-sm font-bold text-stone-900 group-hover:text-brand-600 transition-colors leading-tight">{displayName(lead)}</div>
                            <div className="text-[11px] text-stone-400 font-mono mt-0.5">{displayPhone(lead)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full border ${statusCfg.color}`}>
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusCfg.dot }} />
                          {lead.status || 'New Lead'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {value ? <span className="text-sm font-bold text-stone-900">{value}</span> : <span className="text-sm text-stone-300">—</span>}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-md border ${src.bg}`}>{src.label}</span>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {days !== null ? (
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${days > 14 ? 'bg-rose-400' : days > 7 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                            <span className="text-sm text-stone-600 font-medium">{days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago`}</span>
                          </div>
                        ) : <span className="text-sm text-stone-300">—</span>}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span className="text-sm text-stone-500">{lead.project_type || <span className="text-stone-300">—</span>}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <svg className="h-4 w-4 text-stone-300 group-hover:text-stone-500 transition-colors ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-stone-100 bg-stone-50/50 flex items-center justify-between">
              <p className="text-xs text-stone-400">
                Showing <span className="font-bold text-stone-600">{filtered.length}</span> of <span className="font-bold text-stone-600">{leads.length}</span> leads
              </p>
              {activeFilter !== 'All' && (
                <button onClick={() => setActiveFilter('All')} className="text-xs text-brand-600 font-medium hover:underline">Clear filter</button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function Leads({ tenantId }) {
  const [activeTab, setActiveTab] = useState("pipeline");

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-full w-full mx-auto">

        {/* Header */}
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-stone-900">Leads Pipeline</h1>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 border-b border-stone-200 mb-6">
          {LEADS_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-all -mb-px ${
                activeTab === tab.id
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-stone-500 hover:text-stone-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "pipeline"      && <Pipeline      tenantId={tenantId} />}
        {activeTab === "followups"     && <FollowUps     tenantId={tenantId} />}
        {activeTab === "conversations" && <Conversations tenantId={tenantId} />}

      </main>
    </div>
  );
}
