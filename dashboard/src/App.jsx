import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useOutletContext, useLocation } from "react-router-dom";
import { getUser } from "./api";
import { DashboardLayout } from "./layouts";
import SmsTerms from "./pages/SmsTerms";
import SmsConsent from "./pages/SmsConsent";
import Contact from "./pages/Contact";
import { Home, Login, ForgotPassword, ResetPassword, CreateBusiness, Dashboard, Calls, Outbound, CallDetail, Bookings, FollowUps, Metrics, Settings, Tenants, Plans, Leads, LeadDetail, Conversations, Billing, Admin, PrivacyPolicy, TermsOfService, CookiePolicy, AddLocation, Team } from "./pages";
import MetricsPage from "./pages/MetricsPage";
import { ToastProvider } from "./components/ui/Toast";
import "./App.css";
import Reviews from "./pages/Reviews";

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
  if (!user) return <Navigate to="/login" replace />;
  const isImpersonating = !!localStorage.getItem("impersonate_tenant_id");
  if (user?.role === 'staff' && pathname === '/dashboard') {
    return <Navigate to="/bookings" replace />;
  }
  if (user && !user.tenant_id && user.is_super_admin && !pathname.startsWith("/admin") && !isImpersonating) {
    return <Navigate to="/admin/tenants" replace />;
  }
  if (user && !user.tenant_id && !user.is_super_admin && pathname !== "/create-business") {
    return <Navigate to="/create-business" replace />;
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
        <ScrollToTop />
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<RootElement />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
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
            <Route path="/admin" element={<Navigate to="/admin/tenants" replace />} />
            <Route path="/admin/tenants" element={<AdminWithContext view="tenants" />} />
            <Route path="/admin/admins" element={<AdminWithContext view="admins" />} />
            <Route path="/add-location" element={<AddLocation />} />
            <Route path="/team" element={<Team />} />
            <Route path="/reviews" element={<ReviewsWithContext />} />
          </Route>
        </Routes>
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
  return <MetricsPage tenantId={tenantId} />;
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
