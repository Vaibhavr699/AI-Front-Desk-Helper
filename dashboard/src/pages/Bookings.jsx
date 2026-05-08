import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  getBookings,
  updateBooking,
  cancelBooking,
  getTechnicians,
  getUser,
  getLead,
  setLeadDoNotContact,
} from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import {
  Calendar, List, Users, Clock, CheckCircle2, AlertCircle,
  MapPin, ChevronRight, Phone, Search, Filter,
  ChevronLeft, ChevronsLeft, ChevronsRight,
  ArrowUpDown, X, ExternalLink, Mail, DollarSign, Tag,
  Ban,
} from "lucide-react";
import BookingCalendar from "../components/BookingCalendar";
import TechnicianManager from "../components/TechnicianManager";
import { format } from "date-fns";

export default function Bookings({ tenantId }) {
  const [bookings, setBookings] = useState([]);
  const [calendarBookings, setCalendarBookings] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("table");
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(15);
  const [total, setTotal] = useState(0);

  // Cancellation flow state — Phase 1 Cancellation Flow (May 4, 2026)
  const [cancelMode, setCancelMode] = useState(null); // null | 'confirm' | 'submitting'
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');

  // Do Not Contact flow state — Migration 059 (May 8, 2026)
  // leadInfo holds the full lead row for the currently selected booking,
  // including do_not_contact, do_not_contact_set_at, do_not_contact_set_by_name,
  // and do_not_contact_reason. Fetched on modal open via getLead().
  const [leadInfo, setLeadInfo] = useState(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const [dncMode, setDncMode] = useState(null); // null | 'enable' | 'disable' | 'submitting'
  const [dncReason, setDncReason] = useState('');
  const [dncError, setDncError] = useState('');
  const [dncToast, setDncToast] = useState(null); // { kind, message } | null

  // Reset cancel state whenever user opens/closes the modal
  useEffect(() => {
    setCancelMode(null);
    setCancelReason('');
    setCancelError('');
    setDncMode(null);
    setDncReason('');
    setDncError('');
  }, [selectedBooking?.id]);

  // Fetch the lead behind this booking so we can show DNC status + toggle.
  // Booking row already has lead_id when it was created with one (most cases).
  // If a booking doesn't have lead_id, the modal just hides the DNC section.
  useEffect(() => {
    if (!selectedBooking?.lead_id) {
      setLeadInfo(null);
      return;
    }
    let cancelled = false;
    setLeadLoading(true);
    getLead(selectedBooking.lead_id)
      .then((lead) => {
        if (!cancelled) setLeadInfo(lead);
      })
      .catch((err) => {
        console.error("Failed to load lead for DNC status:", err.message);
        if (!cancelled) setLeadInfo(null);
      })
      .finally(() => {
        if (!cancelled) setLeadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBooking?.lead_id]);

  // Auto-dismiss DNC toast after 5s
  useEffect(() => {
    if (!dncToast) return;
    const t = setTimeout(() => setDncToast(null), 5000);
    return () => clearTimeout(t);
  }, [dncToast]);

  useEffect(() => {
    if (!tenantId) return;
    getTechnicians(tenantId)
      .then(data => setTechnicians(data.technicians || []))
      .catch(() => { });
  }, [tenantId, view]);

  const loadCalendarBookings = useCallback(async () => {
    if (!tenantId) return;
    try {
      const data = await getBookings(tenantId, {
        sortBy: "preferred_date",
        sortDir: "desc",
        limit: 500,
        offset: 0
      });
      setCalendarBookings(data.bookings || []);
    } catch (e) {
      console.error("Calendar load error:", e);
    }
  }, [tenantId]);

  useEffect(() => {
    if (view === "calendar") loadCalendarBookings();
  }, [view, loadCalendarBookings]);

  const loadTableData = useCallback(async () => {
    if (!tenantId) return;
    if (initialLoad) setLoading(true);
    else setSearching(true);

    try {
      const params = {
        search,
        status: statusFilter,
        sortBy,
        sortDir,
        limit,
        offset: (page - 1) * limit
      };

      const bookingsData = await getBookings(tenantId, params);
      setBookings(bookingsData.bookings || []);
      setTotal(bookingsData.pagination?.total || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setSearching(false);
      setInitialLoad(false);
    }
  }, [tenantId, search, statusFilter, sortBy, sortDir, page, limit, initialLoad]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadTableData();
    }, search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [loadTableData]);

  async function handleStatusChange(id, newStatus) {
    try {
      await updateBooking(id, { status: newStatus });
      setBookings(prev => prev.map(b => b.id === id ? { ...b, status: newStatus } : b));
      if (selectedBooking?.id === id) {
        setSelectedBooking(prev => ({ ...prev, status: newStatus }));
      }
    } catch (e) {
      alert("Failed to update status: " + e.message);
    }
  }

  async function handleCancelBooking() {
    if (!selectedBooking) return;
    setCancelMode('submitting');
    setCancelError('');
    try {
      const updated = await cancelBooking(selectedBooking.id, cancelReason.trim() || null);
      setBookings(prev => prev.map(b => b.id === updated.id ? { ...b, ...updated } : b));
      setSelectedBooking(null);
      setCancelMode(null);
      setCancelReason('');
    } catch (e) {
      setCancelError(e.message || 'Failed to cancel booking');
      setCancelMode('confirm');
    }
  }

  async function handleTechAssign(id, techId) {
    const value = techId === "" ? null : techId;
    try {
      await updateBooking(id, { technician_id: value });
      const tech = value ? technicians.find(t => t.id === value) : null;
      setBookings(prev => prev.map(b => b.id === id ? { ...b, technician_id: value, technician_name: tech?.name } : b));
      if (selectedBooking?.id === id) {
        setSelectedBooking(prev => ({ ...prev, technician_id: value, technician_name: tech?.name }));
      }
    } catch (e) {
      alert("Failed to assign technician: " + e.message);
    }
  }

  /**
   * Toggle the do_not_contact flag for the currently selected booking's lead.
   *
   * value=true cascades — backend cancels any active estimate recoveries and
   * pending nurturing schedule rows for the lead. The response includes
   * counts so we can show a meaningful confirmation toast.
   *
   * value=false reopens the lead to future automation but leaves
   * previously-cancelled sequences cancelled.
   */
  async function handleToggleDnc(value) {
    if (!leadInfo) return;
    setDncMode('submitting');
    setDncError('');
    try {
      const result = await setLeadDoNotContact(
        leadInfo.id,
        value,
        value ? (dncReason.trim() || null) : null
      );
      setLeadInfo(result.lead);
      setDncMode(null);
      setDncReason('');

      // Mirror the new flag to the booking list so the row badge updates
      // immediately. The bookings backend may not yet JOIN to leads.do_not_contact,
      // but if/when it does, this keeps the UI in sync without a full reload.
      if (selectedBooking?.lead_id === leadInfo.id) {
        setBookings((prev) =>
          prev.map((b) =>
            b.lead_id === leadInfo.id ? { ...b, do_not_contact: value } : b
          )
        );
      }

      // Toast feedback summarizing what just happened.
      if (value) {
        const parts = [];
        if (result.cancelled_recoveries > 0) {
          parts.push(`${result.cancelled_recoveries} recovery sequence${result.cancelled_recoveries === 1 ? '' : 's'}`);
        }
        if (result.cancelled_nurtures > 0) {
          parts.push(`${result.cancelled_nurtures} nurture${result.cancelled_nurtures === 1 ? '' : 's'}`);
        }
        const tail = parts.length > 0 ? ` Cancelled ${parts.join(' and ')}.` : '';
        setDncToast({ kind: 'enabled', message: `Communication stopped.${tail}` });
      } else {
        setDncToast({ kind: 'disabled', message: 'Communication resumed for future outreach.' });
      }
    } catch (e) {
      setDncError(e.message || 'Failed to update');
      setDncMode(value ? 'enable' : 'disable');
    }
  }

  const toggleSort = (column) => {
    if (sortBy === column) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDir("desc");
    }
    setPage(1);
  };

  const totalPages = Math.ceil(total / limit);

  if (!tenantId) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-stone-500">
        <Users className="w-12 h-12 mb-2 opacity-20" />
        <p>Select a business to view bookings.</p>
      </div>
    );
  }

  return (
    <div className="max-w-full space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-2">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 tracking-tight">Bookings</h1>
          <p className="text-stone-500 mt-1 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 border border-orange-500 rounded-full text-[14px] font-bold text-orange-500">
              {total}
            </span>
            Manage your appointments, crew assignments, and schedule.
          </p>
        </div>

        <div className="flex bg-stone-100 p-1 rounded-xl border border-stone-200">
          <button
            onClick={() => setView("table")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === "table" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
              }`}
          >
            <List className="w-4 h-4" />
            Table
          </button>
          <button
            onClick={() => setView("calendar")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === "calendar" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
              }`}
          >
            <Calendar className="w-4 h-4" />
            Calendar
          </button>
          {getUser()?.role !== 'staff' && (
            <button
              onClick={() => setView("technicians")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === "technicians" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
                }`}
            >
              <Users className="w-4 h-4" />
              Crew
            </button>
          )}
        </div>
      </div>

      {view !== "technicians" && (
        <div className="flex flex-col md:flex-row items-center gap-4 bg-white p-4 rounded-2xl border border-stone-200 shadow-sm">
          <div className="relative flex-1 w-full">
            {searching ? (
              <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4">
                <div className="w-4 h-4 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
              </div>
            ) : (
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            )}
            <input
              type="text"
              placeholder="Search by name, phone, or project details..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-10 pr-10 py-2 bg-stone-50 border border-stone-100 rounded-xl text-sm focus:ring-2 focus:ring-stone-900/5 focus:bg-white outline-none transition-all placeholder:text-stone-400 text-stone-700"
            />
            {search && (
              <button
                onClick={() => { setSearch(''); setPage(1); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 hover:bg-stone-200 rounded-full transition-colors"
              >
                <X className="w-3.5 h-3.5 text-stone-400" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 md:pb-0 w-full md:w-auto">
            <Filter className="w-4 h-4 text-stone-400 mr-2 shrink-0" />
            {["all", "booked", "confirmed", "completed", "cancelled"].map((s) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all border shrink-0 ${statusFilter === s
                    ? "bg-stone-900 border-stone-900 text-white shadow-md shadow-stone-900/10"
                    : "bg-white border-stone-200 text-stone-500 hover:border-stone-300"
                  }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === "table" && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden flex flex-col min-h-[400px]">
          <div className="flex-1 overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-100">
              <thead>
                <tr className="bg-stone-50/50">
                  <th className="px-6 py-4 text-left">
                    <button onClick={() => toggleSort('contact_name')} className="flex items-center gap-2 text-xs font-bold text-stone-400 uppercase tracking-widest hover:text-stone-600 transition-colors">
                      Customer <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <button onClick={() => toggleSort('preferred_date')} className="flex items-center gap-2 text-xs font-bold text-stone-400 uppercase tracking-widest hover:text-stone-600 transition-colors">
                      Appointment <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <button onClick={() => toggleSort('estimated_revenue_cents')} className="flex items-center gap-2 text-xs font-bold text-stone-400 uppercase tracking-widest hover:text-stone-600 transition-colors">
                      Value <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Source</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Technician</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-stone-400 uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y divide-stone-100 bg-white relative transition-opacity duration-200 ${searching ? 'opacity-50' : 'opacity-100'}`}>
                {loading && bookings.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-24 text-center">
                      <div className="flex items-center justify-center">
                        <LumaSpin />
                      </div>
                    </td>
                  </tr>
                )}
                {bookings.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-24 text-center">
                      <div className="flex flex-col items-center opacity-40">
                        <AlertCircle className="w-10 h-10 mb-2" />
                        <p className="font-medium text-stone-600 italic">No matches found for your criteria.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  bookings.map((b) => (
                    <tr
                      key={b.id}
                      className="group hover:bg-stone-50/50 transition-colors cursor-pointer"
                      onClick={() => setSelectedBooking(b)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-stone-900 group-hover:text-blue-600 transition-colors flex items-center gap-2">
                            {b.contact_name || "Unknown"}
                            {/* DNC badge — Migration 059 (May 8, 2026).
                                Renders only if the bookings API returns
                                do_not_contact in the row (requires backend
                                JOIN to leads). Until that ships, the badge
                                is invisible but the modal toggle still works. */}
                            {b.do_not_contact && (
                              <span
                                title="Do Not Contact"
                                className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[9px] font-black uppercase tracking-wider rounded border border-red-200 inline-flex items-center gap-1"
                              >
                                <Ban className="w-2.5 h-2.5" />
                                DNC
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-stone-500 flex items-center gap-1.5 mt-0.5">
                            <Phone className="w-3 h-3" />
                            {b.contact_phone || "No phone"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm text-stone-700 font-medium italic">
                            {b.preferred_date ? format(new Date(b.preferred_date.includes('T') ? b.preferred_date : b.preferred_date + 'T00:00:00'), 'MMM d, yyyy') : "TBD"}
                          </span>
                          <span className="text-xs text-stone-500">
                            {b.appointment_time ? format(new Date(`2000-01-01T${b.appointment_time}`), 'h:mm a') : "No time set"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-bold text-stone-900">
                          ${b.estimated_revenue_cents ? (b.estimated_revenue_cents / 100).toLocaleString() : "0"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 bg-stone-100 text-stone-500 text-[10px] font-black uppercase tracking-widest rounded-md border border-stone-200 shadow-sm">
                          {b.lead_source || "Direct"}
                        </span>
                      </td>
                      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={b.technician_id || ""}
                          onChange={(e) => handleTechAssign(b.id, e.target.value)}
                          className="bg-stone-100 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-stone-700 outline-none focus:ring-2 focus:ring-stone-900/5 transition-all w-32 appearance-none shadow-sm cursor-pointer"
                        >
                          <option value="">Unassigned</option>
                          {technicians.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={b.status || "Booked"}
                          onChange={(e) => handleStatusChange(b.id, e.target.value)}
                          className={`border rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider outline-none transition-all shadow-sm cursor-pointer ${getStatusStyle(b.status)}`}
                        >
                          {['Booked', 'Confirmed', 'Completed', 'Rescheduled', 'Cancelled'].map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        {b.call_id ? (
                          <Link
                            to={`/calls/${b.call_id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all shadow-sm"
                          >
                            <ExternalLink className="w-3 h-3" />
                            View Call
                          </Link>
                        ) : (
                          <span className="text-xs text-stone-300 italic">No call</span>
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
              Showing {Math.min(total, (page - 1) * limit + 1)}-{Math.min(total, page * limit)} of {total}
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
      )}

      {view === "calendar" && (
        <BookingCalendar
          bookings={calendarBookings}
          onEventClick={(b) => setSelectedBooking(b)}
        />
      )}

      {view === "technicians" && (
        <TechnicianManager tenantId={tenantId} />
      )}

      {/* DNC toast — fixed top-right, auto-dismisses after 5s */}
      {dncToast && (
        <div className="fixed top-6 right-6 z-[200] animate-in slide-in-from-top-4 fade-in duration-300">
          <div
            className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border max-w-sm ${
              dncToast.kind === 'enabled'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-stone-50 border-stone-200 text-stone-900'
            }`}
          >
            {dncToast.kind === 'enabled' ? (
              <Ban className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-stone-600 mt-0.5 shrink-0" />
            )}
            <p className="text-sm font-semibold leading-snug">{dncToast.message}</p>
            <button
              onClick={() => setDncToast(null)}
              className="ml-1 p-0.5 hover:bg-black/5 rounded transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedBooking && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-stone-100/40 animate-in fade-in duration-300"
            onClick={() => setSelectedBooking(null)}
          />
          <div className="relative bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full animate-pulse ${getStatusSlugColor(selectedBooking.status)}`} />
                <h2 className="text-xl font-bold text-stone-900 tracking-tight">Booking Details</h2>
                {leadInfo?.do_not_contact && (
                  <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-black uppercase tracking-widest rounded border border-red-200 inline-flex items-center gap-1">
                    <Ban className="w-2.5 h-2.5" />
                    DNC
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedBooking(null)}
                className="p-2 hover:bg-stone-200 rounded-full transition-colors text-stone-400 hover:text-stone-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 space-y-8 overflow-y-auto max-h-[70vh]">
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-stone-400">Customer</label>
                  <p className="text-lg font-bold text-stone-900">{selectedBooking.contact_name || "Unknown"}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-stone-400">Source</label>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-bold uppercase tracking-wider border border-blue-100">
                      <Tag className="w-2.5 h-2.5 inline mr-1" />
                      {selectedBooking.lead_source || "Direct"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-stone-400">Est. Budget</label>
                  <div className="flex items-center gap-1.5 text-lg font-bold text-stone-900">
                    <DollarSign className="w-4 h-4 text-emerald-600" />
                    {selectedBooking.estimated_revenue_cents ? (selectedBooking.estimated_revenue_cents / 100).toLocaleString() : "0.00"}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-stone-400">Appointment</label>
                  <p className="text-sm font-semibold text-stone-700 italic">
                    {selectedBooking.preferred_date ? format(new Date(selectedBooking.preferred_date.includes('T') ? selectedBooking.preferred_date : selectedBooking.preferred_date + 'T00:00:00'), 'EEEE, MMM do') : "TBD"}
                    {selectedBooking.appointment_time && ` at ${format(new Date(`2000-01-01T${selectedBooking.appointment_time}`), 'h:mm a')}`}
                  </p>
                </div>
              </div>

              <div className="space-y-2 p-5 bg-stone-50 rounded-2xl border border-stone-100 shadow-inner">
                <label className="text-[10px] font-black uppercase tracking-widest text-stone-400">Project Scope</label>
                <p className="text-sm leading-relaxed text-stone-600">{selectedBooking.scope || "No details provided."}</p>
              </div>

              <div className="pt-4 flex flex-col sm:flex-row gap-4">
                <div className="flex-1 space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-stone-400">Update Status</label>
                  <select
                    value={selectedBooking.status || "Booked"}
                    onChange={(e) => handleStatusChange(selectedBooking.id, e.target.value)}
                    className={`w-full border rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider outline-none transition-all shadow-sm cursor-pointer ${getStatusStyle(selectedBooking.status)}`}
                  >
                    {['Booked', 'Confirmed', 'Completed', 'Rescheduled', 'Cancelled'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-stone-400">Assign Technician</label>
                  <select
                    value={selectedBooking.technician_id || ""}
                    onChange={(e) => handleTechAssign(selectedBooking.id, e.target.value)}
                    className="w-full bg-stone-100 border border-stone-200 rounded-xl px-4 py-2 text-xs font-bold text-stone-700 outline-none focus:ring-2 focus:ring-stone-900/5 transition-all shadow-sm cursor-pointer appearance-none"
                  >
                    <option value="">Unassigned</option>
                    {technicians.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedBooking.status?.toLowerCase() !== 'cancelled' && (
                <div className="pt-4 border-t border-stone-100">
                  {cancelMode === null && (
                    <button
                      onClick={() => setCancelMode('confirm')}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 font-semibold text-sm rounded-xl transition-all"
                    >
                      <X className="w-4 h-4" />
                      Cancel Booking
                    </button>
                  )}
                  {(cancelMode === 'confirm' || cancelMode === 'submitting') && (
                    <div className="space-y-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-red-700">Cancel this booking?</label>
                        <p className="text-xs text-red-600 mt-1">
                          {selectedBooking.contact_name || 'The customer'}'s appointment will be marked as cancelled. You'll get an email summary so you can follow up.
                        </p>
                      </div>
                      <textarea
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="Reason for cancellation (optional)..."
                        rows={2}
                        disabled={cancelMode === 'submitting'}
                        className="w-full text-sm bg-white border border-red-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-red-200 placeholder:text-red-400 text-stone-700 disabled:opacity-50"
                      />
                      {cancelError && (
                        <p className="text-xs text-red-700 font-medium">{cancelError}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setCancelMode(null); setCancelReason(''); setCancelError(''); }}
                          disabled={cancelMode === 'submitting'}
                          className="flex-1 px-4 py-2 bg-white border border-stone-200 text-stone-700 hover:border-stone-300 font-semibold text-xs rounded-lg transition-all disabled:opacity-50"
                        >
                          Keep booking
                        </button>
                        <button
                          onClick={handleCancelBooking}
                          disabled={cancelMode === 'submitting'}
                          className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-lg transition-all disabled:opacity-50"
                        >
                          {cancelMode === 'submitting' ? 'Cancelling...' : 'Confirm cancellation'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ─────────────────────────────────────────────────────
                  Do Not Contact section — Migration 059 (May 8, 2026)

                  Only renders if we successfully loaded the lead behind
                  this booking. The lead may not exist for very old bookings
                  predating the lead-first architecture, in which case the
                  section is hidden silently.
                  ───────────────────────────────────────────────────── */}
              {selectedBooking.lead_id && (
                <div className="pt-4 border-t border-stone-100">
                  {leadLoading && (
                    <div className="flex items-center justify-center p-4 text-sm text-stone-500">
                      <div className="w-4 h-4 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin mr-2" />
                      Loading communication settings...
                    </div>
                  )}

                  {!leadLoading && leadInfo && !leadInfo.do_not_contact && dncMode === null && (
                    <button
                      onClick={() => setDncMode('enable')}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 hover:border-amber-300 font-semibold text-sm rounded-xl transition-all"
                    >
                      <Ban className="w-4 h-4" />
                      Stop All Communication
                    </button>
                  )}

                  {!leadLoading && leadInfo?.do_not_contact && dncMode === null && (
                    <div className="space-y-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                      <div className="flex items-start gap-3">
                        <Ban className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-red-900">All outbound communication stopped</p>
                          <p className="text-xs text-red-700 mt-1">
                            No SMS follow-ups, recovery sequences, or nurturing campaigns will fire for this customer.
                          </p>
                          {leadInfo.do_not_contact_reason && (
                            <p className="text-xs text-red-800 mt-2 italic">"{leadInfo.do_not_contact_reason}"</p>
                          )}
                          {(leadInfo.do_not_contact_set_at || leadInfo.do_not_contact_set_by_name) && (
                            <p className="text-[10px] text-red-600 mt-2 uppercase tracking-wider">
                              {leadInfo.do_not_contact_set_at && `Set ${format(new Date(leadInfo.do_not_contact_set_at), 'MMM d, yyyy')}`}
                              {leadInfo.do_not_contact_set_by_name && ` by ${leadInfo.do_not_contact_set_by_name}`}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setDncMode('disable')}
                        className="w-full px-4 py-2 bg-white border border-red-200 text-red-700 hover:bg-red-100 font-semibold text-xs rounded-lg transition-all"
                      >
                        Resume Communication
                      </button>
                    </div>
                  )}

                  {dncMode === 'enable' && (
                    <div className="space-y-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                      <div className="flex items-start gap-3">
                        <Ban className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-amber-800">Stop all outbound communication?</label>
                          <p className="text-xs text-amber-700 mt-1">
                            This will cancel any active follow-up sequences and nurturing campaigns for {selectedBooking.contact_name || 'this customer'}, and prevent any future automated texts or calls.
                          </p>
                        </div>
                      </div>
                      <textarea
                        value={dncReason}
                        onChange={(e) => setDncReason(e.target.value)}
                        placeholder="Reason (optional, for the audit log)..."
                        rows={2}
                        className="w-full text-sm bg-white border border-amber-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-amber-200 placeholder:text-amber-500 text-stone-700"
                      />
                      {dncError && <p className="text-xs text-red-700 font-medium">{dncError}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setDncMode(null); setDncReason(''); setDncError(''); }}
                          className="flex-1 px-4 py-2 bg-white border border-stone-200 text-stone-700 hover:border-stone-300 font-semibold text-xs rounded-lg transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleToggleDnc(true)}
                          className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded-lg transition-all"
                        >
                          Stop Communication
                        </button>
                      </div>
                    </div>
                  )}

                  {dncMode === 'disable' && (
                    <div className="space-y-3 p-4 bg-stone-50 border border-stone-200 rounded-xl">
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-stone-700">Resume communication?</label>
                        <p className="text-xs text-stone-600 mt-1">
                          Future automated outreach will be allowed for this customer. Previously cancelled sequences will stay cancelled.
                        </p>
                      </div>
                      {dncError && <p className="text-xs text-red-700 font-medium">{dncError}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setDncMode(null); setDncError(''); }}
                          className="flex-1 px-4 py-2 bg-white border border-stone-200 text-stone-700 hover:border-stone-300 font-semibold text-xs rounded-lg transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleToggleDnc(false)}
                          className="flex-1 px-4 py-2 bg-stone-700 hover:bg-stone-800 text-white font-semibold text-xs rounded-lg transition-all"
                        >
                          Resume
                        </button>
                      </div>
                    </div>
                  )}

                  {dncMode === 'submitting' && (
                    <div className="flex items-center justify-center p-4 text-sm text-stone-500">
                      <div className="w-4 h-4 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin mr-2" />
                      Updating...
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-6 bg-stone-900 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <a
                  href={`tel:${selectedBooking.contact_phone}`}
                  className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest"
                >
                  <Phone className="w-3 h-3" />
                  Call Now
                </a>
              </div>
              {selectedBooking.call_id && (
                <Link
                  to={`/calls/${selectedBooking.call_id}`}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all backdrop-blur-md"
                >
                  Analysis & Recording
                  <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getStatusStyle(status) {
  switch (status?.toLowerCase()) {
    case 'booked': return 'bg-blue-50 text-blue-700 border-blue-100 hover:border-blue-200';
    case 'confirmed': return 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:border-emerald-200';
    case 'completed': return 'bg-purple-50 text-purple-700 border-purple-100 hover:border-purple-200';
    case 'rescheduled': return 'bg-amber-50 text-amber-700 border-amber-100 hover:border-amber-200';
    case 'cancelled': return 'bg-red-50 text-red-700 border-red-100 hover:border-red-200';
    default: return 'bg-stone-100 text-stone-700 border-stone-200 hover:border-stone-300';
  }
}

function getStatusSlugColor(status) {
  switch (status?.toLowerCase()) {
    case 'booked': return 'bg-blue-500';
    case 'confirmed': return 'bg-emerald-500';
    case 'completed': return 'bg-purple-500';
    case 'rescheduled': return 'bg-amber-500';
    case 'cancelled': return 'bg-red-500';
    default: return 'bg-stone-500';
  }
}
