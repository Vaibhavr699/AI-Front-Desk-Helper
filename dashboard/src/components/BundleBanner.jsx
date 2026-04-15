import { useState } from "react";

const ORANGE = "#E8702A";
const MUTED = "#8A8480";

export function BundleBanner({ onGetStarted }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div style={{ background:"linear-gradient(135deg,rgba(232,112,42,0.15),rgba(232,112,42,0.08))", borderBottom:"1px solid rgba(232,112,42,0.25)", padding:"10px 20px", fontFamily:"'DM Sans',sans-serif", position:"relative", zIndex:600 }}>
      <div style={{ maxWidth:480, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flex:1, minWidth:0 }}>
          <span style={{ fontSize:14, flexShrink:0 }}>🔥</span>
          <div>
            <span style={{ fontSize:12, fontWeight:700, color:ORANGE, fontFamily:"'Syne',sans-serif" }}>Elite — Do it all for you. </span>
            <span style={{ fontSize:12, color:"rgba(245,240,235,0.7)" }}>Setup fee waived this week only.</span>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <button onClick={onGetStarted} style={{ background:ORANGE, color:"#fff", border:"none", borderRadius:6, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"'Syne',sans-serif", whiteSpace:"nowrap" }}
            onMouseEnter={e=>e.target.style.background="#d15f20"} onMouseLeave={e=>e.target.style.background=ORANGE}>
            Claim now →
          </button>
          <button onClick={()=>setDismissed(true)} style={{ background:"none", border:"none", color:MUTED, fontSize:16, cursor:"pointer", padding:"2px 4px", lineHeight:1 }} aria-label="Dismiss">✕</button>
        </div>
      </div>
    </div>
  );
}
