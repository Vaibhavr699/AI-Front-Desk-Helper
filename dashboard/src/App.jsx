import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useOutletContext, useLocation } from "react-router-dom";
import { getUser, getTenant } from "./api";
import { DashboardLayout } from "./layouts";
import SmsTerms from "./pages/SmsTerms";
import SmsConsent from "./pages/SmsConsent";
import Contact from "./pages/Contact";
import { Home, Login, ForgotPassword, ResetPassword, CreateBusiness, Dashboard, Calls, Outbound, CallDetail, Bookings, FollowUps, Metrics, Settings, Tenants, Plans, Leads, LeadDetail, Conversations, Billing, Admin, PrivacyPolicy, TermsOfService, CookiePolicy, Team, SharingRisks, Locations, FranchiseeInvite, Welcome, RollupV5, CallCoach, CallCoachDetail, TeamAnalytics, CoachingSettings } from "./pages";
import InHomeSessionDetail from "./pages/InHomeSessionDetail";
import InHomeSessions from "./pages/InHomeSessions";
import FranchisePaywall from "./pages/FranchisePaywall";
import HqLocations from "./pages/HqLocations";
import { ToastProvider } from "./components/ui/Toast";
import { HostnameBrandingProvider } from "./contexts/HostnameBrandingContext";
import "./App.css";
import Reviews from "./pages/Reviews";
import GoogleBusinessProfile from "./pages/GoogleBusinessProfile";
import OutreachLog from "./pages/OutreachLog";

// ── Phase 2 WL Reseller Account Type (Apr 20, 2026) ────────────────────────
import Reseller from "./pages/Reseller";
import ResellerPlans from "./pages/ResellerPlans";
import ResellerWelcome from "./pages/ResellerWelcome";
import ResellerPublicSignup from "./pages/ResellerPublicSignup";

// ── Phase 3 Reseller Ops Item 3 — Churn Direct Billing (Apr 23, 2026) ─────
import ChurnSetupDirectBilling from "./pages/ChurnSetupDirectBilling";
import ChurnWelcome from "./pages/ChurnWelcome";

/** Scroll window to top on every route change so new pages (e.g. policy, login) are not shown at previous scroll position. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Protected({ children }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/** Rendered when route is /login so we read user on this render (after logout, App may not have re-rendered). */
function LoginRoute() {
  const user = getUser();
  if (user) {
    const to = user.role === 'staff' ? "/bookings" : "/dashboard";
    return <Navigate to={to} replace />;
  }
  return (
    <Login
      onLogin={(u) => {
        const to = u?.role === 'staff' ? "/bookings" : "/dashboard";
        window.location.href = to;
      }}
    />
  );
}

/** Logged-in layout wrapper: handles tenant guards and renders DashboardLayout. */
function AuthenticatedRoot() {
  const user = getUser();
  const { pathname } = useLocation();
  const [activeTenant, setActiveTenant] = useState(null);
  const [tenantLoaded, setTenantLoaded] = useState(false);
  const isImpersonating = !!localStorage.getItem("impersonate_tenant_id");

  // Fetch active tenant once to drive account_type-based routing.
  // Resellers don't belong on operational pages (/dashboard, /calls, etc);
  // this redirects them to /reseller which is their home.
  useEffect(() => {
    const impersonatedId = localStorage.getItem("impersonate_tenant_id");
    const targetId = impersonatedId || user?.tenant_id;
    if (!targetId) {
      setTenantLoaded(true);
      return;
    }
    getTenant(targetId)
      .then((t) => setActiveTenant(t))
      .catch(() => {})
      .finally(() => setTenantLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.tenant_id]);

  if (!user) return <Navigate to="/login" replace />;
  if (user?.role === 'staff' && pathname === '/dashboard') {
    return <Navigate to="/bookings" replace />;
  }
  if (user && !user.tenant_id && user.is_super_admin && !pathname.startsWith("/admin") && !isImpersonating) {
    return <Navigate to="/admin/tenants" replace />;
  }
  if (user && !user.tenant_id && !user.is_super_admin && pathname !== "/create-business") {
    return <Navigate to="/create-business" replace />;
  }

  // Reseller guard: redirect to /reseller unless they're on a reseller-
  // appropriate page already. Superadmin impersonation bypasses this so
  // Drew can still view a reseller tenant's perspective from admin.
  if (
    tenantLoaded &&
    activeTenant?.account_type === "reseller" &&
    !isImpersonating &&
    !pathname.startsWith("/reseller") &&
    !pathname.startsWith("/settings") &&
    !pathname.startsWith("/admin")
  ) {
    return <Navigate to="/reseller" replace />;
  }

  // Franchise zee paywall guard (Apr 29, 2026 — Phase 6).
  // Zees on plan='franchise' without an active subscription get redirected
  // to /franchise-paywall. Manual-billing zees bypass via plan_overrides.billing_mode.
  // Superadmin impersonation also bypasses (so Drew can view any zee dashboard).
  if (
    tenantLoaded &&
    activeTenant?.plan === "franchise" &&
    activeTenant?.subscription_status !== "active" &&
    activeTenant?.plan_overrides?.billing_mode !== "manual" &&
    !isImpersonating &&
    pathname !== "/franchise-paywall"
  ) {
    return <Navigate to="/franchise-paywall" replace />;
  }

  return (
    <Protected>
      <DashboardLayout />
    </Protected>
  );
}
/** Root "/" route: landing page for guests, redirect to /dashboard for logged-in users. */
function RootElement() {
  const user = getUser();
  if (user) {
    const to = user.role === 'staff' ? "/bookings" : "/dashboard";
    return <Navigate to={to} replace />;
  }
  return <Home />;
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <ToastProvider>
        <HostnameBrandingProvider>
        <ScrollToTop />
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<RootElement />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/franchisee-invite/:token" element={<FranchiseeInvite />} />
          <Route path="/reseller/:code/signup" element={<ResellerPublicSignup />} />
          <Route path="/churn/setup-direct-billing/:token" element={<ChurnSetupDirectBilling />} />
          <Route path="/churn/welcome" element={<ChurnWelcome />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/franchise-paywall" element={<Protected><FranchisePaywall /></Protected>} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/sms-terms" element={<SmsTerms />} />
          <Route path="/sms-consent" element={<SmsConsent />} />
          <Route path="/sms-policy" element={<Navigate to="/sms-terms" replace />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/cookies" element={<CookiePolicy />} />
          {/* Authenticated dashboard routes */}
          <Route element={<AuthenticatedRoot />}>
            <Route path="/dashboard" element={<DashboardWithContext />} />
            <Route path="/create-business" element={<CreateBusiness />} />
            <Route path="/calls" element={<CallsWithContext />} />
           <Route path="/outreach-log" element={<OutreachLogWithContext />} />
            <Route path="/calls/:id" element={<CallDetail />} />
            <Route path="/outbound" element={<OutboundWithContext />} />
            <Route path="/leads" element={<LeadsWithContext />} />
            <Route path="/leads/:id" element={<LeadDetailWithContext />} />
            <Route path="/bookings" element={<BookingsWithContext />} />
            <Route path="/follow-ups" element={<FollowUpsWithContext />} />
            <Route path="/conversations" element={<ConversationsWithContext />} />
            <Route path="/metrics" element={<MetricsWithContext />} />
            <Route path="/plans" element={<PlansWithContext />} />
            <Route path="/billing" element={<BillingWithContext />} />
            <Route path="/settings" element={<SettingsWithContext />} />
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/rollup-v5" element={<RollupV5WithContext />} />
            <Route path="/call-coach" element={<CallCoachWithContext />} />
            <Route path="/call-coach/team-analytics" element={<TeamAnalyticsWithContext />} />
            <Route path="/call-coach/settings" element={<CoachingSettings />} />
            <Route path="/call-coach/in-home" element={<InHomeSessionsWithContext />} />
            <Route path="/call-coach/in-home/:id" element={<InHomeSessionDetailWithContext />} />
            <Route path="/call-coach/:id" element={<CallCoachDetailWithContext />} />
            <Route path="/hq-locations" element={<HqLocations />} />
            <Route path="/admin" element={<Navigate to="/admin/tenants" replace />} />
            <Route path="/admin/tenants" element={<AdminWithContext view="tenants" />} />
            <Route path="/admin/admins" element={<AdminWithContext view="admins" />} />
            <Route path="/locations" element={<LocationsWithContext />} />
            <Route path="/team" element={<Team />} />
            <Route path="/team/sharing-risks" element={<SharingRisks />} />
            <Route path="/reviews" element={<ReviewsWithContext />} />
            <Route path="/google-business" element={<GoogleBusinessWithContext />} />
            {/* Reseller (authenticated) — Phase 2 WL */}
            <Route path="/reseller" element={<Reseller />} />
            <Route path="/reseller/plans" element={<ResellerPlans />} />
            <Route path="/reseller/welcome" element={<ResellerWelcome />} />
          </Route>
        </Routes>
          </HostnameBrandingProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

function DashboardWithContext() {
  const { tenantId, tenants, onTenantChange } = useOutletContext();
  return <Dashboard tenantId={tenantId} tenants={tenants} onTenantChange={onTenantChange} />;
}

function CallsWithContext() {
  const { tenantId } = useOutletContext();
  return <Calls tenantId={tenantId} />;
}

function OutreachLogWithContext() {
  const { tenantId } = useOutletContext();
  return <OutreachLog tenantId={tenantId} />;
}

function OutboundWithContext() {
  const { tenantId } = useOutletContext();
  return <Outbound tenantId={tenantId} />;
}

function BookingsWithContext() {
  const { tenantId } = useOutletContext();
  return <Bookings tenantId={tenantId} />;
}

function FollowUpsWithContext() {
  const { tenantId } = useOutletContext();
  return <FollowUps tenantId={tenantId} />;
}

function MetricsWithContext() {
  const { tenantId } = useOutletContext();
  return <Metrics tenantId={tenantId} />;
}

function SettingsWithContext() {
  const { tenantId } = useOutletContext();
  return <Settings tenantId={tenantId} />;
}

function PlansWithContext() {
  const { tenantId } = useOutletContext();
  return <Plans tenantId={tenantId} />;
}

function LeadsWithContext() {
  const { tenantId } = useOutletContext();
  return <Leads tenantId={tenantId} />;
}

function LeadDetailWithContext() {
  const { tenantId } = useOutletContext();
  return <LeadDetail tenantId={tenantId} />;
}

function ConversationsWithContext() {
  const { tenantId } = useOutletContext();
  return <Conversations tenantId={tenantId} />;
}

function BillingWithContext() {
  const { tenantId } = useOutletContext();
  return <Billing tenantId={tenantId} />;
}

function AdminWithContext({ view }) {
  const user = getUser();
  if (!user?.is_super_admin) return <Navigate to="/" replace />;
  return <Admin view={view} />;
}

function ReviewsWithContext() {
  const { tenantId } = useOutletContext();
  return <Reviews tenantId={tenantId} />;
}

function GoogleBusinessWithContext() {
  const { tenantId } = useOutletContext();
  return <GoogleBusinessProfile tenantId={tenantId} />;
}

function LocationsWithContext() {
  const { tenantId } = useOutletContext();
  return <Locations tenantId={tenantId} />;
}

function RollupV5WithContext() {
  const { tenantId } = useOutletContext();
  return <RollupV5 tenantId={tenantId} />;
}

function CallCoachWithContext() {
  const { tenantId } = useOutletContext();
  return <CallCoach tenantId={tenantId} />;
}

function CallCoachDetailWithContext() {
  const { tenantId } = useOutletContext();
  return <CallCoachDetail tenantId={tenantId} />;
}

function TeamAnalyticsWithContext() {
  const { tenantId } = useOutletContext();
  return <TeamAnalytics tenantId={tenantId} />;
}

function InHomeSessionsWithContext() {
  const { tenantId } = useOutletContext();
  return <InHomeSessions tenantId={tenantId} />;
}

function InHomeSessionDetailWithContext() {
  const { tenantId } = useOutletContext();
  return <InHomeSessionDetail tenantId={tenantId} />;
}
