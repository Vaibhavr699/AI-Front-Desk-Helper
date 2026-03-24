import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { getConversations } from '../api';
import ConversationViewer from '../components/ConversationViewer';
import { Search, Filter, Phone, MessageSquare, Globe, Facebook, CheckCircle2, Clock, AlertCircle, Mail } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';

const Conversations = ({ tenantId }) => {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterChannel, setFilterChannel] = useState('all');

  const loadConversations = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const data = await getConversations(tenantId);
      const list = data.conversations || [];
      setConversations(list);
      setError("");
      if (list.length > 0) {
        setSelectedId((prev) => (list.some((c) => c.id === prev) ? prev : list[0].id));
      } else {
        setSelectedId(null);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
      setError(err.message || 'Failed to load conversations');
      setConversations([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      setSelectedId(null);
      loadConversations();
    }
  }, [tenantId, loadConversations]);

  const filtered = useMemo(() => {
    return conversations.filter(c => {
      const name = c.name || '';
      const phone = c.phone || '';
      const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            phone.includes(searchTerm);
      const matchesChannel = filterChannel === 'all' || c.last_channel === filterChannel;
      return matchesSearch && matchesChannel;
    });
  }, [conversations, searchTerm, filterChannel]);

  const selectedLead = useMemo(() => {
    return conversations.find(c => c.id === selectedId);
  }, [conversations, selectedId]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isToday(d)) return format(d, 'h:mm a');
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'MMM d');
  };

  const getChannelIcon = (channel) => {
    switch (channel) {
      case 'sms': return <MessageSquare size={14} />;
      case 'website': return <Globe size={14} />;
      case 'facebook': return <Facebook size={14} />;
      case 'email': return <Mail size={14} />;
      default: return null;
    }
  };

  return (
    <div className="h-[calc(100vh-140px)] flex gap-6 overflow-hidden">
      {/* Sidebar List */}
      <div className="w-96 flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Conversations</h2>
            <div className="px-2 py-1 bg-brand-100 text-brand-700 text-xs font-bold rounded-full">
              {conversations.length}
            </div>
          </div>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input 
              type="text"
              placeholder="Search leads or phone..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {['all', 'sms', 'website', 'facebook', 'email'].map(c => (
              <button
                key={c}
                onClick={() => setFilterChannel(c)}
                className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap border ${
                  filterChannel === c 
                    ? 'bg-brand-500 border-brand-500 text-white' 
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-lg text-sm flex items-center gap-2">
              <AlertCircle size={18} />
              {error}
            </div>
          )}
          {loading ? (
            <div className="p-10 space-y-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-16 bg-gray-50 animate-pulse rounded-lg shadow-sm"></div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">
              No conversations found.
            </div>
          ) : (
            filtered.map(c => (
              <div 
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`p-4 border-b border-gray-50 transition-all cursor-pointer hover:bg-gray-50 ${
                  selectedId === c.id ? 'bg-brand-50 border-l-4 border-l-brand-500' : 'bg-white'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-sm font-bold text-gray-900 truncate pr-2">
                    {c.name || c.phone || 'Anonymous'}
                  </span>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap pt-0.5 font-medium">
                    {formatDate(c.last_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`flex-shrink-0 ${selectedId === c.id ? 'text-brand-600' : 'text-gray-400'}`}>
                      {getChannelIcon(c.last_channel)}
                    </span>
                    <p className="text-xs text-gray-500 truncate italic pr-4">
                      {c.last_body || 'No message content'}
                    </p>
                  </div>
                  {c.status === 'Booked' && (
                    <CheckCircle2 size={12} className="text-green-500 flex-shrink-0" />
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Viewer Main Area */}
      <div className="flex-1 overflow-hidden">
        <ConversationViewer leadId={selectedId} leadName={selectedLead?.name || selectedLead?.phone} />
      </div>
    </div>
  );
};

export default Conversations;
