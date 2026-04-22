import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { createTenant, getUser } from "../api";

export default function AddLocation() {
  const navigate = useNavigate();
  const user = getUser();
  const { tenantId, tenants } = useOutletContext();

  const parentTenant = tenants?.find(t => t.business_type === 'parent') || tenants?.[0];

  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState(parentTenant?.company_name || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null);

  // Only parent accounts can add locations
  if (!parentTenant || parentTenant.business_type !== 'parent') {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <h2 className="text-lg font-bold text-amber-900 mb-2">Multi-location not enabled</h2>
          <p className="text-sm text-amber-700">
            Your account is set up as a single location. To manage multiple locations, please contact support to upgrade your account type.
          </p>
          <button
            onClick={() => navigate("/dashboard")}
            className="mt-4 px-4 py-2 bg-stone-900 text-white text-sm font-bold rounded-xl hover:bg-stone-800 transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        company_name: companyName.trim() || name.trim(),
        business_type: "location",
        parent_id: parentTenant.id,
      };

      const data = await createTenant(payload);
      setSuccess(data.tenant);
    } catch (err) {
      setError(err.message || "Failed to create location");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <div className="bg-white rounded-2xl shadow-xl border border-stone-200/70 p-8 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-black text-stone-900 mb-2">Location Created!</h2>
          <p className="text-sm text-stone-500 mb-2">
            <strong>{success.name}</strong> has been added under <strong>{parentTenant.name}</strong>.
          </p>
          <p className="text-xs text-stone-400 mb-6">
            You can now switch to this location using the location selector in the header to configure its phone number and AI settings.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate("/dashboard")}
              className="px-5 py-2.5 bg-stone-900 text-white text-sm font-bold rounded-xl hover:bg-stone-800 transition-colors"
            >
              Go to Dashboard
            </button>
            <button
              onClick={() => { setSuccess(null); setName(""); }}
              className="px-5 py-2.5 border border-stone-300 text-stone-700 text-sm font-bold rounded-xl hover:bg-stone-50 transition-colors"
            >
              Add Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto mt-8">
      <div className="mb-6">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-stone-500 hover:text-stone-700 font-medium flex items-center gap-1 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-xl border border-stone-200/70 p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-stone-900 text-white flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-black text-stone-900">Add New Location</h1>
            <p className="text-xs text-stone-500">
              Adding to <strong>{parentTenant.name}</strong>
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 mt-0.5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div>
            <label htmlFor="location_name" className="block text-sm font-medium text-stone-700 mb-1.5">
              Location Name <span className="text-red-500">*</span>
            </label>
            <input
              id="location_name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. New York Office, NJ Branch"
              required
              className="w-full px-3.5 py-2.5 border border-stone-300 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent transition-shadow"
            />
          </div>

          <div>
            <label htmlFor="location_company" className="block text-sm font-medium text-stone-700 mb-1.5">
              Company Name
            </label>
            <input
              id="location_company"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={parentTenant?.company_name || "Same as parent"}
              className="w-full px-3.5 py-2.5 border border-stone-300 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent transition-shadow"
            />
            <p className="mt-1 text-xs text-stone-400">Defaults to the parent company name.</p>
          </div>

          <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
            <p className="text-sm text-blue-800 font-medium">
              📍 Each location gets its own phone number, AI settings, and lead tracking. Configure them after creating.
            </p>
          </div>

          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="w-full mt-2 py-3 bg-stone-900 text-white text-sm font-semibold rounded-xl hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 shadow-sm hover:shadow-md"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating…
              </span>
            ) : (
              "Create Location"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
