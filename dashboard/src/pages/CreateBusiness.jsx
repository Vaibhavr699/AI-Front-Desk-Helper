import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createTenant, getUser, getAvailableNumbers } from "../api";

const TENANT_STORAGE_KEY = "tenantId";

export default function CreateBusiness() {
  const navigate = useNavigate();
  const user = getUser();
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  
  // BYOT State
  const [showByot, setShowByot] = useState(false);
  const [byotSid, setByotSid] = useState("");
  const [byotToken, setByotToken] = useState("");
  const [byotPhone, setByotPhone] = useState("");

  // Number Selection State
  const [availableNumbers, setAvailableNumbers] = useState([]);
  const [loadingNumbers, setLoadingNumbers] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [areaCode, setAreaCode] = useState("");

  if (user?.tenant_id) {
    navigate("/", { replace: true });
    return null;
  }

  const fetchNumbers = async (code = "") => {
    setLoadingNumbers(true);
    setError("");
    try {
      const res = await getAvailableNumbers(code);
      setAvailableNumbers(res.numbers || []);
      if (res.numbers?.length > 0) {
        setSelectedNumber(res.numbers[0].phoneNumber);
      } else {
        setSelectedNumber(null);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to fetch available phone numbers. Try a different area code.");
      setAvailableNumbers([]);
    } finally {
      setLoadingNumbers(false);
    }
  };

  // Fetch initial numbers on mount
  useEffect(() => {
    fetchNumbers();
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchNumbers(areaCode);
  };

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
      if (showByot && byotSid.trim() && byotToken.trim()) {
        payload.twilio_account_sid = byotSid.trim();
        payload.twilio_auth_token = byotToken.trim();
        if (byotPhone.trim()) {
          const digits = byotPhone.replace(/\D/g, "");
          payload.phone = digits.length === 11 ? `+${digits}` : `+1${digits}`;
        }
      } else if (!showByot) {
        // Use Platform - require a selected number unless fallback on backend kicks in
        if (!selectedNumber) {
           throw new Error("Please select a dedicated phone number.");
        }
        payload.assigned_number = selectedNumber;
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
      <div className="w-full max-w-lg overflow-y-auto max-h-[90vh] pb-8 pt-8 no-scrollbar">
        {/* Header */}
        <div className="text-center mb-8 mt-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-stone-900 text-white mb-4 shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008V7.5Z" />
            </svg>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900">
            Set up your business
          </h1>
          <p className="mt-2 text-sm text-stone-500 max-w-sm mx-auto">
            Create your AI front desk in seconds. Pick a dedicated local forwarding number.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-stone-200/70 p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-xl animate-in slide-in-from-top-2">
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

            {/* Number Selection Section */}
            {!showByot && (
                <div className="space-y-3 pt-4 border-t border-stone-100">
                    <div className="flex justify-between items-center mb-1">
                        <label className="block text-sm font-medium text-stone-700">
                            Choose your AI Number <span className="text-red-500">*</span>
                        </label>
                    </div>

                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Area code (e.g. 415)"
                            value={areaCode}
                            title="Search by Area Code"
                            onChange={(e) => setAreaCode(e.target.value)}
                            onKeyDown={(e) => { if(e.key === 'Enter') handleSearch(e); }}
                            className="flex-1 px-3 py-2 border border-stone-300 rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent"
                            maxLength={3}
                        />
                        <button 
                            type="button" 
                            onClick={handleSearch}
                            disabled={loadingNumbers}
                            title="Search"
                            className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-sm font-medium transition disabled:opacity-50 flex items-center"
                        >
                            {loadingNumbers ? (
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                            ) : "Search"}
                        </button>
                    </div>

                    <div className="max-h-48 overflow-y-auto border border-stone-200 rounded-lg bg-stone-50/50">
                        {loadingNumbers ? (
                            <div className="p-4 text-center text-sm text-stone-500">Searching inventory...</div>
                        ) : availableNumbers.length === 0 ? (
                            <div className="p-4 text-center text-sm text-stone-500">No numbers found matching area code. Try another.</div>
                        ) : (
                            <div className="divide-y divide-stone-100">
                                {availableNumbers.map((num) => (
                                    <label
                                        key={num.phoneNumber}
                                        className={`flex items-center p-3 cursor-pointer transition-colors ${
                                            selectedNumber === num.phoneNumber ? "bg-indigo-50/70 border-l-2 border-l-indigo-500" : "hover:bg-white border-l-2 border-l-transparent"
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name="ai_number"
                                            value={num.phoneNumber}
                                            checked={selectedNumber === num.phoneNumber}
                                            onChange={() => setSelectedNumber(num.phoneNumber)}
                                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                                        />
                                        <div className="ml-3 flex flex-col">
                                            <span className={`text-sm font-medium ${selectedNumber === num.phoneNumber ? "text-indigo-900" : "text-stone-900"}`}>
                                                {num.friendlyName}
                                            </span>
                                            {num.locality && num.region && (
                                                <span className="text-xs text-stone-500">
                                                    {num.locality}, {num.region}
                                                </span>
                                            )}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* BYOT Section */}
            <div className="rounded-xl border border-stone-200 overflow-hidden mt-4">
              <button
                type="button"
                onClick={() => setShowByot(!showByot)}
                className="w-full flex items-center justify-between px-4 py-3 text-left bg-stone-50 hover:bg-stone-100 transition-colors"
              >
                <div>
                  <span className="text-sm font-medium text-stone-700">Use your own Twilio account</span>
                  <span className="text-xs text-stone-400 ml-2">(advanced)</span>
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
                  <p className="text-xs text-stone-500">If you have your own Twilio account and numbers, enter your credentials and phone number here.</p>
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
                  Creating & Procuring Number…
                </span>
              ) : (
                "Create business & activate AI"
              )}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-stone-400">
          Your AI number is procured from Twilio dynamically. Submitting this form activates the number instantly.
        </p>
      </div>
    </div>
  );
}
