import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getBookings } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";

export default function Bookings({ tenantId }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    getBookings(tenantId)
      .then((data) => setBookings(data.bookings || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (!tenantId) {
    return (
      <div className="px-0">
        <p className="text-stone-500 text-sm sm:text-base">Select a business to view bookings.</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="px-0 flex items-center justify-center py-20">
        <LumaSpin />
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-0">
        <p className="text-red-600 text-sm sm:text-base">{error}</p>
      </div>
    );
  }

  return (
    <div className="px-0">
      <h1 className="text-xl sm:text-2xl font-semibold text-stone-900 mb-4 sm:mb-6">
        Bookings
      </h1>
      <p className="text-sm text-stone-500 mb-4">Appointments and estimates booked by the assistant.</p>
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200">
            <thead>
              <tr>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider hidden sm:table-cell">
                  Phone
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                  Preferred date
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider hidden md:table-cell">
                  Status
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                  CRM
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">
                  <span className="sr-only">Call</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {bookings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 sm:px-6 text-center text-sm text-stone-500">
                    No bookings yet.
                  </td>
                </tr>
              ) : (
                bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-stone-50/80">
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-900">
                      {b.contact_name || "—"}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600 whitespace-nowrap hidden sm:table-cell">
                      {b.contact_phone || "—"}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600 whitespace-nowrap">
                      {b.preferred_date ? new Date(b.preferred_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600 hidden md:table-cell">
                      {b.status || "—"}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm">
                      {b.crm_synced_at ? (
                        <span className="text-emerald-600" title={"Synced " + new Date(b.crm_synced_at).toLocaleString()}>
                          Synced
                        </span>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-right">
                      {b.call_id ? (
                        <Link
                          to={"/calls/" + b.call_id}
                          className="text-sm font-medium text-brand-600 hover:text-brand-700"
                        >
                          View call
                        </Link>
                      ) : (
                        <span className="text-stone-400 text-sm">—</span>
                      )}
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
