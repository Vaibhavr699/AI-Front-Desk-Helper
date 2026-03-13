import { BrowserRouter, Routes, Route, Navigate, useOutletContext, useLocation } from "react-router-dom";
import { getUser } from "./api";
import { DashboardLayout } from "./layouts";
import { Home, Login, ForgotPassword, ResetPassword, CreateBusiness, Dashboard, Calls, CallDetail, Bookings, FollowUps, Metrics, Settings, Tenants, Plans, Leads, LeadDetail, Conversations, Billing, Admin } from "./pages";
import "./App.css";

function Protected({ children }) {
  const user = getUser();
  if (!user) return <Navigate to="/" replace />;
  return children;
}

/** Rendered when route is /login so we read user on this render (after logout, App may not have re-rendered). */
function LoginRoute() {
  const user = getUser();
  if (user) return <Navigate to="/" replace />;
  return <Login onLogin={() => { window.location.reload(); }} />;
}

function RootElement() {
  const user = getUser();
  const { pathname } = useLocation();
  const isRoot = pathname === "/" || pathname === "";
  if (!user) {
    if (isRoot) return <Home />;
    return <Navigate to="/" replace />;
  }
  if (user && !user.tenant_id && user.is_super_admin && pathname !== "/admin") {
    return <Navigate to="/admin" replace />;
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

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/" element={<RootElement />}>
          <Route index element={<DashboardWithContext />} />
          <Route path="create-business" element={<CreateBusiness />} />
          <Route path="calls" element={<CallsWithContext />} />
          <Route path="calls/:id" element={<CallDetail />} />
          <Route path="leads" element={<LeadsWithContext />} />
          <Route path="leads/:id" element={<LeadDetailWithContext />} />
          <Route path="bookings" element={<BookingsWithContext />} />
          <Route path="follow-ups" element={<FollowUpsWithContext />} />
          <Route path="conversations" element={<ConversationsWithContext />} />
          <Route path="metrics" element={<MetricsWithContext />} />
          <Route path="plans" element={<PlansWithContext />} />
          <Route path="billing" element={<BillingWithContext />} />
          <Route path="settings" element={<SettingsWithContext />} />
          <Route path="tenants" element={<Tenants />} />
          <Route path="admin" element={<AdminWithContext />} />
        </Route>
      </Routes>
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

function AdminWithContext() {
  const user = getUser();
  if (!user?.is_super_admin) return <Navigate to="/" replace />;
  return <Admin />;
}
