// MetricsPage.jsx
// Replaces your existing MetricsPage/Metrics component as the top-level wrapper.
// Adds Goals & Actuals and AI Coach tabs alongside the existing Overview.
//
// Step 1: Rename your current metrics component file to MetricsOverview.jsx
// Step 2: Replace it with this file as MetricsPage.jsx
// Step 3: Update your router/nav to point to MetricsPage instead of whatever it points to now

import { useState } from "react";
import MetricsOverview from "./MetricsOverview";         // your existing metrics component
import GoalSetting from "./coaching/GoalSetting";
import CoachingChat from "./coaching/CoachingChat";

const TABS = [
  { id: "overview",  label: "Overview",        icon: "📊" },
  { id: "goals",     label: "Goals & Actuals",  icon: "🎯" },
  { id: "coaching",  label: "AI Coach",         icon: "💬" },
];

export default function MetricsPage() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div style={{ minHeight: "100vh", background: "#F5F4F2", fontFamily: "'DM Sans', sans-serif" }}>
      {/* Tab bar */}
      <div style={{
        background: "#fff",
        borderBottom: "1px solid #e8e6e0",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        gap: 0,
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "14px 20px",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid #E8600A" : "2px solid transparent",
              background: "transparent",
              color: activeTab === tab.id ? "#E8600A" : "#888",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 7,
              transition: "all 0.15s",
              marginBottom: -1,
            }}
          >
            <span style={{ fontSize: 14 }}>{tab.icon}</span>
            {tab.label}
            {tab.id === "coaching" && (
              <span style={{
                background: "rgba(232,96,10,0.1)",
                color: "#C85208",
                fontSize: 9,
                fontFamily: "monospace",
                padding: "2px 6px",
                borderRadius: 10,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}>New</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "overview"  && <MetricsOverview />}
        {activeTab === "goals"     && <GoalSetting />}
        {activeTab === "coaching"  && <CoachingChat />}
      </div>
    </div>
  );
}
