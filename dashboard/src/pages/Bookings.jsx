import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getBookings, updateBooking, getTechnicians } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import { Calendar, List, Users, Clock, CheckCircle2, AlertCircle, MapPin, ChevronRight, Phone } from "lucide-react";
import BookingCalendar from "../components/BookingCalendar";
import TechnicianManager from "../components/TechnicianManager";
import { format } from "date-fns";

export default function Bookings({ tenantId }) {
  const [bookings, setBookings] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("table"); // table, calendar, technicians
  const [selectedBooking, setSelectedBooking] = useState(null);

  useEffect(() => {
    if (!tenantId) return;
    loadData();
  }, [tenantId]);

  // Refetch bookings + technicians when switching to Table or Calendar so the technician dropdown has the latest crew (e.g. after adding someone in Crew tab).
  useEffect(() => {
    if (!tenantId) return;
    if (view === "table" || view === "calendar") {
      loadData();
    }
  }, [view]);

  async function loadData() {
    setLoading(true);
    try {
      const [bookingsData, techsData] = await Promise.all([
        getBookings(tenantId),
        getTechnicians(tenantId)
      ]);
      setBookings(bookingsData.bookings || []);
      setTechnicians(techsData.technicians || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(id, newStatus) {
    try {
      await updateBooking(id, { status: newStatus });
      setBookings(prev => prev.map(b => b.id === id ? { ...b, status: newStatus } : b));
    } catch (e) {
      alert("Failed to update status: " + e.message);
    }
  }

  async function handleTechAssign(id, techId) {
    const value = techId === "" ? null : techId;
    try {
      await updateBooking(id, { technician_id: value });
      const tech = value ? technicians.find(t => t.id === value) : null;
      setBookings(prev => prev.map(b => b.id === id ? { ...b, technician_id: value, technician_name: tech?.name } : b));
    } catch (e) {
      alert("Failed to assign technician: " + e.message);
    }
  }

  if (!tenantId) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-stone-500">
        <Users className="w-12 h-12 mb-2 opacity-20" />
        <p>Select a business to view bookings.</p>
      </div>
    );
  }

  if (loading && bookings.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <LumaSpin />
      </div>
    );
  }

  const stats = {
    total: bookings.length,
    booked: bookings.filter(b => b.status === 'Booked' || b.status === 'scheduled').length,
    confirmed: bookings.filter(b => b.status === 'Confirmed').length,
    completed: bookings.filter(b => b.status === 'Completed').length,
  };

  return (
    <div className="max-w-full space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 tracking-tight">Bookings</h1>
          <p className="text-stone-500 mt-1">Manage your appointments, crew assignments, and schedule.</p>
        </div>
        
        <div className="flex bg-stone-100 p-1 rounded-xl border border-stone-200">
          <button
            onClick={() => setView("table")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              view === "table" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
            }`}
          >
            <List className="w-4 h-4" />
            Table
          </button>
          <button
            onClick={() => setView("calendar")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              view === "calendar" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
            }`}
          >
            <Calendar className="w-4 h-4" />
            Calendar
          </button>
          <button
            onClick={() => setView("technicians")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              view === "technicians" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
            }`}
          >
            <Users className="w-4 h-4" />
            Crew
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      {view !== 'technicians' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <Clock className="w-4 h-4" />
              </div>
              <span className="text-sm font-medium text-stone-500 uppercase tracking-wider">Total</span>
            </div>
            <div className="text-2xl font-bold text-stone-900">{stats.total}</div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                <AlertCircle className="w-4 h-4" />
              </div>
              <span className="text-sm font-medium text-stone-500 uppercase tracking-wider">Pending</span>
            </div>
            <div className="text-2xl font-bold text-stone-900">{stats.booked}</div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <span className="text-sm font-medium text-stone-500 uppercase tracking-wider">Confirmed</span>
            </div>
            <div className="text-2xl font-bold text-stone-900">{stats.confirmed}</div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                <MapPin className="w-4 h-4" />
              </div>
              <span className="text-sm font-medium text-stone-500 uppercase tracking-wider">Completed</span>
            </div>
            <div className="text-2xl font-bold text-stone-900">{stats.completed}</div>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {view === "table" && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-100">
              <thead>
                <tr className="bg-stone-50/50">
                  <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Customer</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Appointment</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Technician</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-stone-400 uppercase tracking-widest">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-stone-400 uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 bg-white">
                {bookings.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-stone-400 text-sm">
                      No bookings found.
                    </td>
                  </tr>
                ) : (
                  bookings.map((b) => (
                    <tr key={b.id} className="group hover:bg-stone-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-stone-900">{b.contact_name || "Unknown"}</span>
                          <span className="text-xs text-stone-500 flex items-center gap-1.5 mt-0.5">
                            <Phone className="w-3 h-3" />
                            {b.contact_phone || "No phone"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm text-stone-700">
                            {b.preferred_date ? format(new Date(b.preferred_date.includes('T') ? b.preferred_date : b.preferred_date + 'T00:00:00'), 'MMM d, yyyy') : "TBD"}
                          </span>
                          <span className="text-xs text-stone-500">
                            {b.appointment_time ? format(new Date(`2000-01-01T${b.appointment_time}`), 'h:mm a') : "No time set"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <select
                          value={b.technician_id || ""}
                          onChange={(e) => handleTechAssign(b.id, e.target.value)}
                          className="bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 text-xs font-medium text-stone-700 outline-none focus:ring-2 focus:ring-stone-900/5 transition-all"
                        >
                          <option value="">Unassigned</option>
                          {technicians.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-4">
                        <select
                          value={b.status || "Booked"}
                          onChange={(e) => handleStatusChange(b.id, e.target.value)}
                          className={`border rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider outline-none transition-all ${getStatusStyle(b.status)}`}
                        >
                          {['Booked', 'Confirmed', 'Completed', 'Rescheduled', 'Cancelled'].map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {b.call_id && (
                            <Link
                              to={`/calls/${b.call_id}`}
                              className="text-black hover:text-stone-900 flex items-center gap-1 text-xs font-medium"
                            >
                              View Call
                              <ChevronRight className="w-3 h-3" />
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "calendar" && (
        <BookingCalendar 
          bookings={bookings} 
          onEventClick={(b) => setSelectedBooking(b)} 
        />
      )}

      {view === "technicians" && (
        <TechnicianManager tenantId={tenantId} />
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
    default: return 'bg-stone-50 text-stone-700 border-stone-100 hover:border-stone-200';
  }
}
