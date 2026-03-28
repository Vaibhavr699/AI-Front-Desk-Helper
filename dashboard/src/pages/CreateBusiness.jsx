import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTenant, getUser } from "../api";

const TENANT_STORAGE_KEY = "tenantId";

export default function CreateBusiness() {
  const navigate = useNavigate();
  const user = getUser();
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (user?.tenant_id) {
    navigate("/", { replace: true });
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const payload = {
        name: name.trim() || companyName.trim(),
        company_name: companyName.trim() || name.trim(),
      };

      const data = await createTenant(payload);
      if (data.tenant?.id) {
        localStorage.setItem(TENANT_STORAGE_KEY, data.tenant.id);
      }
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err.message || "Failed to create business");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = name.trim() && companyName.trim() && !loading;

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 to-stone-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg pb-8 pt-8">
        {/* Header */}
        <div className="text-center mb-8 mt-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-stone-900 to-stone-700 text-white mb-4 shadow-xl">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L14.85 8.65L22 9.25L16.5 13.9L18.1 21L12 17.25L5.9 21L7.5 13.9L2 9.25L9.15 8.65L12 2Z" fill="currentColor" />
            </svg>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            AI Front Desk <span className="text-stone-400">Helper</span>
          </h1>
          <p className="mt-2 text-sm text-stone-500 max-w-sm mx-auto">
            Create your intelligent assistant in seconds. You'll pick a dedicated phone number after choosing a plan.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-stone-200/70 p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 mt-0.5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-5">
              {/* Company name */}
              <div>
                <label htmlFor="company_name" className="block text-sm font-medium text-stone-700 mb-1.5">
                  Company name <span className="text-red-500">*</span>
                </label>
                <input
                  id="company_name"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Painting Co"
                  required
                  className="w-full px-3.5 py-2.5 border border-stone-300 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent transition-shadow"
                />
              </div>

              {/* Display name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1.5">
                  Display name <span className="text-red-500">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Painting"
                  required
                  className="w-full px-3.5 py-2.5 border border-stone-300 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent transition-shadow"
                />
                <p className="mt-1 text-xs text-stone-500">
                  Shown in the dashboard. Can match company name.
                </p>
              </div>
            </div>

            {/* Info banner about numbers */}
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
              <p className="text-sm text-blue-800 font-medium">
                📞 After choosing a plan, you'll be able to pick a dedicated AI phone number from Settings.
              </p>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full mt-4 py-3 bg-stone-900 text-white text-sm font-semibold rounded-xl hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 shadow-sm hover:shadow-md"
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
                "Create Business"
              )}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-stone-400">
          You'll select a plan and configure your AI phone number after setup.
        </p>
      </div>
    </div>
  );
}
