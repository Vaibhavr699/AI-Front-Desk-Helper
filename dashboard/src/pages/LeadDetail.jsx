import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getLeadById, getLeadHistory, updateLead } from '../api';
import Header from '../components/Header';
import StatusStepper from '../components/StatusStepper';

export default function LeadDetail({ tenantId }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});

  useEffect(() => {
    fetchData();
  }, [id, tenantId]);

  async function fetchData() {
    try {
      setLoading(true);
      const [leadData, historyData] = await Promise.all([
        getLeadById(id),
        getLeadHistory(id)
      ]);
      setLead(leadData);
      setHistory(historyData || []);
      setEditData(leadData);
    } catch (err) {
      console.error("Failed to fetch lead data:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    try {
      const updated = await updateLead(id, editData);
      setLead(updated);
      setIsEditing(false);
    } catch (err) {
      alert("Failed to update lead");
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-stone-900"></div>
    </div>
  );

  if (!lead) return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center">
      <h2 className="text-xl font-bold">Lead not found</h2>
      <button onClick={() => navigate('/leads')} className="mt-4 text-blue-600 hover:underline">Back to Leads</button>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-full w-full mx-auto">
        <div className="mb-6 flex items-center gap-4">
          <button 
            onClick={() => navigate('/leads')}
            className="p-2 bg-white border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors shadow-sm"
          >
            <svg className="h-5 w-5 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-stone-900">{lead.name || lead.phone}</h1>
            <p className="text-sm text-stone-500">Customer Record · Created {new Date(lead.created_at).toLocaleDateString()}</p>
          </div>
          
          <div className="ml-auto flex gap-3">
            <select
              value={lead.status}
              onChange={(e) => updateLead(id, { status: e.target.value }).then(setLead)}
              className="bg-white border border-stone-200 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm focus:ring-2 focus:ring-blue-500"
            >
              {['New Lead', 'Qualified', 'Estimate Sent', 'FollowUp', 'Booked', 'Closed', 'Lost'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <StatusStepper currentStatus={lead.status} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Profile Info */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-stone-900 uppercase text-xs tracking-widest">Profile Details</h3>
                <button 
                  onClick={() => isEditing ? handleSave() : setIsEditing(true)}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-wider"
                >
                  {isEditing ? 'Save Changes' : 'Edit Profile'}
                </button>
              </div>

              <div className="space-y-4">
                {[
                  { label: 'Name', key: 'name' },
                  { label: 'Phone', key: 'phone', mono: true },
                  { label: 'Email', key: 'email' },
                  { label: 'Address', key: 'address' },
                  { label: 'Project Type', key: 'project_type' },
                  { label: 'Estimated Revenue ($)', key: 'estimated_revenue_cents', isRevenue: true },
                ].map(({ label, key, mono, isRevenue }) => (
                  <div key={key}>
                    <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">{label}</label>
                    {isEditing ? (
                      <input
                        type={isRevenue ? 'number' : 'text'}
                        step={isRevenue ? '0.01' : undefined}
                        className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        value={isRevenue ? (editData[key] / 100 || '') : (editData[key] || '')}
                        onChange={(e) => {
                          const val = isRevenue ? Math.round(parseFloat(e.target.value) * 100) : e.target.value;
                          setEditData({ ...editData, [key]: val });
                        }}
                      />
                    ) : (
                      <div className={`text-stone-900 text-sm font-medium ${mono ? 'font-mono' : ''}`}>
                        {isRevenue 
                          ? ((lead[key] || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                          : (lead[key] || <span className="text-stone-300 italic">Not provided</span>)
                        }
                      </div>
                    )}
                  </div>
                ))}

                <div>
                  <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Notes</label>
                  {isEditing ? (
                    <textarea
                      rows={4}
                      className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                      value={editData.notes || ''}
                      onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                    />
                  ) : (
                    <div className="text-stone-600 text-sm bg-stone-50 rounded-xl p-4 border border-stone-100 italic leading-relaxed">
                      {lead.notes || "No notes available for this lead."}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Conversation History & Activity Feed */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm flex flex-col h-[700px]">
              <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-white sticky top-0 z-10 rounded-t-2xl">
                <h3 className="font-bold text-stone-900 uppercase text-xs tracking-widest">Conversation Feed</h3>
                <span className="text-[10px] bg-stone-100 text-stone-500 font-bold px-2 py-1 rounded-md uppercase tracking-wider">
                  {history.length} Events
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-thin scrollbar-thumb-stone-200">
                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-stone-400 gap-3">
                    <svg className="h-10 w-10 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="text-sm font-medium">No conversation history yet.</p>
                  </div>
                ) : (
                  history.map((event, idx) => {
                    const isUser = event.direction === 'inbound' || event.type === 'call';
                    const isCall = event.type === 'call';
                    const isBooking = event.type === 'booking';

                    return (
                      <div key={idx} className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}>
                        <div className="flex items-center gap-2 mb-1.5 px-1">
                          <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wide">
                            {isCall ? '📞 Voice Call' : isBooking ? '📅 Booking' : (event.channel === 'facebook' ? '💬 Facebook' : '📱 SMS')}
                          </span>
                          <span className="text-[10px] text-stone-300">•</span>
                          <span className="text-[10px] font-medium text-stone-400 font-mono">
                            {new Date(event.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                          </span>
                        </div>

                        {isBooking ? (
                          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 w-full max-w-md shadow-sm">
                            <div className="flex items-center gap-3 mb-2">
                              <div className="h-8 w-8 bg-emerald-100 rounded-full flex items-center justify-center">
                                <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                              <h4 className="font-bold text-emerald-900 text-sm">Estimate Scheduled</h4>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-xs">
                              <div>
                                <p className="text-emerald-600 font-semibold uppercase tracking-tighter mb-1">Date</p>
                                <p className="text-emerald-900 font-bold">{new Date(event.preferred_date).toLocaleDateString()}</p>
                              </div>
                              <div>
                                <p className="text-emerald-600 font-semibold uppercase tracking-tighter mb-1">Project</p>
                                <p className="text-emerald-900 font-bold">{event.scope}</p>
                              </div>
                            </div>
                          </div>
                        ) : isCall ? (
                          <div className="bg-stone-50 border border-stone-200 rounded-2xl p-5 w-full shadow-sm hover:shadow-md transition-shadow group">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 bg-stone-200 rounded-full flex items-center justify-center animate-pulse-slow">
                                  <svg className="h-4 w-4 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h2.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                  </svg>
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-stone-900">Transcription</p>
                                  <p className="text-[10px] text-stone-500 font-mono">Disposition: {event.disposition}</p>
                                </div>
                              </div>
                              <span className="px-2 py-0.5 bg-stone-200 text-stone-600 text-[9px] font-bold rounded uppercase tracking-widest">{event.status}</span>
                            </div>
                            <div className="text-stone-600 text-sm leading-relaxed whitespace-pre-wrap italic">
                              {event.transcript || "No transcript available for this call."}
                            </div>
                          </div>
                        ) : (
                          <div className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-sm text-sm border ${
                            isUser 
                              ? 'bg-blue-600 text-white border-blue-500 rounded-bl-none' 
                              : 'bg-white text-stone-900 border-stone-200 rounded-br-none'
                          }`}>
                            <p className="leading-relaxed">{event.body}</p>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
