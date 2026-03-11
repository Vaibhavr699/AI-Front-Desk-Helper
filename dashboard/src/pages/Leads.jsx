import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLeadsByTenant } from '../api';
import Header from '../components/Header';

export default function Leads({ tenantId }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchLeads();
  }, [tenantId]);

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

  const filteredLeads = leads.filter(lead => 
    (lead.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (lead.phone || '').includes(searchTerm) ||
    (lead.email || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status) => {
    switch (status) {
      case 'Booked': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'New Lead': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Qualified': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'Lost': return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'Closed': return 'bg-stone-100 text-stone-700 border-stone-200';
      default: return 'bg-amber-100 text-amber-700 border-amber-200';
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-full w-full mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-stone-900">AI Mini CRM</h1>
            <p className="mt-1 text-stone-500 text-sm">Manage your leads and conversation history in one place.</p>
          </div>
          
          <div className="relative">
            <input
              type="text"
              placeholder="Search leads..."
              className="w-full md:w-80 pl-10 pr-4 py-2.5 bg-white border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <svg className="h-5 w-5 text-stone-400 absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-stone-900 mx-auto"></div>
              <p className="mt-4 text-stone-500 text-sm">Loading leads...</p>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="h-8 w-8 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-stone-900">No leads found</h3>
              <p className="mt-1 text-stone-500 text-sm">Try adjusting your search or check back later.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Progress</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Project Type</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Created</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-stone-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-stone-100">
                  {filteredLeads.map((lead) => (
                    <tr 
                      key={lead.id} 
                      className="hover:bg-stone-50/50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/leads/${lead.id}`)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="h-10 w-10 flex-shrink-0 bg-stone-100 rounded-full flex items-center justify-center text-stone-500 font-bold border border-stone-200">
                            {(lead.name || lead.phone).charAt(0).toUpperCase()}
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-semibold text-stone-900">{lead.name || "Untitled Lead"}</div>
                            <div className="text-xs text-stone-500 font-mono">{lead.phone}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-0.5 w-32 h-1.5 bg-stone-100 rounded-full overflow-hidden border border-stone-200/50">
                          {['New Lead', 'Qualified', 'Estimate Sent', 'FollowUp', 'Booked'].map((s, i, arr) => {
                            const currentIndex = arr.indexOf(lead.status);
                            const isActive = i <= currentIndex;
                            return (
                              <div 
                                key={s} 
                                className={`flex-1 h-full transition-colors duration-500 ${
                                  isActive ? 'bg-stone-900 border-r border-stone-800 last:border-0' : 'bg-transparent'
                                }`} 
                                title={s}
                              />
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getStatusColor(lead.status)}`}>
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-600">
                        {lead.project_type || "---"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-500 font-mono">
                        {new Date(lead.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button className="text-stone-400 hover:text-stone-900 transition-colors">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
