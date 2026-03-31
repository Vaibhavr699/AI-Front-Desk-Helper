import { useState, useEffect } from "react";
import { Outlet, Link } from "react-router-dom";
import CookieConsent from "react-cookie-consent";
import { useToast } from "../components/ui/Toast";
import { useRef } from "react";
import { getUsage, getTenants, getUser } from "../api";
import { Header, Sidebar } from "../components";
import { AlertTriangle } from "lucide-react";

const TENANT_STORAGE_KEY = "tenantId";
const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";

function ChatWidget({ tenantId }) {
  useEffect(() => {
    if (!tenantId) return;

    const scriptId = "ai-front-desk-chat-widget";
    const existing = document.getElementById(scriptId);
    if (existing) existing.remove();

    // Remove any existing widget UI from DOM if script is being re-injected
    const toggle = document.getElementById("ai-chat-toggle");
    if (toggle) toggle.remove();
    const container = document.getElementById("ai-chat-container");
    if (container) container.remove();
    const callout = document.getElementById("ai-chat-callout");
    if (callout) callout.remove();

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `${window.location.protocol}//${window.location.hostname}:3001/chat-widget.js`;
    script.setAttribute("data-tenant-id", tenantId);
    script.defer = true;
    document.body.appendChild(script);

    return () => {
      const s = document.getElementById(scriptId);
      if (s) s.remove();
    };
  }, [tenantId]);

  return null;
}

export default function DashboardLayout() {
  const [tenants, setTenants] = useState([]);
  const user = getUser();
  const [tenantId, setTenantId] = useState(() => {
    const stored = localStorage.getItem("tenantId");
    if (stored === "all") return user?.tenant_id || "";
    return stored || user?.tenant_id || "";
  });
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [impersonating, setImpersonating] = useState(
    () => localStorage.getItem("impersonate_tenant_id")
  );
  const impersonateName = localStorage.getItem("impersonate_tenant_name");
  const { success } = useToast();
  const [usageStatus, setUsageStatus] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const isFirstRender = useRef(true);
  const prevTenantIdRef = useRef(null);

  useEffect(() => {
    // Override tenantId if impersonating
    if (impersonating) {
      setTenantId(impersonating);
    }
  }, [impersonating]);

  function stopImpersonating() {
    localStorage.removeItem("impersonate_tenant_id");
    localStorage.removeItem("impersonate_tenant_name");
    setImpersonating(null);
    setTenantId(user?.tenant_id || "");
    window.location.href = "/admin"; // Go back to admin
  }

  const [tenant, setTenant] = useState(null);
  const [isSuspended, setIsSuspended] = useState(false);

  const fetchUsage = async (id) => {
    if (!id || id === 'all') return;
    setUsageLoading(true);
    try {
      const data = await getUsage(id);
      setUsageStatus(data.status);
    } catch (e) {
      console.error("[DashboardLayout] Usage fetch failed:", e);
    } finally {
      setUsageLoading(false);
    }
  };

  useEffect(() => {
    getTenants()
      .then((data) => {
        const list = data.tenants || [];
        console.log("[DashboardLayout] Fetched tenants:", list.length, list.map(t => t.name + " (" + t.business_type + ")"));
        setTenants(list);
        
        // Find the current active tenant from the list
        const active = list.find(t => t.id === tenantId) || list[0];
        if (active) {
          setTenant(active);
          setIsSuspended(active.is_suspended && !user?.is_super_admin && !impersonating);
          if (!tenantId) setTenantId(active.id);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch tenants:", err);
        setTenants([]);
      });
  }, [impersonating]);

  // When tenantId changes (e.g. user switches location), update the active tenant from existing list
  useEffect(() => {
    if (tenants.length > 0 && tenantId) {
      const active = tenants.find(t => t.id === tenantId);
      if (active) {
        setTenant(active);
        setIsSuspended(active.is_suspended && !user?.is_super_admin && !impersonating);
        const hasIdChanged = prevTenantIdRef.current && prevTenantIdRef.current !== tenantId;
        if (!isFirstRender.current && hasIdChanged) {
          const locationName = tenantId === "all" ? "Reporting" : active.name;
          success(`Switched to: ${locationName}`);
        }
        prevTenantIdRef.current = tenantId;
        fetchUsage(tenantId);
      }
    }
    if (tenants.length > 0) {
      isFirstRender.current = false;
    }
  }, [tenantId, tenants]);

  useEffect(() => {
    if (tenantId) {
      localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
    }
  }, [tenantId]);

  function openMobileSidebar() {
    setSidebarMobileOpen(true);
  }

  function closeMobileSidebar() {
    setSidebarMobileOpen(false);
  }

  return (
    <div className="h-screen bg-stone-100 flex flex-col overflow-hidden">
      {impersonating && (
        <div className="bg-amber-500 text-white px-6 py-2 flex items-center justify-between text-sm font-bold shadow-lg relative z-[60]">
          <div className="flex items-center gap-2">
            <span className="animate-pulse">⚠️</span>
            <span>Impersonating: <span className="font-black underline">{impersonateName}</span></span>
          </div>
          <button 
            onClick={stopImpersonating}
            className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider transition-all"
          >
            End Session
          </button>
        </div>
      )}

      {/* Usage Warning Banner */}
      {!isSuspended && usageStatus?.reached && (
        <div className={`px-6 py-2 flex items-center justify-between text-xs font-bold shadow-sm relative z-[55] transition-all duration-300 ${usageStatus.reached >= 100 ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-900 border-b border-amber-200'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${usageStatus.reached >= 100 ? 'bg-white/20' : 'bg-amber-500/10 text-amber-600'}`}>
              <AlertTriangle size={14} />
            </div>
            <span>
              {usageStatus.reached >= 100 
                ? `CRITICAL: Monthly limit reached (${Math.round(usageStatus.percent)}%). AI services may be restricted.`
                : `WARNING: Usage has reached ${usageStatus.reached}% of your monthly allowance.`
              }
            </span>
          </div>
          <Link to="/billing" className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${usageStatus.reached >= 100 ? 'bg-white text-red-600 hover:bg-stone-50' : 'bg-amber-900 text-white hover:bg-black'}`}>
            {usageStatus.reached >= 100 ? 'Upgrade Now' : 'Manage Usage'}
          </Link>
        </div>
      )}

      <Header
        tenantId={tenantId}
        tenants={tenants}
        onTenantChange={setTenantId}
        onMenuClick={openMobileSidebar}
      />

      {isSuspended && (
        <div className="fixed inset-0 z-[100] bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-3xl">⚠️</span>
            </div>
            <h2 className="text-2xl font-black text-stone-900 mb-2">Account Suspended</h2>
            <p className="text-stone-500 mb-8">
              Your account has been suspended. Please update your billing information or contact support to restore service.
            </p>
            <div className="space-y-3">
              <a 
                href="/plans" 
                className="block w-full bg-stone-900 hover:bg-black text-white py-3 rounded-xl font-bold transition-all shadow-lg"
              >
                Go to Billing
              </a>
              <button 
                onClick={() => window.location.href = "/login"}
                className="block w-full text-stone-400 hover:text-stone-600 font-bold py-2 transition-all"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Desktop sidebar: fixed height, no scroll */}
        <div className="hidden lg:block h-full shrink-0">
          <Sidebar activeTenant={tenant} />
        </div>

        {/* Mobile sidebar overlay */}
        {sidebarMobileOpen && (
          <div
            className="lg:hidden fixed inset-0 z-40 bg-stone-900/20 backdrop-blur-sm"
            onClick={closeMobileSidebar}
            aria-hidden
          />
        )}
        <div
          className={`lg:hidden fixed inset-y-0 left-0 z-50 w-56 shadow-xl transform transition-transform duration-200 ease-out ${sidebarMobileOpen ? "translate-x-0" : "-translate-x-full"
            }`}
        >
          <Sidebar
            closeMobile={closeMobileSidebar}
            activeTenant={tenant}
          />
        </div>

        <main className="flex-1 min-w-0 min-h-0 overflow-auto flex flex-col">
          <div className="flex-1 max-w-full w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <Outlet context={{ tenantId: tenantId || null, tenants, onTenantChange: setTenantId }} />
          </div>
        </main>
      </div>

      <ChatWidget tenantId={tenantId} />

      <CookieConsent
        location="bottom"
        cookieName="ai_front_desk_cookie_consent"
        enableDeclineButton
        buttonText="Accept"
        declineButtonText="Decline"
        expires={365}
        style={{
          background: "#292524",
          alignItems: "center",
          justifyContent: "center",
          padding: "8px 14px",
          flexWrap: "wrap",
          gap: "10px",
          left: "50%",
          transform: "translateX(-50%)",
          right: "auto",
          width: "max-content",
          maxWidth: "min(680px, 96vw)",
          bottom: "16px",
          borderRadius: "8px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
          zIndex: 99998,
          marginBottom: "4px",
        }}
        contentStyle={{
          flex: "1 1 280px",
          margin: 0,
          fontSize: "13px",
          lineHeight: 1.4,
          minWidth: 0,
        }}
        buttonWrapperClasses="flex shrink-0 gap-1"
        buttonStyle={{
          background: "#1c1917",
          color: "#fafaf9",
          fontWeight: 600,
          padding: "4px 10px",
          borderRadius: "6px",
          border: "1px solid #57534e",
          fontSize: "12px",
        }}
        declineButtonStyle={{
          background: "transparent",
          color: "#a8a29e",
          fontWeight: 500,
          padding: "4px 10px",
          borderRadius: "6px",
          border: "1px solid #57534e",
          fontSize: "12px",
        }}
      >
        We use cookies to improve your experience, keep you signed in, and understand how you use the dashboard. By continuing you agree to our use of cookies.{" "}
        <Link to="/cookies" className="underline text-stone-300 hover:text-white">
          Cookie policy
        </Link>
      </CookieConsent>
    </div>
  );
}
