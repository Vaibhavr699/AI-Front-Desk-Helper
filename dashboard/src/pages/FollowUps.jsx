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
  Send
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";

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

  return (
    <div className="max-w-full space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 tracking-tight">Follow-Up Pipeline</h1>
          <p className="text-stone-500 mt-1">Automate and manage your estimate conversion workflow.</p>
        </div>
        <div className="flex gap-2">
          <select 
            value={filterSystem}
            onChange={e => setFilterSystem(e.target.value)}
            className="px-4 py-2 border border-stone-200 bg-white rounded-xl text-sm font-medium focus:ring-2 focus:ring-stone-400 outline-none"
          >
            <option value="all">All Systems</option>
            <option value="recovery">Sales Recovery System</option>
            <option value="nurturing">Nurturing & Reminders</option>
          </select>
        </div>
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
                <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Last Contact</th>
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
                  <tr key={f.id} className="group hover:bg-stone-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-stone-900">{f.lead_name || f.contact_name || "Unknown"}</span>
                        <span className="text-xs text-stone-500 flex items-center gap-1.5 mt-0.5">
                          <History className="w-3 h-3 text-stone-300" />
                          Source: {f.lead_source || "Phone"}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="inline-flex items-center px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold">
                        <DollarSign className="w-3 h-3 mr-0.5" />
                        {f.estimated_revenue_cents ? (f.estimated_revenue_cents / 100).toLocaleString() : "0"}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStageStyle(f.current_step)}`}>
                        {formatStage(f.current_step)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-stone-600 text-xs">
                        <Clock className="w-3.5 h-3.5 text-stone-300" />
                        {f.next_action_at ? format(new Date(f.next_action_at), 'MMM d, h:mm a') : "Soon"}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-stone-500">
                      {f.last_contact ? formatDistanceToNow(new Date(f.last_contact)) + " ago" : "Never"}
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

function formatStage(step) {
  if (!step) return "Unknown";
  
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
    'reengagement': 'Re-engagement'
  };
  return map[step] || step.replace(/_/g, ' ');
}

function getStageStyle(step) {
  switch (step) {
    case 'estimate_sent': return 'bg-blue-50 text-blue-700 border border-blue-100';
    case 'sms_followup': return 'bg-amber-50 text-amber-700 border border-amber-100';
    case 'ai_call_followup': return 'bg-indigo-50 text-indigo-700 border border-indigo-100';
    case 'second_reminder': return 'bg-purple-50 text-purple-700 border border-purple-100';
    case 'final_attempt': return 'bg-red-50 text-red-700 border border-red-100';
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
