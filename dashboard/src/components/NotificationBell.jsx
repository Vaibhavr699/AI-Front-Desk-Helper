import { useState, useEffect, useRef } from "react";
import { Bell, Check, X, Calendar, PhoneMissed, TrendingUp, TrendingDown, BarChart, UserPlus, PhoneForwarded, ShieldAlert, AlertCircle, DollarSign, Flame, Mail, Star, Wrench, Bot, Activity, Clock, Shield } from "lucide-react";
import { getNotifications, markNotificationRead, markAllNotificationsRead } from "../api";
import { formatDistanceToNow } from "date-fns";

export default function NotificationBell({ tenantId }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  const fetchNotifications = async () => {
    if (!tenantId || tenantId === 'all') return;
    try {
      const data = await getNotifications(tenantId);
      setNotifications(data.notifications || []);
      setUnreadCount(data.notifications?.length || 0);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000); // Poll every minute
    return () => clearInterval(interval);
  }, [tenantId]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMarkRead = async (id, e) => {
    e.stopPropagation();
    try {
      await markNotificationRead(id, tenantId);
      setNotifications(notifications.filter(n => n.id !== id));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead(tenantId);
      setNotifications([]);
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  };

const getIcon = (type) => {
    switch (type) {
      // ─── Existing event-driven notifications ───
      case 'booking_created': return <Calendar className="text-emerald-500" size={16} />;
      case 'missed_call': return <PhoneMissed className="text-amber-500" size={16} />;
      case 'follow_up_converted': return <TrendingUp className="text-blue-500" size={16} />;
      case 'high_hangup_rate': return <ShieldAlert className="text-red-500" size={16} />;
      case 'daily_summary': return <BarChart className="text-indigo-500" size={16} />;
      case 'lead_captured': return <UserPlus className="text-emerald-500" size={16} />;
      case 'transfer_requested': return <PhoneForwarded className="text-amber-500" size={16} />;
      case 'spam_detected': return <ShieldAlert className="text-stone-400" size={16} />;
      case 'usage_alert': return <AlertCircle className="text-red-500" size={16} />;
      case 'revenue_recovered': return <DollarSign className="text-emerald-500" size={16} />;
      case 'hot_lead': return <Flame className="text-orange-500" size={16} />;
      case 'estimate_recovery_started': return <Mail className="text-blue-500" size={16} />;
      case 'new_reviews_pending': return <Star className="text-amber-500" size={16} />;

      // ─── NEW: Metric Alerts (Apr 17, 2026) ───
      // Critical (red) — business bleeding or platform broken
      case 'revenue_stall': return <AlertCircle className="text-red-500" size={16} />;
      case 'negative_review': return <Star className="text-red-500" size={16} />;
      case 'webhook_failures': return <Wrench className="text-red-500" size={16} />;
      case 'openai_errors': return <Bot className="text-red-500" size={16} />;
      // Warning (amber) — investigate soon
      case 'conversion_drop': return <TrendingDown className="text-amber-500" size={16} />;
      case 'recovery_failure': return <Mail className="text-amber-500" size={16} />;
      case 'call_volume_anomaly': return <Activity className="text-amber-500" size={16} />;
      case 'call_duration_anomaly': return <Clock className="text-amber-500" size={16} />;
      case 'booking_conversion_drop': return <DollarSign className="text-amber-500" size={16} />;
      // Info (blue) — AI handling correctly, informational
      case 'spam_call_surge': return <Shield className="text-blue-500" size={16} />;

      default: return <Bell className="text-stone-400" size={16} />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <style>{`
        @keyframes bell-ring {
          0%, 15%, 100% { transform: rotate(0); }
          2%, 4%, 6%, 8%, 10%, 12% { transform: rotate(8deg); }
          3%, 5%, 7%, 9%, 11% { transform: rotate(-8deg); }
        }
        .animate-notif-ring {
          animation: bell-ring 7s cubic-bezier(0.36, 0.07, 0.19, 0.97) infinite;
        }
      `}</style>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-xl text-stone-500 hover:bg-stone-100 hover:text-stone-900 transition-all active:scale-95"
        aria-label="Notifications"
      >
        <Bell 
          size={20} 
          className={unreadCount > 0 ? "animate-notif-ring text-stone-900 drop-shadow-sm" : ""} 
        />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white ring-2 ring-white animate-in fade-in zoom-in duration-300">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-80 sm:w-96 rounded-2xl bg-white/80 backdrop-blur-xl border border-stone-200 shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="p-4 border-b border-stone-200/60 bg-stone-50/50 flex items-center justify-between">
            <h3 className="text-sm font-black text-stone-900 uppercase tracking-wider">Notifications</h3>
            {notifications.length > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[10px] font-black text-stone-400 hover:text-stone-900 uppercase tracking-widest transition-colors flex items-center gap-1"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-10 text-center">
                <div className="w-12 h-12 bg-stone-100 rounded-2xl flex items-center justify-center mx-auto mb-3 text-stone-300">
                  <Bell size={24} />
                </div>
                <p className="text-sm font-bold text-stone-900">All caught up!</p>
                <p className="text-xs text-stone-400 mt-1">No new notifications for this location.</p>
              </div>
            ) : (
              <div className="divide-y divide-stone-100">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="group p-4 hover:bg-stone-50/80 transition-all flex gap-3 relative"
                  >
                    <button
                      onClick={(e) => handleMarkRead(n.id, e)}
                      className="mt-1 flex-shrink-0 h-6 w-6 rounded-md bg-stone-100 text-stone-400 hover:bg-stone-200 hover:text-stone-900 transition-all flex items-center justify-center border border-stone-200"
                      title="Mark as read"
                    >
                      <X size={12} />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-bold text-stone-900 leading-tight pr-2 uppercase tracking-wide flex items-center gap-1.5">
                          {getIcon(n.type)}
                          {n.title}
                        </p>
                      </div>
                      <p className="text-xs text-stone-500 mt-1 leading-normal">{n.body}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-tight">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 bg-stone-50/50 border-t border-stone-200/60 text-center">
            <button 
              className="text-[10px] font-bold text-stone-400 hover:text-stone-600 uppercase tracking-widest transition-colors"
                onClick={() => setIsOpen(false)}
            >
              Close Panel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
