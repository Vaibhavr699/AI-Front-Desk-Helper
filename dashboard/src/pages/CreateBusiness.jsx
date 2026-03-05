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
  const [showByot, setShowByot] = useState(false);
  const [byotSid, setByotSid] = useState("");
  const [byotToken, setByotToken] = useState("");
  const [byotPhone, setByotPhone] = useState("");

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
      // Include BYOT credentials + phone if provided
      if (byotSid.trim() && byotToken.trim()) {
        payload.twilio_account_sid = byotSid.trim();
        payload.twilio_auth_token = byotToken.trim();
        if (byotPhone.trim()) {
          const digits = byotPhone.replace(/\D/g, "");
          payload.phone = digits.length === 11 ? `+${digits}` : `+1${digits}`;
        }
      }

      const data = await createTenant(payload);
      if (data.tenant?.id) {
        localStorage.setItem(TENANT_STORAGE_KEY, data.tenant.id);
      }
      window.location.href = "/";
    } catch (err) {
      setError(err.message || "Failed to create business");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = name.trim() && companyName.trim() && !loading;

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 to-stone-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-stone-900 text-white mb-4 shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008V7.5Z" />
            </svg>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900">
            Set up your business
          </h1>
          <p className="mt-2 text-sm text-stone-500 max-w-sm mx-auto">
            Create your AI front desk in seconds. We'll assign you a dedicated phone number automatically.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-stone-200/70 p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 mt-0.5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

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

            {/* BYOT Section */}
            <div className="rounded-xl border border-stone-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowByot(!showByot)}
                className="w-full flex items-center justify-between px-4 py-3 text-left bg-stone-50 hover:bg-stone-100 transition-colors"
              >
                <div>
                  <span className="text-sm font-medium text-stone-700">Use your own Twilio account</span>
                  <span className="text-xs text-stone-400 ml-2">(optional)</span>
                </div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={`w-4 h-4 text-stone-400 transition-transform ${showByot ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {showByot && (
                <div className="px-4 py-3 space-y-3 border-t border-stone-200 bg-white">
                  <p className="text-xs text-stone-500">If you have your own Twilio account and numbers, enter your credentials and phone number here. Otherwise we'll assign you one automatically.</p>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Twilio Account SID</label>
                    <input
                      type="text"
                      value={byotSid}
                      onChange={(e) => setByotSid(e.target.value)}
                      placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 placeholder-stone-400 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Twilio Auth Token</label>
                    <input
                      type="password"
                      value={byotToken}
                      onChange={(e) => setByotToken(e.target.value)}
                      placeholder="Enter your auth token"
                      autoComplete="new-password"
                      className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 placeholder-stone-400 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Your Twilio Phone Number</label>
                    <input
                      type="tel"
                      value={byotPhone}
                      onChange={(e) => setByotPhone(e.target.value)}
                      placeholder="+18076055898"
                      className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 placeholder-stone-400 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent"
                    />
                  </div>
                  {byotSid && !byotToken && (
                    <p className="text-xs text-amber-600">Both Account SID and Auth Token are required to use your own Twilio account.</p>
                  )}
                </div>
              )}
            </div>

            {/* Info box */}
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-50 border border-emerald-100">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <p className="text-xs text-emerald-700 leading-relaxed">
                <span className="font-semibold">Instant setup:</span> We'll assign you a dedicated AI phone number automatically.
                After setup, simply forward your main business line to that number and your AI receptionist is live.
              </p>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-3 bg-stone-900 text-white text-sm font-semibold rounded-xl hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 shadow-sm hover:shadow-md"
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
                "Create business & activate AI"
              )}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-stone-400">
          Your AI forwarding number will be assigned instantly. You can customize your AI in Settings after setup.
        </p>
      </div>
    </div>
  );
}
