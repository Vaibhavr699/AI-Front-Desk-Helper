import { useState, useEffect } from "react";
import { getFollowups, triggerFollowupSms, triggerFollowupCall, updateFollowupStatus } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import { 
  MessageSquare, 
  PhoneCall, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
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

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

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

  async function handleSms(id) {
    if (processing) return;
    setProcessing(id);
    try {
      await triggerFollowupSms(id);
      alert("SMS follow-up triggered!");
      loadData();
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      setProcessing(null);
    }
  }

  async function handleCall(id) {
    if (processing) return;
    setProcessing(id);
    try {
      await triggerFollowupCall(id);
      alert("AI Call follow-up triggered!");
      loadData();
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      setProcessing(null);
    }
  }

  async function handleStatus(id, status) {
    if (processing) return;
    const confirmed = window.confirm(`Mark this lead as ${status.toUpperCase()}?`);
    if (!confirmed) return;

    setProcessing(id);
    try {
      await updateFollowupStatus(id, status);
      setFollowups(prev => prev.filter(f => f.id !== id));
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      setProcessing(null);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-24"><LumaSpin /></div>;

  return (
    <div className="max-w-full space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 tracking-tight">Follow-Up Pipeline</h1>
          <p className="text-stone-500 mt-1">Automate and manage your estimate conversion workflow.</p>
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
              {followups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-stone-400 text-sm">
                    No active follow-ups in the pipeline.
                  </td>
                </tr>
              ) : (
                followups.map((f) => (
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
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatStage(step) {
  const map = {
    'estimate_sent': 'Estimate Sent',
    'sms_followup': 'SMS FollowUp',
    'ai_call_followup': 'AI Call FollowUp',
    'second_reminder': 'Second Reminder',
    'final_attempt': 'Final Attempt'
  };
  return map[step] || step;
}

function getStageStyle(step) {
  switch (step) {
    case 'estimate_sent': return 'bg-blue-50 text-blue-700 border border-blue-100';
    case 'sms_followup': return 'bg-amber-50 text-amber-700 border border-amber-100';
    case 'ai_call_followup': return 'bg-indigo-50 text-indigo-700 border border-indigo-100';
    case 'second_reminder': return 'bg-purple-50 text-purple-700 border border-purple-100';
    case 'final_attempt': return 'bg-red-50 text-red-700 border border-red-100';
    default: return 'bg-stone-50 text-stone-700 border border-stone-100';
  }
}
