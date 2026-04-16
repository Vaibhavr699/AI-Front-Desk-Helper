import { useState, useEffect } from "react";
import { getFollowups, triggerFollowupSms, triggerFollowupCall, updateFollowupStatus } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import { ConfirmationModal } from "../components";
import { 
  MessageSquare, 
  PhoneCall, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  ChevronLeft,
  ChevronRight,
  DollarSign,
  History,
  Send,
  CalendarCheck,
  MapPin,
  Briefcase
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";

/** Color-coded day counter badge: green < 2d, orange 2–5d, red > 5d */
function DaysBadge({ days, label }) {
  if (days == null || isNaN(days)) return null;
  const d = Math.max(0, Math.floor(days));
  let bg, text, border;
  if (d < 2) {
    bg = "bg-emerald-50"; text = "text-emerald-700"; border = "border-emerald-200";
  } else if (d <= 5) {
    bg = "bg-amber-50"; text = "text-amber-700"; border = "border-amber-200";
  } else {
    bg = "bg-red-50"; text = "text-red-700"; border = "border-red-200";
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${bg} ${text} ${border}`}>
      <Clock className="w-3 h-3" />
      {d}d {label || ""}
    </span>
  );
}

/** Days-until badge for appointments (inverted colors: red=soon, green=far away) */
function AppointmentCountdown({ days }) {
  if (days == null || isNaN(days)) return null;
  const d = Math.max(0, Math.ceil(days));
  let bg, text, border;
  if (d <= 1) {
    bg = "bg-red-50"; text = "text-red-700"; border = "border-red-200";
  } else if (d <= 3) {
    bg = "bg-amber-50"; text = "text-amber-700"; border = "border-amber-200";
  } else {
    bg = "bg-emerald-50"; text = "text-emerald-700"; border = "border-emerald-200";
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${bg} ${text} ${border}`}>
      <CalendarCheck className="w-3 h-3" />
      {d === 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d}d`}
    </span>
  );
}

export default function FollowUps({ tenantId }) {
  const [followups, setFollowups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(null);
  const [filterSystem, setFilterSystem] = useState("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(15);

  // Modal State
  const [modal, setModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    onConfirm: () => {},
    variant: "primary"
  });

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  useEffect(() => {
    setPage(1);
  }, [filterSystem]);

  const filteredFollowups = followups.filter(f => filterSystem === "all" || f.system_type === filterSystem);
  const total = filteredFollowups.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const paginatedFollowups = filteredFollowups.slice(offset, offset + limit);

  // Count by type for filter badges
  const counts = {
    all: followups.length,
    recovery: followups.filter(f => f.system_type === 'recovery').length,
    nurturing: followups.filter(f => f.system_type === 'nurturing').length,
    appointment: followups.filter(f => f.system_type === 'appointment').length,
  };

  async function loadData() {
    try {
      setLoading(true);
      const data = await getFollowups(tenantId);
      setFollowups(data.followups || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const showAlert = (title, message, variant = "primary") => {
    setModal({
      isOpen: true,
      title,
      message,
      confirmText: "Close",
      onConfirm: () => setModal(prev => ({ ...prev, isOpen: false })),
      variant
    });
  };

  async function handleSms(id) {
    if (processing) return;
    setProcessing(id);
    try {
      await triggerFollowupSms(id);
      showAlert("Success", "SMS follow-up has been triggered and sent to the lead.", "primary");
      loadData();
    } catch (e) {
      showAlert("Error", e.message, "danger");
    } finally {
      setProcessing(null);
    }
  }

  async function handleCall(id) {
    if (processing) return;
    setProcessing(id);
    try {
      await triggerFollowupCall(id);
      showAlert("Success", "AI Call follow-up has been initiated.", "primary");
      loadData();
    } catch (e) {
      showAlert("Error", e.message, "danger");
    } finally {
      setProcessing(null);
    }
  }

  async function handleStatus(id, status) {
    if (processing) return;
    
    setModal({
      isOpen: true,
      title: `Mark as ${status.toUpperCase()}?`,
      message: `Are you sure you want to move this lead to ${status}? This will update their status in the CRM.`,
      confirmText: status === 'booked' ? "Mark Booked" : "Mark Lost",
      variant: status === 'booked' ? 'primary' : 'danger',
      onConfirm: async () => {
        setProcessing(id);
        setModal(prev => ({ ...prev, isOpen: false }));
        try {
          await updateFollowupStatus(id, status);
          setFollowups(prev => prev.filter(f => f.id !== id));
        } catch (e) {
          showAlert("Error", e.message, "danger");
        } finally {
          setProcessing(null);
        }
      }
    });
  }

  if (loading) return <div className="flex items-center justify-center py-24"><LumaSpin /></div>;

  // ── Filter tabs with tooltips ─────────────────────────────────────────────
  const filterTabs = [
    {
      key: "all",
      label: "All",
      icon: null,
      tooltip: "All active follow-ups across every pipeline stage.",
    },
    {
      key: "recovery",
      label: "Estimate Recovery",
      icon: DollarSign,
      tooltip: "Leads who received estimates but haven't booked yet. AI automatically follows up with SMS and calls to recover potential lost revenue.",
    },
    {
      key: "appointment",
      label: "Appointments",
      icon: CalendarCheck,
      tooltip: "Confirmed bookings with a scheduled date. Automated reminders sent before the appointment to reduce no-shows.",
    },
    {
      key: "nurturing",
      label: "Nurturing",
      icon: History,
      tooltip: "Long-term relationship building for repeat business. Includes post-job follow-ups, maintenance reminders, seasonal campaigns, and referral requests.",
    },
  ];

  return (
    <div className="max-w-full space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 tracking-tight">Follow-Up Pipeline</h1>
          <p className="text-stone-500 mt-1">Automate and manage your estimate conversion workflow.</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {filterTabs.map(tab => {
          const isActive = filterSystem === tab.key;
          const count = counts[tab.key] || 0;
          return (
            <button
              key={tab.key}
              onClick={() => setFilterSystem(tab.key)}
              title={tab.tooltip}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                isActive
                  ? "bg-stone-900 text-white border-stone-900 shadow-md"
                  : "bg-white text-stone-600 border-stone-200 hover:border-stone-400 hover:bg-stone-50"
              }`}
            >
              {tab.icon && <tab.icon className="w-4 h-4" />}
              {tab.label}
              <span className={`ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                isActive
                  ? "bg-white/20 text-white"
                  : "bg-stone-100 text-stone-500"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-100">
            <thead>
              <tr className="bg-stone-50/50">
                <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Lead Name</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Value</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Stage</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Next Action</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Age</th>
                <th className="px-6 py-4 text-right text-xs font-bold text-stone-400 uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 bg-white">
              {paginatedFollowups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-stone-400 text-sm">
                    No active follow-ups in the pipeline matching this filter.
                  </td>
                </tr>
              ) : (
                paginatedFollowups.map((f) => (
                  <tr key={`${f.system_type}-${f.id}`} className="group hover:bg-stone-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-stone-900">{f.lead_name || f.contact_name || "Unknown"}</span>
                        <span className="text-xs text-stone-500 flex items-center gap-1.5 mt-0.5">
                          {f.system_type === 'appointment' ? (
                            <>
                              <CalendarCheck className="w-3 h-3 text-stone-300" />
                              {f.job_type || f.scope || "Appointment"}
                            </>
                          ) : (
                            <>
                              <History className="w-3 h-3 text-stone-300" />
                              Source: {formatSource(f.lead_source)}
                            </>
                          )}
                        </span>
                        {f.system_type === 'appointment' && f.address && (
                          <span className="text-[11px] text-stone-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3" />
                            {f.address}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="inline-flex items-center px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold">
                        <DollarSign className="w-3 h-3 mr-0.5" />
                        {f.estimated_revenue_cents ? (f.estimated_revenue_cents / 100).toLocaleString() : "0"}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStageStyle(f.current_step, f.system_type)}`}>
                        {formatStage(f.current_step, f.system_type)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {f.system_type === 'appointment' ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 text-stone-600 text-xs">
                            <CalendarCheck className="w-3.5 h-3.5 text-stone-300" />
                            {f.next_action_at ? format(new Date(f.next_action_at), 'MMM d, yyyy') : "TBD"}
                            {f.appointment_time ? ` @ ${f.appointment_time}` : ""}
                          </div>
                          <AppointmentCountdown days={f.days_until_appointment} />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-stone-600 text-xs">
                          <Clock className="w-3.5 h-3.5 text-stone-300" />
                          {f.next_action_at ? format(new Date(f.next_action_at), 'MMM d, h:mm a') : "Soon"}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <DaysBadge days={f.days_waiting} label="old" />
                    </td>
                    <td className="px-6 py-4 text-right">
                      {f.system_type === 'recovery' && (
                        <div className="flex items-center justify-end gap-2 transition-all">
                          <button
                            onClick={() => handleSms(f.id)}
                            disabled={processing === f.id}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors tooltip"
                            title="Send SMS"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleCall(f.id)}
                            disabled={processing === f.id}
                            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Trigger AI Call"
                          >
                            <PhoneCall className="w-4 h-4" />
                          </button>
                          <div className="w-px h-4 bg-stone-200 mx-1" />
                          <button
                            onClick={() => handleStatus(f.id, 'booked')}
                            disabled={processing === f.id}
                            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="Mark Booked"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleStatus(f.id, 'lost')}
                            disabled={processing === f.id}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Mark Lost"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                      {f.system_type === 'appointment' && (
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            to={`/bookings`}
                            className="px-3 py-1.5 text-xs font-medium text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-lg transition-all"
                          >
                            View Booking
                          </Link>
                        </div>
                      )}
                      {f.system_type === 'nurturing' && (
                        <div className="text-xs text-stone-400 italic">
                          Automated Sequence
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 bg-stone-50/50 border-t border-stone-100 flex items-center justify-between">
          <div className="text-xs font-medium text-stone-400 uppercase tracking-widest flex-1">
            Showing {Math.min(total, offset + 1)}-{Math.min(total, offset + limit)} of {total}
          </div>

          <div className="flex items-center justify-center gap-2 flex-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 rounded-lg border border-stone-200 bg-white text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed hover:border-stone-400 transition-all shadow-sm"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1">
              {[...Array(totalPages)].map((_, i) => {
                const p = i + 1;
                if (totalPages > 5 && Math.abs(p - page) > 1 && p !== 1 && p !== totalPages) return null;
                if (totalPages > 5 && Math.abs(p - page) === 2) return <span key={p} className="text-stone-300">...</span>;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${page === p
                        ? "bg-stone-900 text-white shadow-md"
                        : "text-stone-500 hover:bg-stone-100"
                      }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || totalPages === 0}
              className="p-2 rounded-lg border border-stone-200 bg-white text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed hover:border-stone-400 transition-all shadow-sm"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1"></div>
        </div>
      </div>

      <ConfirmationModal 
        isOpen={modal.isOpen}
        onClose={() => setModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={modal.onConfirm}
        title={modal.title}
        message={modal.message}
        confirmText={modal.confirmText}
        variant={modal.variant}
        loading={processing !== null}
      />
    </div>
  );
}

/** Format lead_source into user-friendly label */
function formatSource(src) {
  if (!src) return "Phone";
  const map = {
    'crm_webhook': 'CRM / DripJobs',
    'CRM Webhook': 'CRM / DripJobs',
    'zapier': 'Zapier',
    'Zapier': 'Zapier',
    'facebook': 'Facebook',
    'phone': 'Phone',
    'inquiry': 'Inquiry',
    'sms': 'SMS',
    'website': 'Website',
    'chat': 'Chat Widget',
  };
  return map[src] || src;
}

function formatStage(step, systemType) {
  if (!step) return "Unknown";

  if (systemType === 'appointment') {
    return "Upcoming Appt";
  }
  
  const map = {
    'estimate_sent': 'Estimate Sent',
    'sms_followup': 'SMS FollowUp',
    'ai_call_followup': 'AI Call FollowUp',
    'second_reminder': 'Second Reminder',
    'final_attempt': 'Final Attempt',
    'inquiry_thanks': 'Inquiry Thanks',
    'inquiry_call': 'Inquiry Call',
    // Nurturing steps
    '24h': '24h Reminder',
    'post_service': 'Post Service',
    'referral': 'Referral Req',
    'maintenance': 'Maintenance',
    'reengagement': 'Re-engagement',
    // Appointment
    'pre_appointment': 'Upcoming Appt',
    // New 21-day sequence steps
    'day1_checkin': 'Day 1 Check-in',
    'day3_value': 'Day 3 Value',
    'day5_call': 'Day 5 Call',
    'day7_urgency': 'Day 7 Urgency',
    'day10_call': 'Day 10 Call',
    'day14_softclose': 'Day 14 Soft Close',
    'day17_call': 'Day 17 Call',
    'day21_hardclose': 'Day 21 Close',
  };
  return map[step] || step.replace(/_/g, ' ');
}

function getStageStyle(step, systemType) {
  if (systemType === 'appointment' || step === 'pre_appointment') {
    return 'bg-violet-50 text-violet-700 border border-violet-100';
  }

  switch (step) {
    case 'estimate_sent': return 'bg-blue-50 text-blue-700 border border-blue-100';
    case 'day1_checkin': return 'bg-blue-50 text-blue-700 border border-blue-100';
    case 'sms_followup': return 'bg-amber-50 text-amber-700 border border-amber-100';
    case 'day3_value': return 'bg-amber-50 text-amber-700 border border-amber-100';
    case 'ai_call_followup': return 'bg-indigo-50 text-indigo-700 border border-indigo-100';
    case 'day5_call': return 'bg-indigo-50 text-indigo-700 border border-indigo-100';
    case 'day7_urgency': return 'bg-orange-50 text-orange-700 border border-orange-100';
    case 'second_reminder': return 'bg-purple-50 text-purple-700 border border-purple-100';
    case 'day10_call': return 'bg-purple-50 text-purple-700 border border-purple-100';
    case 'day14_softclose': return 'bg-rose-50 text-rose-700 border border-rose-100';
    case 'final_attempt': return 'bg-red-50 text-red-700 border border-red-100';
    case 'day17_call': return 'bg-red-50 text-red-700 border border-red-100';
    case 'day21_hardclose': return 'bg-red-50 text-red-700 border border-red-100';
    case 'inquiry_thanks': return 'bg-cyan-50 text-cyan-700 border border-cyan-100';
    case 'inquiry_call': return 'bg-orange-50 text-orange-700 border border-orange-100';
    
    // Nurturing specific colors
    case '24h': return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
    case 'post_service': return 'bg-sky-50 text-sky-700 border border-sky-100';
    case 'referral': return 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-100';
    case 'maintenance': return 'bg-amber-50 text-amber-700 border border-amber-100';
    case 'reengagement': return 'bg-teal-50 text-teal-700 border border-teal-100';

    default: return 'bg-stone-50 text-stone-700 border border-stone-100';
  }
}
