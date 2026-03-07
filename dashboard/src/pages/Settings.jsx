import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getTenant, updateTenant, getPhoneNumbers, addPhoneNumber, deletePhoneNumber } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";

const TENANT_STORAGE_KEY = "tenantId";

export default function Settings({ tenantId }) {
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isNotFound, setIsNotFound] = useState(false);

  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [instructions, setInstructions] = useState("");
  const [transferNumbersRaw, setTransferNumbersRaw] = useState("");
  const [transferSmsBrief, setTransferSmsBrief] = useState("");
  const [crmWebhookUrl, setCrmWebhookUrl] = useState("");
  const [crmType, setCrmType] = useState("webhook");
  const [followUpEnabled, setFollowUpEnabled] = useState(true);
  const [twilioAccountSid, setTwilioAccountSid] = useState("");
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
  const [facebookPageId, setFacebookPageId] = useState("");
  const [facebookPageAccessToken, setFacebookPageAccessToken] = useState("");

  // Phone numbers state
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [phonesLoading, setPhonesLoading] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [phoneAdding, setPhoneAdding] = useState(false);
  const [phoneDeleting, setPhoneDeleting] = useState(null);

  function loadTenant() {
    if (!tenantId) return;
    setError("");
    setIsNotFound(false);
    setLoading(true);
    getTenant(tenantId)
      .then((t) => {
        setTenant(t);
        setWelcomeMessage(t.welcome_message || "");
        setInstructions(t.instructions || "");
        setTransferNumbersRaw(Array.isArray(t.transfer_numbers) ? t.transfer_numbers.join(", ") : "");
        setTransferSmsBrief(t.transfer_sms_brief || "");
        setCrmWebhookUrl(t.crm_webhook_url || "");
        setCrmType(t.crm_type || "webhook");
        setFollowUpEnabled(t.follow_up_enabled !== false);
        setTwilioAccountSid("");
        setTwilioAuthToken("");
        setFacebookPageId(t.facebook_page_id || "");
        setFacebookPageAccessToken("");
      })
      .catch((e) => {
        setError(e.message);
        setIsNotFound(e.message.includes("Not found") || e.message.includes("not found"));
      })
      .finally(() => setLoading(false));
  }

  function clearTenantAndReload() {
    localStorage.removeItem(TENANT_STORAGE_KEY);
    window.location.reload();
  }

  useEffect(() => {
    if (!tenantId) return;
    loadTenant();
    loadPhones();
  }, [tenantId]);

  function loadPhones() {
    if (!tenantId) return;
    setPhonesLoading(true);
    getPhoneNumbers(tenantId)
      .then((data) => setPhoneNumbers(data.phone_numbers || []))
      .catch(() => { })
      .finally(() => setPhonesLoading(false));
  }

  function handleAddPhone(e) {
    e.preventDefault();
    if (!tenantId || !newPhone.trim()) return;
    setPhoneError("");
    setPhoneAdding(true);
    addPhoneNumber(tenantId, newPhone.trim())
      .then(() => {
        setNewPhone("");
        loadPhones();
      })
      .catch((err) => setPhoneError(err.message))
      .finally(() => setPhoneAdding(false));
  }

  function handleDeletePhone(phoneId) {
    if (!confirm("Remove this phone number? Calls to it will no longer be routed to your business.")) return;
    setPhoneDeleting(phoneId);
    deletePhoneNumber(phoneId)
      .then(() => loadPhones())
      .catch((err) => setPhoneError(err.message))
      .finally(() => setPhoneDeleting(null));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!tenantId) return;
    setError("");
    setMessage("");
    setSaving(true);
    const transferNumbers = transferNumbersRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith("+") ? s : `+1${s.replace(/\D/g, "").slice(-10)}`));
    const payload = {
      welcome_message: welcomeMessage || null,
      instructions: instructions || null,
      transfer_numbers: transferNumbers,
      transfer_sms_brief: transferSmsBrief || null,
      crm_webhook_url: crmWebhookUrl || null,
      crm_type: crmType,
      follow_up_enabled: followUpEnabled,
      facebook_page_id: facebookPageId.trim() || null,
    };
    if (facebookPageAccessToken) payload.facebook_page_access_token = facebookPageAccessToken;
    if (twilioAccountSid.trim()) payload.twilio_account_sid = twilioAccountSid.trim();
    if (twilioAuthToken) payload.twilio_auth_token = twilioAuthToken;
    if (!twilioAccountSid.trim() && !twilioAuthToken && tenant?.has_twilio_credentials) {
      payload.twilio_account_sid = null;
      payload.twilio_auth_token = "";
    }
    updateTenant(tenantId, payload)
      .then((updated) => {
        setTenant(updated);
        setMessage("Settings saved.");
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  }

  if (!tenantId) {
    return (
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <p className="text-stone-500">Select a business to manage settings.</p>
      </div>
    );
  }

  const phones = tenant?.phones || [];
  const hasPhone = phones.length > 0;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 max-w-3xl">
      <h1 className="text-xl sm:text-2xl font-semibold text-stone-900 mb-1">
        Settings
      </h1>
      <p className="text-sm text-stone-500 mb-6">
        {tenant?.company_name || tenant?.name || "Business settings"}
      </p>

      {loading && (
        <div className="mb-6 flex items-center justify-center py-20">
          <LumaSpin />
        </div>
      )}

      {error && !loading && (
        <div className="mb-6 rounded-xl border border-stone-200 bg-white shadow-sm p-4">
          <p className="text-sm font-medium text-stone-900">
            {isNotFound ? "Business not found" : "Could not load settings"}
          </p>
          <p className="mt-1 text-sm text-stone-600">
            {isNotFound
              ? "This business was not found or does not exist on this server. You can still edit and save below once the API is available."
              : error}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {isNotFound && (
              <button
                type="button"
                onClick={clearTenantAndReload}
                className="px-3 py-1.5 text-sm font-medium text-white bg-stone-800 rounded-md hover:bg-stone-700"
              >
                Clear selection and reload
              </button>
            )}
            <Link
              to="/tenants"
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-md hover:bg-stone-50"
            >
              View all businesses
            </Link>
            <button
              type="button"
              onClick={loadTenant}
              className="px-3 py-1.5 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-md hover:bg-stone-50"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="mb-6 p-4 rounded-lg bg-stone-100 border border-stone-200">
        <h2 className="text-sm font-medium text-stone-700 mb-2">Plan</h2>
        <p className="text-sm text-stone-600">
          Current plan: <span className="font-medium text-stone-900 capitalize">{tenant?.plan || "basic"}</span>
          {" — "}
          <Link to="/plans" className="text-brand-600 hover:text-brand-700 font-medium">
            View plans & change
          </Link>
        </p>
      </div>

      <div className="mb-8 p-4 rounded-lg bg-stone-200/60 border border-stone-300">
        <h2 className="text-sm font-medium text-stone-700 mb-2">Setup status</h2>
        <ul className="space-y-1.5 text-sm text-stone-600">
          <li className="flex items-center gap-2">
            <span className={phoneNumbers.length > 0 ? "text-emerald-600" : "text-amber-600"}>
              {phoneNumbers.length > 0 ? "●" : "○"}
            </span>
            {phoneNumbers.length > 0
              ? `${phoneNumbers.length} phone number${phoneNumbers.length > 1 ? "s" : ""} active (webhook auto-configured)`
              : "Add a phone number — required for AI to answer calls"}
          </li>
          <li className="flex items-center gap-2">
            <span className={transferNumbersRaw.trim() ? "text-emerald-600" : "text-amber-600"}>
              {transferNumbersRaw.trim() ? "●" : "○"}
            </span>
            {transferNumbersRaw.trim()
              ? "Live transfer number(s) set"
              : "Add a transfer number so calls can be handed off to your team"}
          </li>
          <li className="flex items-center gap-2">
            <span className={crmWebhookUrl ? "text-emerald-600" : "text-stone-400"}>
              {crmWebhookUrl ? "●" : "○"}
            </span>
            {crmWebhookUrl ? "CRM webhook connected" : "CRM webhook optional"}
          </li>
        </ul>
      </div>

      {/* Phone Numbers Section */}
      <div className="mb-8 rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3.5 bg-stone-50 border-b border-stone-200">
          <h2 className="text-sm font-semibold text-stone-800">AI Forwarding Numbers</h2>
          <p className="text-xs text-stone-500 mt-0.5">
            These are your dedicated AI phone numbers. <strong>Forward your business line</strong> to one of these numbers so the AI answers your calls.
          </p>
        </div>

        <div className="p-4">
          {phonesLoading ? (
            <p className="text-sm text-stone-400 py-2">Loading…</p>
          ) : phoneNumbers.length === 0 ? (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <p className="text-xs text-amber-800">No forwarding number assigned. Contact support to get a number assigned to your account.</p>
            </div>
          ) : (
            <>
              <ul className="space-y-2 mb-4">
                {phoneNumbers.map((pn) => (
                  <li key={pn.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-stone-50 border border-stone-200 group">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-stone-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                      </svg>
                      <span className="font-mono text-sm text-stone-800 truncate">{pn.phone}</span>
                      {pn.is_primary && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-700 border border-emerald-200">
                          Primary
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeletePhone(pn.id)}
                      disabled={phoneDeleting === pn.id}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity px-2 py-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md disabled:opacity-40"
                      title="Remove number"
                    >
                      {phoneDeleting === pn.id ? "…" : "Remove"}
                    </button>
                  </li>
                ))}
              </ul>

              {/* Forwarding instructions */}
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 mb-3">
                <p className="text-xs font-semibold text-blue-800 mb-1.5">📞 How to activate call forwarding</p>
                <p className="text-xs text-blue-700 mb-2">
                  Forward your business phone to <strong className="font-mono">{phoneNumbers[0]?.phone}</strong>:
                </p>
                <ul className="text-xs text-blue-700 space-y-1">
                  <li><strong>AT&T / Verizon:</strong> Dial <span className="font-mono bg-blue-100 px-1 rounded">*72</span> then <span className="font-mono">{phoneNumbers[0]?.phone}</span></li>
                  <li><strong>T-Mobile:</strong> Settings → Calls → Call Forwarding → Always Forward</li>
                  <li><strong>VoIP / Comcast:</strong> Portal → Call Settings → Forward All Calls</li>
                  <li><strong>To disable:</strong> Dial <span className="font-mono bg-blue-100 px-1 rounded">*73</span></li>
                </ul>
              </div>
            </>
          )}

          {/* Add phone - for BYOT users or additional numbers */}
          <details className="group">
            <summary className="text-xs text-stone-500 cursor-pointer hover:text-stone-700 select-none">
              + Add another number manually
            </summary>
            <form onSubmit={handleAddPhone} className="flex items-start gap-2 mt-2">
              <div className="flex-1">
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => { setNewPhone(e.target.value); setPhoneError(""); }}
                  placeholder="+18076055898 or 8076055898"
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 placeholder-stone-400 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-transparent"
                />
                {phoneError && <p className="mt-1 text-xs text-red-600">{phoneError}</p>}
              </div>
              <button
                type="submit"
                disabled={!newPhone.trim() || phoneAdding}
                className="px-3.5 py-2 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                {phoneAdding ? "Adding…" : "Add number"}
              </button>
            </form>
          </details>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
        )}
        {message && (
          <p className="text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-md">
            {message}
          </p>
        )}

        <div className="rounded-lg border border-stone-200 bg-stone-50/50 p-4 space-y-3">
          <h3 className="text-sm font-medium text-stone-800">Bring your own Twilio (optional)</h3>
          <p className="text-xs text-stone-500">
            Use your own Twilio account for this business so your numbers, recordings, and SMS use your billing.
          </p>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Twilio Account SID</label>
            <input
              type="text"
              value={twilioAccountSid}
              onChange={(e) => setTwilioAccountSid(e.target.value)}
              placeholder={tenant?.twilio_account_sid_masked || "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
              className="w-full px-3 py-2 border border-stone-300 rounded-md text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono text-sm"
            />
            {tenant?.twilio_account_sid_masked && !twilioAccountSid && (
              <p className="mt-1 text-xs text-stone-500">Current: {tenant.twilio_account_sid_masked}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Twilio Auth Token</label>
            <input
              type="password"
              value={twilioAuthToken}
              onChange={(e) => setTwilioAuthToken(e.target.value)}
              placeholder={tenant?.has_twilio_credentials ? "Leave blank to keep current" : "Optional"}
              autoComplete="new-password"
              className="w-full px-3 py-2 border border-stone-300 rounded-md text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono text-sm"
            />
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-stone-50/50 p-4 space-y-3">
          <h3 className="text-sm font-medium text-stone-800">Facebook Integration</h3>
          <p className="text-xs text-stone-500">
            Connect your Facebook Page so the AI can answer messages on Messenger.
          </p>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Facebook Page ID</label>
            <input
              type="text"
              value={facebookPageId}
              onChange={(e) => setFacebookPageId(e.target.value)}
              placeholder="e.g. 10234567890"
              className="w-full px-3 py-2 border border-stone-300 rounded-md text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">Facebook Page Access Token</label>
            <input
              type="password"
              value={facebookPageAccessToken}
              onChange={(e) => setFacebookPageAccessToken(e.target.value)}
              placeholder={tenant?.facebook_token_masked ? "Leave blank to keep current" : "EAAG..."}
              autoComplete="new-password"
              className="w-full px-3 py-2 border border-stone-300 rounded-md text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono text-sm"
            />
            {tenant?.facebook_token_masked && !facebookPageAccessToken && (
              <p className="mt-1 text-xs text-stone-500">Current: {tenant.facebook_token_masked}</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-stone-50/50 p-4 space-y-3">
          <h3 className="text-sm font-medium text-stone-800">Website Chat Widget</h3>
          <p className="text-xs text-stone-500">
            Copy and paste this script tag into the <code className="bg-stone-200 px-1 rounded">&lt;head&gt;</code> of your website to install the AI chat widget.
          </p>
          <div className="relative">
            <textarea
              readOnly
              value={`<script src="http://116.202.210.102:3001/chat-widget.js" data-tenant-id="${tenant?.id || 'loading...'}" defer></script>`}
              className="w-full px-3 py-2 border border-stone-300 rounded-md text-stone-600 bg-stone-100 font-mono text-xs focus:outline-none resize-none"
              rows={2}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            Transfer numbers
          </label>
          <input
            type="text"
            value={transferNumbersRaw}
            onChange={(e) => setTransferNumbersRaw(e.target.value)}
            placeholder="+14025551234, +14025555678"
            className="w-full px-3 py-2 border border-stone-300 rounded-md text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-stone-500">
            Comma-separated. Where to send calls when a live agent is needed.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            Transfer SMS brief
          </label>
          <textarea
            value={transferSmsBrief}
            onChange={(e) => setTransferSmsBrief(e.target.value)}
            placeholder="Caller is asking about exterior painting, 3-bed home..."
            rows={2}
            className="w-full px-3 py-2 border border-stone-300 rounded-md text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-stone-500">
            Short summary sent to the agent before the call connects.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            CRM webhook URL
          </label>
          <input
            type="url"
            value={crmWebhookUrl}
            onChange={(e) => setCrmWebhookUrl(e.target.value)}
            placeholder="https://hooks.zapier.com/..."
            className="w-full px-3 py-2 border border-stone-300 rounded-md text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-stone-500">
            Bookings and call details are sent here (e.g. Zapier → DripJobs).
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            Welcome message
          </label>
          <textarea
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            placeholder="Thanks for calling. What can we help you with today?"
            rows={2}
            className="w-full px-3 py-2 border border-stone-300 rounded-md text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-stone-500">
            First thing the assistant says when someone calls.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            Assistant instructions
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="You are a professional receptionist. Be warm and helpful. Capture name, phone, address. Offer a free estimate."
            rows={4}
            className="w-full px-3 py-2 border border-stone-300 rounded-md text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-stone-500">
            How the assistant should behave and what to offer.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="follow_up"
            checked={followUpEnabled}
            onChange={(e) => setFollowUpEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
          />
          <label htmlFor="follow_up" className="text-sm text-stone-700">
            Send follow-up SMS (24h, 3d, 5d, 10d after booking)
          </label>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2.5 bg-stone-800 text-white text-sm font-medium rounded-md hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-600 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
