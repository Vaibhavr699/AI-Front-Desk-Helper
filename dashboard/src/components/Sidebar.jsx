import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getUser } from "../api";

const baseNavItems = [
  { to: "/dashboard", label: "Home", icon: HomeIcon },
  { to: "/calls", label: "Calls", icon: CallsIcon },
  { to: "/outbound", label: "Outbound", icon: OutboundIcon },
  { to: "/conversations", label: "AI Conversations", icon: ConversationsIcon },
  { to: "/leads", label: "Leads", icon: LeadsIcon },
  { to: "/bookings", label: "Bookings", icon: BookingsIcon },
  { to: "/follow-ups", label: "Follow-ups", icon: FollowUpsIcon },
  { to: "/metrics", label: "Metrics", icon: MetricsIcon },
];

const adminNavItems = [
  { to: "/team", label: "Team", icon: TeamIcon },
  { to: "/plans", label: "Plans", icon: PlansIcon },
  { to: "/billing", label: "Usage & Billing", icon: BillingIcon },
  { to: "/tenants", label: "Businesses", icon: BusinessesIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const managerNavItems = [
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function AdminIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}

function AdminsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function TeamIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function getNavItems(activeTenant) {
  const user = getUser();
  const isImpersonating = !!localStorage.getItem("impersonate_tenant_id");

  // 1. Super Admin (Global) view
  if (user?.is_super_admin && !user.tenant_id && !isImpersonating) {
    return [
      { to: "/admin/tenants", label: "Tenants", icon: BusinessesIcon },
      { to: "/admin/admins", label: "Platform Admins", icon: AdminsIcon },
    ];
  }
  
  const role = user?.role || 'staff';

  // 2. Staff/Technician role: ONLY Bookings
  // Any unknown role defaults to staff for security (least privilege)
  if (role !== 'admin' && role !== 'owner' && role !== 'manager') {
    return [
      { to: "/bookings", label: "Bookings", icon: BookingsIcon },
    ];
  }

  // 3. Business Manager role: Base items + Settings (No billing/plans/team/businesses)
  if (role === 'manager') {
    return [
      ...baseNavItems,
      { to: "/settings", label: "Settings", icon: SettingsIcon },
    ];
  }

  // 4. Business Owner (Admin) role: Everything
  // Ensure "HQ" menus stay visible if the USER belongs to a parent tenant,
  // even if they are currently viewing a child branch.
  const isHQ = user?.tenant_business_type === 'parent' || activeTenant?.business_type === 'parent';
  
  const items = [...baseNavItems];
  
  if (isHQ) {
    items.push({ to: "/team", label: "Team", icon: TeamIcon });
    items.push({ to: "/plans", label: "Plans", icon: PlansIcon });
    items.push({ to: "/billing", label: "Usage & Billing", icon: BillingIcon });
    items.push({ to: "/tenants", label: "Businesses", icon: BusinessesIcon });
  }

  if (user?.is_super_admin) {
    items.push({ to: "/admin/tenants", label: "Admin Console", icon: AdminIcon });
  }

  // Settings is for everyone above staff, now at the very last
  items.push({ to: "/settings", label: "Settings", icon: SettingsIcon });

  return items;
}

function HomeIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}

function CallsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}

function BookingsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function LeadsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function OutboundIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
    </svg>
  );
}

function FollowUpsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function ConversationsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  );
}

function MetricsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function SettingsIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function BusinessesIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}

function PlansIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  );
}

function BillingIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  );
}

/**
 * Collapsible sidebar with nav links and icons.
 * closeMobile: optional, called when a link is clicked (for mobile drawer).
 */
export default function Sidebar({ collapsed, onToggle, closeMobile, activeTenant }) {
  const [isHovered, setIsHovered] = useState(false);
  const location = useLocation();

  function handleLinkClick() {
    if (closeMobile) closeMobile();
  }

  const isExpanded = !collapsed || isHovered;

  return (
    <aside
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`flex flex-col bg-white border-r border-stone-200 transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] shrink-0 h-full overflow-hidden ${isExpanded ? "w-64" : "w-[4.5rem]"
        }`}
    >
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-x-hidden overflow-y-auto min-h-0">
        {getNavItems(activeTenant).map(({ to, label, icon: Icon }) => {
          const isActive =
            location.pathname === to || location.pathname.startsWith(to + "/");
          return (
            <Link
              key={to}
              to={to}
              onClick={handleLinkClick}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${isActive
                ? "bg-brand-50 text-brand-600 shadow-sm shadow-brand-100/50"
                : "text-stone-500 hover:bg-stone-50 hover:text-stone-900"
                }`}
              title={!isExpanded ? label : undefined}
            >
              <Icon className={`w-5 h-5 shrink-0 transition-transform duration-200 ${isActive ? "scale-110" : "group-hover:scale-110"}`} />
              <span
                className={`whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left ${isExpanded ? "opacity-100 translate-x-0 ml-1" : "opacity-0 -translate-x-4 pointer-events-none w-0"
                  }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

