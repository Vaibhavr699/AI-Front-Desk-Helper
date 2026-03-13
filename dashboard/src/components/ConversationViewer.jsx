import React, { useEffect, useState, useRef } from 'react';
import { getConversationTimeline } from '../api';
import { Phone, MessageSquare, Globe, Facebook, User, Bot, Calendar, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';

const ConversationViewer = ({ leadId, leadName }) => {
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCalls, setExpandedCalls] = useState({});
  const scrollRef = useRef(null);

  useEffect(() => {
    if (leadId) {
      loadTimeline();
    }
  }, [leadId]);

  const loadTimeline = async () => {
    setLoading(true);
    try {
      const data = await getConversationTimeline(leadId);
      setTimeline(data.timeline || []);
    } catch (err) {
      console.error('Failed to load timeline:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [timeline]);

  const toggleCall = (id) => {
    setExpandedCalls(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getChannelIcon = (channel) => {
    switch (channel) {
      case 'voice': return <Phone size={16} className="text-blue-500" />;
      case 'sms': return <MessageSquare size={16} className="text-green-500" />;
      case 'website': return <Globe size={16} className="text-purple-500" />;
      case 'facebook': return <Facebook size={16} className="text-blue-600" />;
      default: return <MessageSquare size={16} />;
    }
  };

  if (!leadId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 bg-gray-50/50 rounded-xl border-2 border-dashed border-gray-200">
        <MessageSquare size={48} className="mb-4 opacity-20" />
        <p className="text-lg font-medium">Select a conversation to view history</p>
        <p className="text-sm">Click a thread from the list on the left</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
            {leadName ? leadName.charAt(0).toUpperCase() : 'U'}
          </div>
          <div>
            <h3 className="font-bold text-gray-900">{leadName || 'Unknown Lead'}</h3>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              Conversation History
            </div>
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          <button className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors flex items-center gap-2">
            View Profile
          </button>
        </div>
      </div>

      {/* Timeline Feed */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/30"
      >
        {timeline.map((item, idx) => {
          const isAssistant = item.direction === 'outbound';
          const isCall = item.type === 'call';

          if (isCall) {
            const isExpanded = expandedCalls[item.id];
            return (
              <div key={item.id} className="flex flex-col items-center">
                <div className="w-full max-w-2xl bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <div 
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleCall(item.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                        <Phone size={16} />
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-gray-900">AI Phone Call</span>
                        <div className="text-[10px] text-gray-500">
                          {format(new Date(item.at), 'MMM d, h:mm a')}
                        </div>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                  
                  {isExpanded && (
                    <div className="p-4 border-t border-gray-50 bg-gray-50/20">
                      <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed font-mono text-[11px]">
                        {item.content || 'Voice call - transcript unavailable'}
                      </div>
                      {item.metadata?.leadCapture && (
                        <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap gap-2">
                          {Object.entries(item.metadata.leadCapture).map(([k, v]) => v && (
                            <span key={k} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] rounded-full uppercase tracking-wider font-semibold">
                              {k.replace('_', ' ')}: {v}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div 
              key={item.id} 
              className={`flex ${isAssistant ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex gap-3 max-w-[80%] ${isAssistant ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${isAssistant ? 'bg-primary text-white' : 'bg-gray-200 text-gray-600'}`}>
                  {isAssistant ? <Bot size={16} /> : <User size={16} />}
                </div>
                <div>
                  <div className={`p-3 rounded-2xl text-sm shadow-sm ${
                    isAssistant 
                      ? 'bg-primary text-blue-700 rounded-tr-none' 
                      : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
                  }`}>
                    {item.content}
                  </div>
                  <div className={`mt-1 flex items-center gap-1 text-[10px] text-gray-400 ${isAssistant ? 'justify-end' : 'justify-start'}`}>
                    {getChannelIcon(item.channel)}
                    {format(new Date(item.at), 'h:mm a')}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ConversationViewer;
