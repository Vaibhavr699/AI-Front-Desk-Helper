import { useState } from "react";
import Metrics from "./Metrics";
import GoalSetting from "../components/coaching/GoalSetting";

const TABS = [
  { id: "overview", label: "Overview",       icon: "📊" },
  { id: "goals",    label: "Goals & Actuals", icon: "🎯" },
];

export default function MetricsPage({ tenantId }) {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div style={{ minHeight: "100vh", background: "#F5F4F2", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e8e6e0", padding: "0 24px", display: "flex", alignItems: "center" }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "14px 20px", border: "none",
              borderBottom: activeTab === tab.id ? "2px solid #E8600A" : "2px solid transparent",
              background: "transparent",
              color: activeTab === tab.id ? "#E8600A" : "#888",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 500,
              cursor: "pointer", display: "flex", alignItems: "center",
              gap: 7, transition: "all 0.15s", marginBottom: -1,
            }}
          >
            <span style={{ fontSize: 14 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>
      <div>
        {activeTab === "overview" && <Metrics tenantId={tenantId} />}
        {activeTab === "goals"    && <GoalSetting tenantId={tenantId} />}
      </div>
    </div>
  );
}
