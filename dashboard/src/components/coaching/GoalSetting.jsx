import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MFULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const NOW_M = new Date().getMonth();
const NOW_Y = new Date().getFullYear();
const SEA = [0.04,0.05,0.08,0.11,0.12,0.12,0.11,0.11,0.10,0.08,0.05,0.03];

const fmt = n => Math.round(n).toLocaleString();
const fmtC = n => "$" + Math.round(n).toLocaleString();
const parseMoney = s => parseInt(String(s).replace(/[^0-9]/g,""),10)||0;

export default function GoalSetting({ tenantId }) {
  const [curYear, setCurYear] = useState(NOW_Y);
  const [annualTotal, setAnnualTotal] = useState(0);
  const [annualDisplay, setAnnualDisplay] = useState("");
  const [goals, setGoals] = useState(Array(12).fill(0));
  const [actuals, setActuals] = useState(Array(12).fill(null));
  const [avgJob, setAvgJob] = useState("2400");
  const [closeRate, setCloseRate] = useState("34");
  const [distMode, setDistMode] = useState("seasonal");
  const [activeMonth, setActiveMonth] = useState(NOW_M);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
   fetch(`${API_BASE}/api/coaching/annual?year=${curYear}`, { headers })
      .then(r => r.json()).catch(() => null)
      .then(data => {
        if (data?.months?.length) {
          const g = Array(12).fill(0);
          const a = Array(12).fill(null);
          data.months.forEach(m => {
            if (m.month >= 0 && m.month < 12) {
             g[m.month] = Math.round((m.revenue_goal || 0) / 100);
if (m.actual_revenue != null) a[m.month] = Math.round(m.actual_revenue / 100);
            }
          });
          const total = g.reduce((x,y)=>x+y,0);
          setGoals(g); setActuals(a);
          setAnnualTotal(total);
          setAnnualDisplay(total > 0 ? total.toLocaleString() : "");
          if (data.avg_job_value) setAvgJob(String(data.avg_job_value));
          if (data.close_rate) setCloseRate(String(data.close_rate));
          setDistMode("manual");
        }
      });
  }, [curYear]);

  const distribute = useCallback((total, mode) => {
    let g;
    if (mode === "even") {
      const base = Math.round(total/12);
      g = Array(12).fill(base);
      g[11] += total - base*12;
    } else {
      g = SEA.map(w => Math.round(total*w));
      g[6] += total - g.reduce((a,b)=>a+b,0);
    }
    setGoals(g);
  }, []);

  const handleAnnual = val => {
  const raw = val.replace(/[^0-9]/g, "");
  const num = parseInt(raw) || 0;
  setAnnualTotal(num);
  setAnnualDisplay(raw);
  if (distMode !== "manual" && num > 0) distribute(num, distMode);
  setSaved(false);
};

  const handleGoalEdit = (idx, val) => {
    if (!annualTotal) return;
    const nv = Math.min(parseMoney(val), annualTotal);
    const ng = [...goals]; ng[idx] = nv;
    const rem = annualTotal - nv;
    const others = ng.map((_,i)=>i).filter(i=>i!==idx);
    const ot = others.reduce((a,i)=>a+ng[i],0);
    if (ot > 0) {
      let d=0; others.forEach((i,j)=>{ if(j===others.length-1){ng[i]=rem-d;}else{const s=Math.round(rem*(ng[i]/ot));ng[i]=s;d+=s;} });
    } else {
      const base=Math.round(rem/others.length); others.forEach((i,j)=>{ng[i]=j===others.length-1?rem-base*(others.length-1):base;});
    }
    setGoals(ng); setDistMode("manual"); setSaved(false);
  };

  const handleActual = (idx, val) => {
    const na = [...actuals]; na[idx] = parseMoney(val)||null;
    setActuals(na); setSaved(false);
  };

  const handleDist = mode => {
    setDistMode(mode);
    if (mode !== "manual" && annualTotal > 0) distribute(annualTotal, mode);
  };

  async function save() {
    if (!annualTotal) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/coaching/annual`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          year: curYear, avg_job_value: parseMoney(avgJob), close_rate: parseFloat(closeRate)||0,
        months: goals.map((g,i) => ({ month: i, revenue_goal: g * 100, actual_revenue: actuals[i] ? actuals[i] * 100 : null })),
        }),
      });
      setSaved(true); setTimeout(()=>setSaved(false),3000);
    } catch { alert("Failed to save."); }
    finally { setSaving(false); }
  }

  const completedMonths = MONTHS.map((_,i)=>i).filter(i => curYear < NOW_Y || (curYear===NOW_Y && i<=NOW_M));
  const ytdGoal = completedMonths.reduce((a,i)=>a+goals[i],0);
  const ytdActual = completedMonths.reduce((a,i)=>a+(actuals[i]||0),0);
  const ytdVar = ytdActual - ytdGoal;
  const ytdPct = ytdGoal > 0 ? Math.min(120, Math.round((ytdActual/ytdGoal)*100)) : 0;
  const mWithActuals = completedMonths.filter(i=>actuals[i]!==null).length;
  const pace = mWithActuals > 0 ? (ytdActual/mWithActuals)*12 : 0;
  const hasActuals = completedMonths.some(i=>actuals[i]!==null);
  const totalAllocated = goals.reduce((a,b)=>a+b,0);
  const av = parseFloat(avgJob)||0;
  const cr = parseFloat(closeRate)||0;
  const ag = goals[activeMonth];
  const aa = actuals[activeMonth];

  const c = {
    page: {background:"#F5F4F2",minHeight:"100vh",padding:"24px 20px 60px",fontFamily:"'DM Sans',sans-serif",color:"#1a1a18"},
    card: {background:"#fff",border:"1px solid #e8e6e0",borderRadius:14,padding:"18px 20px",marginBottom:12,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"},
    ct: {fontFamily:"monospace",fontSize:9,color:"#bbb",textTransform:"uppercase",letterSpacing:".1em",marginBottom:14},
    label: {display:"block",fontSize:11,color:"#999",marginBottom:6,fontWeight:600},
    wrap: {position:"relative"},
    pre: {position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:16,color:"#bbb",pointerEvents:"none"},
    suf: {position:"absolute",right:11,top:"50%",transform:"translateY(-50%)",fontSize:11,color:"#bbb",pointerEvents:"none"},
    bigInput: {width:"100%",background:"#fafaf9",border:"1.5px solid #e0ddd8",borderRadius:10,padding:"12px 14px 12px 26px",fontSize:24,fontWeight:700,color:"#111",outline:"none",fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box"},
    smInput: {width:"100%",background:"#fafaf9",border:"1.5px solid #e0ddd8",borderRadius:10,padding:"9px 34px 9px 11px",fontSize:13,fontWeight:600,color:"#111",outline:"none",fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box"},
    twoCol: {display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:14},
    distRow: {display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:10},
    mgrid: {display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8},
    mc: (i) => ({borderRadius:10,padding:"11px 10px",cursor:"pointer",transition:"all .15s",border:i===activeMonth?"1.5px solid #E8600A":i===NOW_M&&curYear===NOW_Y?"1.5px solid #3B82F6":"1.5px solid #e8e6e0",background:i===activeMonth?"rgba(232,96,10,.05)":"#fafaf9"}),
    mlabel: (i) => ({fontSize:10,fontFamily:"monospace",letterSpacing:".06em",textTransform:"uppercase",marginBottom:6,color:i===activeMonth?"#C85208":i===NOW_M&&curYear===NOW_Y?"#3B82F6":"#bbb"}),
    minput: (i) => ({width:"100%",background:"transparent",border:"none",borderBottom:"1.5px solid #e8e6e0",outline:"none",fontSize:13,fontWeight:700,fontFamily:"'DM Sans',sans-serif",padding:"3px 0",color:"#111",marginBottom:2}),
    actualInput: (i) => ({width:"100%",background:"transparent",border:"none",borderBottom:`1.5px solid ${actuals[i]!==null?"#16a34a":"#e8e6e0"}`,outline:"none",fontSize:13,fontWeight:700,fontFamily:"'DM Sans',sans-serif",padding:"3px 0",color:actuals[i]!==null?"#16a34a":"#111",marginBottom:2}),
    pbar: {height:4,background:"#f0eeea",borderRadius:2,overflow:"hidden",marginTop:6},
    bd: {display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12},
    bi: {background:"#fafaf9",border:"1px solid #e8e6e0",borderRadius:10,padding:"13px 10px",textAlign:"center"},
    bv: {fontSize:18,fontWeight:700,marginBottom:3},
    bl: {fontSize:9,color:"#bbb",textTransform:"uppercase",letterSpacing:".07em",fontFamily:"monospace"},
    insight: {background:"rgba(232,96,10,.04)",border:"1px solid rgba(232,96,10,.15)",borderRadius:10,padding:"11px 13px",fontSize:11,color:"#999",lineHeight:1.7},
    ytdGrid: {display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:4},
    saveBtn: {width:"100%",padding:14,background:saved?"#16a34a":"#E8600A",border:"none",borderRadius:12,fontSize:14,fontWeight:600,color:"#fff",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",transition:"all .2s",marginTop:4},
    yrBtn: (active) => ({padding:"5px 13px",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",background:active?"rgba(232,96,10,.08)":"#fff",border:active?"1.5px solid rgba(232,96,10,.4)":"1.5px solid #e0ddd8",color:active?"#C85208":"#bbb"}),
    distBtn: (active) => ({padding:"7px 0",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",background:active?"rgba(232,96,10,.08)":"#fafaf9",border:active?"1.5px solid rgba(232,96,10,.4)":"1.5px solid #e0ddd8",color:active?"#C85208":"#bbb",width:"100%"}),
  };

  function getPillStatus(i) {
    if (curYear > NOW_Y || i > NOW_M) return null;
    const a = actuals[i];
    if (a === null) return null;
    const g = goals[i];
    return a >= g ? { text: `+${fmtC(a-g)}`, color:"#16a34a", bg:"#dcfce7" } : { text: fmtC(a-g), color:"#dc2626", bg:"#fee2e2" };
  }

  return (
    <div style={c.page}>
      <div style={{maxWidth:860,margin:"0 auto"}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10,marginBottom:20}}>
          <div>
            <div style={{display:"inline-flex",alignItems:"center",background:"rgba(232,96,10,0.1)",border:"1px solid rgba(232,96,10,0.25)",borderRadius:20,padding:"4px 12px",fontSize:10,color:"#C85208",fontFamily:"monospace",letterSpacing:".07em",textTransform:"uppercase",marginBottom:10}}>Phase 5 · AI Coaching</div>
            <h1 style={{fontSize:22,fontWeight:700,color:"#111",margin:"0 0 4px"}}>Revenue Goals & Actuals</h1>
            <p style={{fontSize:11,color:"#999",margin:0}}>Set goals · enter actuals · track ahead or behind in real time</p>
          </div>
          <div style={{display:"flex",gap:8}}>
            {[NOW_Y-1,NOW_Y,NOW_Y+1].map(y=>(
              <button key={y} style={c.yrBtn(y===curYear)} onClick={()=>setCurYear(y)}>{y}</button>
            ))}
          </div>
        </div>

        {/* Annual Goal */}
        <div style={c.card}>
          <div style={c.ct}>Annual Revenue Goal — {curYear}</div>
          <div style={{marginBottom:16}}>
            <label style={c.label}>Total revenue target for {curYear}</label>
            <div style={c.wrap}>
              <span style={c.pre}>$</span>
              <input
  style={c.bigInput}
  type="text"
  inputMode="numeric"
  placeholder="900,000"
  value={annualDisplay}
  onChange={e => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    setAnnualDisplay(raw);
    setAnnualTotal(parseInt(raw) || 0);
    if (distMode !== "manual" && parseInt(raw) > 0) distribute(parseInt(raw), distMode);
    setSaved(false);
  }}
  onBlur={e => {
    const n = parseMoney(e.target.value);
    setAnnualTotal(n);
    setAnnualDisplay(n > 0 ? n.toLocaleString() : "");
  }}
/>
            </div>
          </div>
          <div style={c.twoCol}>
            <div>
              <label style={c.label}>Avg job value</label>
              <div style={c.wrap}>
                <input style={c.smInput} type="number" value={avgJob} onChange={e=>{setAvgJob(e.target.value);setSaved(false);}} />
                <span style={c.suf}>$</span>
              </div>
            </div>
            <div>
              <label style={c.label}>Close rate</label>
              <div style={c.wrap}>
                <input style={c.smInput} type="number" value={closeRate} min="1" max="100" onChange={e=>{setCloseRate(e.target.value);setSaved(false);}} />
                <span style={c.suf}>%</span>
              </div>
            </div>
          </div>
          {annualTotal > 0 && (
            <div style={{marginTop:14}}>
              <label style={c.label}>Distribute monthly goals</label>
              <div style={c.distRow}>
                {["seasonal","even","manual"].map(m=>(
                  <button key={m} style={c.distBtn(distMode===m)} onClick={()=>handleDist(m)}>
                    {m==="seasonal"?"Seasonal":m==="even"?"Even split":"Manual"}
                  </button>
                ))}
              </div>
              <div style={{fontSize:10,color:"#ccc",marginTop:5}}>
                {distMode==="seasonal"?"Weighted for painting — slow Jan–Mar, peak Apr–Oct":distMode==="even"?"Equal amount each month":"Edit each month — others auto-adjust to keep total"}
              </div>
            </div>
          )}
        </div>

        {/* YTD Scoreboard */}
        {annualTotal > 0 && hasActuals && (
          <div style={c.card}>
            <div style={c.ct}>Year-to-date scoreboard</div>
            <div style={c.ytdGrid}>
              <div style={{background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:10,padding:"13px 10px",textAlign:"center"}}>
                <div style={{...c.bv,color:"#C85208"}}>{fmtC(ytdGoal)}</div><div style={c.bl}>YTD Goal</div>
              </div>
              <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"13px 10px",textAlign:"center"}}>
                <div style={{...c.bv,color:"#16a34a"}}>{fmtC(ytdActual)}</div><div style={c.bl}>YTD Actual</div>
              </div>
              <div style={{background:ytdVar>=0?"#f0fdf4":"#fef2f2",border:`1px solid ${ytdVar>=0?"#bbf7d0":"#fecaca"}`,borderRadius:10,padding:"13px 10px",textAlign:"center"}}>
                <div style={{...c.bv,color:ytdVar>=0?"#16a34a":"#dc2626"}}>{(ytdVar>=0?"+":"")+fmtC(ytdVar)}</div><div style={c.bl}>Variance</div>
              </div>
              <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:"13px 10px",textAlign:"center"}}>
                <div style={{...c.bv,color:"#1d4ed8"}}>{fmtC(pace)}</div><div style={c.bl}>Full-yr Pace</div>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#bbb",marginBottom:4}}>
              <span style={{color:ytdPct>=100?"#16a34a":ytdPct>=80?"#E8600A":"#dc2626"}}>{ytdPct}% of YTD goal</span>
              <span>Projected full year vs {fmtC(annualTotal)}</span>
            </div>
            <div style={c.pbar}><div style={{height:"100%",borderRadius:2,background:ytdPct>=100?"#16a34a":ytdPct>=80?"#E8600A":"#dc2626",width:`${Math.min(100,ytdPct)}%`,transition:"width .5s"}} /></div>
          </div>
        )}

        {/* Monthly Grid */}
        <div style={c.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={c.ct}>Monthly goals & actuals — click any month for AI breakdown</div>
            {annualTotal > 0 && <div style={{fontSize:10,fontFamily:"monospace",fontWeight:600,color:totalAllocated===annualTotal?"#16a34a":"#dc2626"}}>
              {totalAllocated===annualTotal?"✓ Fully allocated":`${fmtC(totalAllocated)} / ${fmtC(annualTotal)}`}
            </div>}
          </div>
          <div style={c.mgrid}>
            {MONTHS.map((m,i)=>{
              const g=goals[i]; const a=actuals[i];
              const pct=g>0&&a!==null?Math.min(100,Math.round((a/g)*100)):0;
              const pill=getPillStatus(i);
              const isFuture=curYear>NOW_Y||(curYear===NOW_Y&&i>NOW_M);
              return (
                <div key={i} style={c.mc(i)} onClick={()=>setActiveMonth(i)}>
                  <div style={{...c.mlabel(i),display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span>{m}{i===NOW_M&&curYear===NOW_Y?" ·NOW":""}</span>
                    {pill&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:10,background:pill.bg,color:pill.color,fontFamily:"monospace"}}>{pill.text}</span>}
                  </div>
                  <div style={{fontSize:9,color:"#bbb",marginBottom:4,fontFamily:"monospace"}}>GOAL</div>
                  <input style={c.minput(i)} type="text" inputMode="numeric" placeholder="—"
                    value={g>0?g.toLocaleString():""}
                    onClick={e=>e.stopPropagation()}
                    onChange={e=>handleGoalEdit(i,e.target.value.replace(/,/g,""))}
                    onBlur={e=>{const n=parseMoney(e.target.value);e.target.value=n>0?n.toLocaleString():"";}} />
                  <div style={{fontSize:9,color:a!==null?"#16a34a":"#bbb",marginBottom:4,marginTop:6,fontFamily:"monospace"}}>ACTUAL</div>
                  <input style={c.actualInput(i)} type="text" inputMode="numeric" placeholder={isFuture?"—":"Enter"}
                    disabled={isFuture}
                    value={a!==null?a.toLocaleString():""}
                    onClick={e=>e.stopPropagation()}
                    onChange={e=>handleActual(i,e.target.value.replace(/,/g,""))}
                    onBlur={e=>{const n=parseMoney(e.target.value);e.target.value=n>0?n.toLocaleString():"";}} />
                  {g>0&&a!==null&&<div style={c.pbar}><div style={{height:"100%",borderRadius:2,width:`${pct}%`,background:a>=g?"#16a34a":pct>=70?"#E8600A":"#dc2626",transition:"width .4s"}} /></div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Breakdown */}
        {ag>0&&av>0&&cr>0&&(
          <div style={c.card}>
            <div style={c.ct}>{MFULL[activeMonth]} {curYear} — AI Breakdown</div>
            <div style={c.bd}>
              <div style={c.bi}><div style={{...c.bv,color:"#E8600A"}}>{fmtC(ag/4)}</div><div style={c.bl}>Per Week</div></div>
              <div style={c.bi}><div style={{...c.bv,color:"#3B82F6"}}>{fmt(ag/av)}</div><div style={c.bl}>Jobs Needed</div></div>
              <div style={c.bi}><div style={{...c.bv,color:"#8B5CF6"}}>{fmt((ag/av)/(cr/100))}</div><div style={c.bl}>Leads Needed</div></div>
              <div style={c.bi}><div style={{...c.bv,color:"#16a34a"}}>{fmtC(ag/30)}</div><div style={c.bl}>Per Day</div></div>
            </div>
            <div style={c.insight}>
              {aa!==null&&aa>0
                ? <><span style={{color:"#C85208",fontWeight:600}}>AI insight: </span>{MFULL[activeMonth]} closed <strong>{fmtC(aa)}</strong> — <strong style={{color:aa>=ag?"#16a34a":"#dc2626"}}>{aa>=ag?"+":""}{fmtC(aa-ag)} {aa>=ag?"ahead of":"behind"} goal</strong> ({Math.round((aa/ag)*100)}% of target).</>
                : <><span style={{color:"#C85208",fontWeight:600}}>AI insight: </span>To hit <strong>{fmtC(ag)}</strong> in {MFULL[activeMonth]} you need <strong>{fmt((ag/av)/(cr/100))} leads</strong> converting at <strong>{cr}%</strong> into <strong>{fmt(ag/av)} jobs</strong> at <strong>{fmtC(av)} avg</strong>. That's <strong>{fmt(((ag/av)/(cr/100))/4)} leads/week</strong> to stay on pace.</>
              }
            </div>
          </div>
        )}

        <button style={c.saveBtn} onClick={save} disabled={saving}>
          {saving?"Saving...":saved?`${curYear} goals saved!`:`Save ${curYear} Goals & Actuals`}
        </button>
        <div style={{textAlign:"center",marginTop:10,fontSize:10,color:"#ccc"}}>Goals power AI coaching chat, weekly push summaries, and pace alerts</div>
      </div>
    </div>
  );
}
