import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { getConversationTimeline, getLeadById, sendOwnerMessage, resumeAi } from '../api';
import {
  Phone, MessageSquare, Globe, Facebook, User, Bot,
  ChevronDown, ChevronUp, Mail, AlertCircle, Send, UserCheck,
} from 'lucide-react';
import { format } from 'date-fns';

// ─────────────────────────────────────────────────────────────────────
// Channel display config — drives the "Replying via X" badge / switcher +
// the validation messaging. Keep this aligned with the backend channel
// enum in routes/leads.js (sms | website | facebook | email).
//
// email (Jun 10, 2026): the one channel NOT keyed on lead.phone — it
// routes on lead.email. Amber treatment matches the timeline's existing
// email icon styling.
// ─────────────────────────────────────────────────────────────────────
const CHANNEL_LABELS = {
  sms:      { name: 'SMS',      icon: MessageSquare, color: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-200' },
  website:  { name: 'Website',  icon: Globe,         color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
  facebook: { name: 'Facebook', icon: Facebook,      color: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  email:    { name: 'Email',    icon: Mail,          color: 'text-amber-600',  bg: 'bg-amber-50',   border: 'border-amber-200' },
};

const ConversationViewer = ({ leadId, leadName }) => {
  const [timeline, setTimeline] = useState([]);
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedCalls, setExpandedCalls] = useState({});

  // Compose / send state
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  // Resume AI state
  const [resumingAi, setResumingAi] = useState(false);

  // Option B (Jun 10, 2026): manual channel override. null = follow
  // auto-detect; a channel string = owner explicitly picked it. Reset
  // whenever the selected lead changes (in the leadId effect below).
  const [channelOverride, setChannelOverride] = useState(null);

  const scrollRef = useRef(null);

  const loadAll = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    try {
      const [timelineData, leadData] = await Promise.all([
        getConversationTimeline(leadId),
        getLeadById(leadId),
      ]);
      setTimeline(timelineData.timeline || []);
      setLead(leadData);
    } catch (err) {
      console.error('Failed to load conversation:', err);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    if (leadId) {
      setMessageText('');
      setSendError('');
      setChannelOverride(null);
      loadAll();
    }
  }, [leadId, loadAll]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [timeline]);

  // ─────────────────────────────────────────────────────────────────────
  // Phase 8.3 — detect the channel for the owner's reply by finding the
  // most recent inbound message in the timeline. Mirrors the backend
  // auto-detect logic in detectLeadChannel() so the badge shown to the
  // owner matches what actually happens server-side.
  //
  // Jun 10, 2026: now also recognizes 'email' as a replyable channel.
  // Falls back to 'sms' for leads with no inbound history at all.
  // ─────────────────────────────────────────────────────────────────────
  const detectedChannel = useMemo(() => {
    if (!timeline || timeline.length === 0) return 'sms';
    // Timeline is newest-first; find the first message-type item where
    // direction is 'inbound'. We deliberately ignore calls + bookings
    // — they're not channels we can reply on.
    for (const item of timeline) {
      if (item.type === 'message' && item.direction === 'inbound') {
        if (
          item.channel === 'website' ||
          item.channel === 'facebook' ||
          item.channel === 'sms' ||
          item.channel === 'email'
        ) {
          return item.channel;
        }
      }
    }
    return 'sms';
  }, [timeline]);

  // Option B: the channel actually used = manual override if the owner
  // picked one, otherwise the auto-detected channel. The override is only
  // honored if it's a channel the lead can actually receive on (guarded
  // by the switcher, which only offers available channels).
  const activeChannel = channelOverride || detectedChannel;

  const handleSend = async () => {
    if (!messageText.trim() || sending) return;
    setSending(true);
    setSendError('');
    try {
      // Pass the active channel explicitly (override or auto-detect) so the
      // UI and the send route stay in sync. The backend re-validates and
      // returns a clean error if the lead can't receive on this channel.
      await sendOwnerMessage(leadId, messageText.trim(), activeChannel);
      setMessageText('');
      setChannelOverride(null);
      await loadAll();
    } catch (err) {
      console.error('Send failed:', err);
      setSendError(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleResumeAi = async () => {
    if (resumingAi) return;
    setResumingAi(true);
    try {
      await resumeAi(leadId);
      await loadAll();
    } catch (err) {
      console.error('Resume AI failed:', err);
    } finally {
      setResumingAi(false);
    }
  };

  const toggleCall = (id) => {
    setExpandedCalls(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getChannelIcon = (channel) => {
    switch (channel) {
      case 'voice': return <Phone size={16} className="text-blue-500" />;
      case 'sms': return <MessageSquare size={16} className="text-green-500" />;
      case 'email': return <Mail size={16} className="text-amber-600" />;
      case 'website': return <Globe size={16} className="text-purple-500" />;
      case 'facebook': return <Facebook size={16} className="text-blue-600" />;
      default: return <MessageSquare size={16} />;
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Date helpers (Jun 17, 2026) — date separators + full-date timestamps.
  // dayKey: compare two messages for "same calendar day".
  // dayLabel: the divider text shown between days.
  // ─────────────────────────────────────────────────────────────────────
  const dayKey = (dateStr) => {
    if (!dateStr) return '';
    return format(new Date(dateStr), 'yyyy-MM-dd');
  };

  const dayLabel = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return format(d, sameYear ? 'EEEE, MMM d' : 'EEEE, MMM d, yyyy');
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500"></div>
      </div>
    );
  }

  const isHandoff = !!lead?.human_handoff_at;
  const isDnc = !!lead?.do_not_contact;
  const charCount = messageText.length;

  // ─────────────────────────────────────────────────────────────────────
  // Channel-aware compose-box gating (Option B, Jun 10, 2026):
  //   sms      → requires lead.phone in E.164 format
  //   website  → requires lead.phone (which for website leads = sessionId)
  //   facebook → requires lead.phone (which for FB leads = sender_id)
  //   email    → requires lead.email  ← the one channel NOT keyed on phone
  //
  // sms/website/facebook all reuse lead.phone as their per-channel
  // identifier; email is the exception — it routes on lead.email. So we
  // track two independent identifiers and gate per selected channel.
  // ─────────────────────────────────────────────────────────────────────
  const hasPhone = !!lead?.phone;
  const hasEmail = !!lead?.email;

  // Which channels can this lead actually receive on right now? Phone-keyed
  // channels need lead.phone; email needs lead.email. We surface the
  // auto-detected phone-channel (sms/website/facebook) plus email — we do
  // NOT let the owner switch a website lead to "sms", since that's the same
  // identifier with different routing semantics. The real choice Option B
  // exposes is "the channel they came in on" vs "email".
  const phoneChannel = detectedChannel === 'email' ? 'sms' : detectedChannel;
  const availableChannels = [];
  if (hasPhone) availableChannels.push(phoneChannel);
  if (hasEmail) availableChannels.push('email');

  // The lead can be replied to at all if it has EITHER identifier.
  const hasIdentifier = hasPhone || hasEmail;

  // If the active channel isn't actually available (e.g. auto-detected sms
  // but the lead only has an email on file), fall back to whatever IS
  // available so the compose box stays usable instead of showing a dead
  // "no identifier" state for a lead we can in fact email.
  const effectiveChannel = availableChannels.includes(activeChannel)
    ? activeChannel
    : (availableChannels[0] || activeChannel);

  const channelConfig = CHANNEL_LABELS[effectiveChannel] || CHANNEL_LABELS.sms;
  const ChannelIcon = channelConfig.icon;

  // Show the switcher only when there's a genuine choice (lead has BOTH a
  // phone-keyed channel AND an email). A single-channel lead keeps the
  // static badge exactly as before.
  const showChannelSwitcher = hasPhone && hasEmail;

  // SMS-only segment warning — keyed on the effective channel so switching
  // to Email drops the 160-char segmenting note and uses the 1600 limit.
  const willSegment = charCount > 160 && effectiveChannel === 'sms';

  return (
    <div className="h-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">

      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 font-bold">
            {leadName ? leadName.charAt(0).toUpperCase() : 'U'}
          </div>
          <div>
            <h3 className="font-bold text-gray-900">{leadName || 'Unknown Lead'}</h3>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className={`w-2 h-2 rounded-full ${isHandoff ? 'bg-amber-500' : 'bg-green-500'}`}></span>
              {isHandoff ? 'AI paused — owner is handling' : 'Conversation History'}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Timeline feed ─────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/30"
      >
        {timeline.map((item, idx) => {
          const isOutbound  = item.direction === 'outbound';

          // Date divider: render when this item's calendar day differs from
          // the previously rendered item's day.
          const prevItem = idx > 0 ? timeline[idx - 1] : null;
          const showDayDivider = !prevItem || dayKey(item.at) !== dayKey(prevItem.at);
          const dayDivider = showDayDivider ? (
            <div className="flex items-center justify-center my-2">
              <span className="px-3 py-1 bg-gray-100 text-gray-500 text-[10px] font-semibold uppercase tracking-wider rounded-full">
                {dayLabel(item.at)}
              </span>
            </div>
          ) : null;

          const isOwnerSent = isOutbound && !!item.sent_by_user_id;
          const isAiSent    = isOutbound && !item.sent_by_user_id;
          const isCall      = item.type === 'call';

          if (isCall) {
            const isExpanded = expandedCalls[item.id];
            return (
              <React.Fragment key={item.id}>
                {dayDivider}
                <div className="flex flex-col items-center">
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
              </React.Fragment>
            );
          }

          // ── Message bubble — sender states ────────────────────────
          // A briefing is an internal message to the crew/technician, not
          // the customer — distinguished by source="briefing" (set in
          // services/preVisitBriefing.js via lib/outboundSms). Styled slate
          // so internal coaching text never reads as customer-facing.
          // NOTE: this only lights up if the timeline API returns `source`
          // on each message. If it doesn't, briefings fall back to the
          // normal AI bubble (same as before) — add `source` to the
          // timeline SELECT to enable the crew label.
          const isBriefing = item.source === 'briefing';
          const briefingRecipient = item.metadata?.recipient_kind || item.meta?.recipient_kind;
          const crewLabel =
            briefingRecipient === 'technician'
              ? 'AI → Crew (pre-visit brief)'
              : 'AI → Internal (pre-visit brief)';

          let avatarBg, avatarIcon, bubbleClass, senderLabel;
          if (isBriefing) {
            avatarBg = 'bg-slate-600 text-white';
            avatarIcon = <UserCheck size={16} />;
            bubbleClass = 'bg-slate-100 text-slate-700 border border-slate-200 rounded-tr-none';
            senderLabel = crewLabel;
          } else if (isOwnerSent) {
            avatarBg = 'bg-emerald-500 text-white';
            avatarIcon = <UserCheck size={16} />;
            bubbleClass = 'bg-emerald-500 text-white rounded-tr-none';
            senderLabel = 'You → Customer';
          } else if (isAiSent) {
            avatarBg = 'bg-brand-500 text-white';
            avatarIcon = <Bot size={16} />;
            bubbleClass = 'bg-brand-500 text-white rounded-tr-none';
            senderLabel = 'AI → Customer';
          } else {
            avatarBg = 'bg-gray-200 text-gray-600';
            avatarIcon = <User size={16} />;
            bubbleClass = 'bg-white text-gray-800 border border-gray-100 rounded-tl-none';
            senderLabel = leadName ? `${leadName} → Business` : 'Customer → Business';
          }

          return (
            <React.Fragment key={item.id}>
              {dayDivider}
              <div
                className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`flex gap-3 max-w-[80%] ${isOutbound ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${avatarBg}`}>
                    {avatarIcon}
                  </div>
                  <div>
                    <div className={`p-3 rounded-2xl text-sm shadow-sm ${bubbleClass}`}>
                      {item.content}
                    </div>
                    <div className={`mt-1 flex items-center gap-1.5 text-[10px] text-gray-400 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                      {getChannelIcon(item.channel)}
                      {senderLabel && (
                        <span className="font-semibold uppercase tracking-wider">{senderLabel} ·</span>
                      )}
                      {format(new Date(item.at), 'MMM d, h:mm a')}
                    </div>
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* ─── Compose box ───────────────────────────────────────────── */}
      <div className="border-t border-gray-100 bg-white">

        {/* Handoff banner — shown when AI is paused on this lead */}
        {isHandoff && (
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <Bot size={16} className="text-amber-600 flex-shrink-0" />
              <span className="text-sm text-amber-900 font-medium truncate">
                AI is paused — incoming customer messages won't get auto-responses
              </span>
            </div>
            <button
              onClick={handleResumeAi}
              disabled={resumingAi}
              className="text-sm text-amber-700 hover:text-amber-900 font-bold whitespace-nowrap disabled:opacity-50 transition-colors"
            >
              {resumingAi ? 'Resuming…' : 'Hand back to AI →'}
            </button>
          </div>
        )}

        {/* Inline send error */}
        {sendError && (
          <div className="px-4 py-2 bg-red-50 border-b border-red-200 flex items-center gap-2">
            <AlertCircle size={14} className="text-red-600 flex-shrink-0" />
            <span className="text-sm text-red-700">{sendError}</span>
          </div>
        )}

        <div className="p-4">
          {isDnc ? (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
              <span className="text-sm text-red-800">
                This lead is on the do-not-contact list. Messages cannot be sent.
              </span>
            </div>
          ) : !hasIdentifier ? (
            <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center gap-2">
              <AlertCircle size={16} className="text-gray-500 flex-shrink-0" />
              <span className="text-sm text-gray-600">
                This lead has no contact identifier on file — can't route a reply.
              </span>
            </div>
          ) : (
            <>
              {/* Channel-of-reply indicator + switcher (Option B) */}
              {showChannelSwitcher ? (
                <div className="mb-3 flex items-center gap-2">
                  {availableChannels.map((ch) => {
                    const cfg = CHANNEL_LABELS[ch] || CHANNEL_LABELS.sms;
                    const Icon = cfg.icon;
                    const isActive = ch === effectiveChannel;
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => setChannelOverride(ch)}
                        className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium border transition-all ${
                          isActive
                            ? `${cfg.bg} ${cfg.border} ${cfg.color}`
                            : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <Icon size={14} className={isActive ? cfg.color : 'text-gray-400'} />
                        {cfg.name}
                      </button>
                    );
                  })}
                  <span className="text-[10px] text-gray-400 ml-auto italic">
                    {channelOverride ? 'Channel chosen by you' : 'Auto-detected — tap to switch'}
                  </span>
                </div>
              ) : (
                <div className={`mb-3 px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-medium border ${channelConfig.bg} ${channelConfig.border}`}>
                  <ChannelIcon size={14} className={channelConfig.color} />
                  <span className={channelConfig.color}>
                    Replying via <strong>{channelConfig.name}</strong>
                  </span>
                  <span className="text-gray-400 ml-auto">
                    Auto-detected from latest customer message
                  </span>
                </div>
              )}

              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Type a message…  (Ctrl/Cmd+Enter to send)"
                    rows={2}
                    maxLength={1600}
                    disabled={sending}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 resize-none disabled:bg-gray-50"
                  />
                  <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
                    <span>
                      {willSegment ? (
                        <span className="text-amber-600">
                          {charCount} chars · sends as {Math.ceil(charCount / 160)} SMS segments
                        </span>
                      ) : effectiveChannel === 'sms' ? (
                        <span>{charCount} / 160</span>
                      ) : (
                        <span>{charCount} / 1600</span>
                      )}
                    </span>
                    {!isHandoff && (
                      <span className="text-gray-500 italic">
                        Sending will pause AI on this conversation
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleSend}
                  disabled={sending || !messageText.trim()}
                  className="px-4 py-2 bg-brand-500 text-white rounded-lg font-semibold text-sm hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                >
                  {sending ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send size={14} />
                      Send
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConversationViewer;
