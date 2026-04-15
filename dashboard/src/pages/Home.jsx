import { Link, useNavigate } from "react-router-dom";
import { ContainerScroll } from "../components/ui/container-scroll-animation";
import { NavBar } from "../components/ui/tubelight-navbar";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { BundleBanner } from "../components/BundleBanner";
import { ContactModal } from "../components/ContactModal";
import { ShimmerButton } from "../components/ui/shimmer-button";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useMemo } from "react";
import {
  PhoneCall, CalendarCheck, MessageSquare, Bot, User, CheckCircle2,
  Home as HomeIcon, Layers, DollarSign, ShieldCheck, Headphones,
  CalendarDays, Link2, Smartphone, Phone, Settings, Zap, Users,
  BarChart2, MoveRight, Sparkles, Star,
} from "lucide-react";

// ── Constants ──────────────────────────────────────────────────────────────────
const ORANGE = "#E8702A";
const DARK = "#111010";
const CARD_DARK = "#1A1918";
const CARD_MID = "#242120";
const OFF_WHITE = "#F5F0EB";
const MUTED = "#8A8480";

const NAV_ITEMS = [
  { name: "Features",     url: "#features",     icon: Layers      },
  { name: "How it works", url: "#how-it-works", icon: HomeIcon    },
  { name: "Pricing",      url: "#pricing",      icon: DollarSign  },
  { name: "Why us",       url: "#why-us",       icon: ShieldCheck },
];

// ── SMS Consent Modal ──────────────────────────────────────────────────────────
function SmsConsentModal({ isOpen, onClose, onAccept }) {
  const [checked, setChecked] = useState(false);
  if (!isOpen) return null;

  function handleAccept() {
    if (!checked) return;
    onAccept();
    setChecked(false);
  }
  function handleClose() {
    setChecked(false);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[600] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sms-consent-title"
    >
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={handleClose} />
      <motion.div
        initial={{ y: "100%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="relative z-10 w-full max-w-[480px] bg-white rounded-t-3xl p-7 pb-10 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex justify-between items-start mb-5">
          <div>
            <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center text-2xl mb-4">💬</div>
            <h2 id="sms-consent-title" className="text-2xl font-bold text-stone-900">Before you get started</h2>
            <p className="mt-1 text-sm text-stone-500">Please review and agree to our messaging policy.</p>
          </div>
          <button onClick={handleClose} className="text-stone-300 hover:text-stone-500 p-1 text-xl leading-none mt-1">✕</button>
        </div>

        <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 text-xs text-stone-600 leading-relaxed mb-5">
          By submitting this form, you agree to receive SMS text messages from{" "}
          <strong className="text-stone-800">AI Front Desk Helper</strong> related to your inquiry,
          including appointment scheduling, follow-ups, and service notifications.
          Message frequency may vary. Message and data rates may apply.
          Reply <strong>STOP</strong> to opt out or <strong>HELP</strong> for assistance.
          Consent is not required as a condition of purchasing services.{" "}
          <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-orange-500 underline font-medium">Privacy Policy</a>.
        </div>

        <div className="flex items-start gap-3 mb-6 cursor-pointer" onClick={() => setChecked(!checked)}>
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${checked ? "bg-orange-500 border-orange-500" : "border-stone-300"}`}>
            {checked && <span className="text-white text-xs font-bold leading-none">✓</span>}
          </div>
          <span className="text-sm text-stone-700 leading-snug">I have read and agree to the SMS messaging terms above.</span>
        </div>

        <div className="flex gap-3">
          <button onClick={handleClose} className="flex-1 py-3.5 rounded-xl border border-stone-200 text-sm font-semibold text-stone-600 hover:border-stone-300 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={!checked}
            className={`flex-[1.4] py-3.5 rounded-xl text-sm font-bold text-white transition-all font-['Syne'] ${checked ? "bg-orange-500 hover:bg-orange-600 cursor-pointer" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}
          >
            Continue to sign up →
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Ticker ─────────────────────────────────────────────────────────────────────
function Ticker() {
  const items = [
    "Revenue Recovered by AI",
    "Zero Missed Calls",
    "Estimates Auto-Followed Up",
    "Win-Backs on Autopilot",
    "Close Rate Coaching",
    "Review SEO on Every Star",
    "Lead Source ROI Tracked",
    "Leads Never Lost Again",
  ];
  const doubled = [...items, ...items];
  return (
    <div className="overflow-hidden w-full py-3.5 border-y" style={{ background: "rgba(232,112,42,0.08)", borderColor: "rgba(232,112,42,0.15)" }}>
      <div className="flex whitespace-nowrap" style={{ animation: "ticker 30s linear infinite" }}>
        {doubled.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-2.5 px-7 text-xs font-bold tracking-widest uppercase" style={{ color: ORANGE, opacity: 0.85 }}>
            <span style={{ color: ORANGE, fontSize: 14 }}>◆</span>
            {item}
          </span>
        ))}
      </div>
      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

// ── Animated Hero Title ────────────────────────────────────────────────────────
function AnimatedHeroTitle({ onStart, onContact }) {
  const [titleNumber, setTitleNumber] = useState(0);
  const titles = useMemo(() => ["every call", "more revenue", "lost estimates", "every lead", "more bookings"], []);

  useEffect(() => {
    const t = setTimeout(() => setTitleNumber(p => p === titles.length - 1 ? 0 : p + 1), 2200);
    return () => clearTimeout(t);
  }, [titleNumber, titles]);

  return (
    <div className="w-full text-center">
      {/* Tag */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.05 }} className="mb-6">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase" style={{ background: "rgba(232,112,42,0.12)", border: "1px solid rgba(232,112,42,0.3)", color: ORANGE }}>
          <Zap className="w-3 h-3" />
          Not another call bot
        </span>
      </motion.div>

      {/* Headline */}
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }} className="mb-5">
        <h1 className="font-['Syne'] text-[44px] font-extrabold leading-[1.1] tracking-[-0.02em]" style={{ color: OFF_WHITE }}>
          Never miss<br />
          <span className="relative inline-block overflow-hidden align-bottom" style={{ height: "1.15em", minWidth: 280 }}>
            {titles.map((title, index) => (
              <motion.span
                key={index}
                className="absolute left-0 right-0 font-['Syne']"
                style={{ color: ORANGE }}
                initial={{ opacity: 0, y: 32 }}
                animate={
                  titleNumber === index
                    ? { y: 0, opacity: 1 }
                    : { y: titleNumber > index ? -32 : 32, opacity: 0 }
                }
                transition={{ type: "spring", stiffness: 80, damping: 18 }}
              >
                {title}
              </motion.span>
            ))}
          </span>
        </h1>
      </motion.div>

      {/* Subtitle */}
      <motion.p
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.25 }}
        className="text-base leading-relaxed mb-8 max-w-sm mx-auto"
        style={{ color: "rgba(245,240,235,0.65)" }}
      >
        Inbound AI. Outbound campaigns. Estimate recovery. AI coaching.
        Review writing. All in one revenue system built by a painting contractor.
      </motion.p>

      {/* CTAs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.35 }}
        className="flex gap-3 justify-center mb-10"
      >
        <button
          onClick={onStart}
          className="px-7 py-3.5 rounded-lg text-base font-bold text-white transition-all hover:-translate-y-0.5"
          style={{ background: ORANGE, fontFamily: "'Syne', sans-serif" }}
          onMouseEnter={e => e.currentTarget.style.background = "#d15f20"}
          onMouseLeave={e => e.currentTarget.style.background = ORANGE}
        >
          Start free →
        </button>
        <button
          onClick={onContact}
          className="px-6 py-3.5 rounded-lg text-base font-medium transition-colors flex items-center gap-2"
          style={{ background: "transparent", border: "1.5px solid rgba(245,240,235,0.25)", color: OFF_WHITE }}
          onMouseEnter={e => e.currentTarget.style.borderColor = OFF_WHITE}
          onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(245,240,235,0.25)"}
        >
          Get in touch
          <PhoneCall className="w-4 h-4" />
        </button>
      </motion.div>

      {/* Live proof bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.45 }}
        className="rounded-xl p-4 flex justify-around gap-2 mb-3"
        style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.08)" }}
      >
        {[{ val: "28", label: "Calls / mo" }, { val: "53%", label: "Booking rate" }, { val: "$11.5k", label: "Tracked rev" }].map((s, i) => (
          <div key={i} className="text-center">
            <div className="font-['Syne'] text-xl font-extrabold" style={{ color: ORANGE }}>{s.val}</div>
            <div className="text-xs mt-0.5" style={{ color: MUTED }}>{s.label}</div>
          </div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
        className="text-xs flex items-center justify-center gap-1.5"
        style={{ color: MUTED }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" />
        Live on Gladiators Painting · Omaha, NE
      </motion.div>
    </div>
  );
}

// ── Dark Feature Card ──────────────────────────────────────────────────────────
function FeatureCard({ Icon, name, description, onClick }) {
  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-2xl cursor-pointer transition-all duration-200 hover:-translate-y-1"
      style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.07)" }}
      onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(232,112,42,0.3)"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(245,240,235,0.07)"}
    >
      <div className="p-6 flex flex-col gap-3 flex-1">
        {Icon && (
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(232,112,42,0.12)" }}>
            <Icon className="w-5 h-5" style={{ color: ORANGE }} />
          </div>
        )}
        <h3 className="font-['Syne'] text-base font-bold" style={{ color: OFF_WHITE }}>{name}</h3>
        <p className="text-sm leading-relaxed" style={{ color: MUTED }}>{description}</p>
      </div>
      <div className="px-6 pb-5 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs font-bold flex items-center gap-1" style={{ color: ORANGE }}>
          Get started <MoveRight className="w-3 h-3" />
        </span>
      </div>
    </div>
  );
}

// ── Step Card ──────────────────────────────────────────────────────────────────
function StepCard({ icon: Icon, step, title, description, accent }) {
  return (
    <div
      className="group relative rounded-2xl p-7 text-center transition-all duration-300 hover:-translate-y-1"
      style={{ background: CARD_DARK, border: `1px solid rgba(245,240,235,0.07)` }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(232,112,42,0.25)"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(245,240,235,0.07)"}
    >
      <div
        className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg mb-4 transition-transform duration-300 group-hover:scale-110"
        style={{ background: accent || "rgba(232,112,42,0.15)" }}
      >
        <Icon className="w-6 h-6" style={{ color: ORANGE }} />
      </div>
      <span className="text-xs font-bold uppercase tracking-widest" style={{ color: MUTED }}>Step {step}</span>
      <h3 className="mt-2 text-lg font-['Syne'] font-bold" style={{ color: OFF_WHITE }}>{title}</h3>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: MUTED }}>{description}</p>
    </div>
  );
}

// ── Pricing Card ───────────────────────────────────────────────────────────────
function PricingCard({ tier, label, tagline, monthlyPrice, setup, desc, features, featured, isAnnual, onStart }) {
  const displayPrice = isAnnual ? Math.round((monthlyPrice * 10) / 12) : monthlyPrice;
  const annualTotal = monthlyPrice * 10;

  return (
    <div
      className="relative rounded-2xl p-7 flex flex-col transition-all"
      style={{
        background: CARD_DARK,
        border: featured ? `2px solid ${ORANGE}` : "1px solid rgba(245,240,235,0.08)",
        boxShadow: featured ? `0 0 32px rgba(232,112,42,0.2)` : "none",
      }}
    >
      {featured && (
        <div
          className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider text-white whitespace-nowrap"
          style={{ background: ORANGE }}
        >
          Do it all for you
        </div>
      )}

      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: MUTED }}>{label}</div>
          <div className="font-['Syne'] text-xl font-extrabold" style={{ color: OFF_WHITE }}>{tier}</div>
          <div className="text-sm" style={{ color: MUTED }}>{tagline}</div>
        </div>
        <div className="text-right">
          <div className="font-['Syne'] text-2xl font-extrabold" style={{ color: OFF_WHITE }}>
            ${displayPrice}<span className="text-sm font-normal" style={{ color: MUTED }}>/mo</span>
          </div>
          {isAnnual ? (
            <div className="text-xs text-green-400">${annualTotal.toLocaleString()}/yr · 2 months free</div>
          ) : (
            <div className="text-xs" style={{ color: ORANGE }}>+${setup} setup</div>
          )}
        </div>
      </div>

      <p className="text-sm mb-4 leading-relaxed" style={{ color: "rgba(245,240,235,0.5)" }}>{desc}</p>

      <ul className="space-y-2.5 mb-6 flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm" style={{ color: "rgba(245,240,235,0.75)" }}>
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: ORANGE }} />
            {f}
          </li>
        ))}
      </ul>

      <button
        onClick={onStart}
        className="w-full py-3.5 rounded-xl text-sm font-bold transition-all font-['Syne']"
        style={featured
          ? { background: ORANGE, color: "#fff", border: "none" }
          : { background: "transparent", color: OFF_WHITE, border: "1.5px solid rgba(245,240,235,0.2)" }
        }
        onMouseEnter={e => {
          if (featured) e.currentTarget.style.background = "#d15f20";
          else e.currentTarget.style.borderColor = OFF_WHITE;
        }}
        onMouseLeave={e => {
          if (featured) e.currentTarget.style.background = ORANGE;
          else e.currentTarget.style.borderColor = "rgba(245,240,235,0.2)";
        }}
      >
        {featured ? "Do it all for me →" : "Get started"}
      </button>
    </div>
  );
}

// ── Scroll Trigger Banner ──────────────────────────────────────────────────────
function ScrollTriggerBanner({ onStart, onDismiss }) {
  return (
    <motion.div
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -80, opacity: 0 }}
      transition={{ type: "spring", damping: 20, stiffness: 200 }}
      className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-[200]"
    >
      <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ background: "#1A1918", borderBottom: `2px solid ${ORANGE}` }}>
        <div className="flex-1">
          <div className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: ORANGE }}>Still reading?</div>
          <div className="font-['Syne'] text-sm font-bold" style={{ color: OFF_WHITE }}>Let Elite do it all for you →</div>
          <div className="text-xs" style={{ color: MUTED }}>$997/mo · Full revenue machine</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onStart}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-colors font-['Syne']"
            style={{ background: ORANGE }}
            onMouseEnter={e => e.currentTarget.style.background = "#d15f20"}
            onMouseLeave={e => e.currentTarget.style.background = ORANGE}
          >
            Start now
          </button>
          <button onClick={onDismiss} className="text-lg leading-none" style={{ color: MUTED, background: "none", border: "none", cursor: "pointer", padding: 4 }}>✕</button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Home Component ────────────────────────────────────────────────────────
export default function Home() {
  const navigate = useNavigate();
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [isSmsConsentOpen, setIsSmsConsentOpen] = useState(false);
  const [showStickyCTA, setShowStickyCTA] = useState(false);
  const [isAnnual, setIsAnnual] = useState(true);
  const heroRef = useRef(null);
  const triggerFiredRef = useRef(false);

  function handleGetStarted() { setIsSmsConsentOpen(true); }
  function handleConsentAccepted() { setIsSmsConsentOpen(false); navigate("/login?signup=1"); }

  // Scroll behavior
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const heroH = heroRef.current?.offsetHeight || 600;
      setShowStickyCTA(scrollY > heroH);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [scrollTriggerDismissed]);

  const plans = [
    {
      tier: "Basic", label: "SMALL OPS", tagline: "AI Front Desk Starter",
      monthlyPrice: 297, setup: 197,
      desc: "For contractors who want to stop missing calls.",
      features: ["24/7 AI call answering", "Missed call text-back", "Lead capture & CRM sync", "Call transcripts"],
      featured: false,
    },
    {
      tier: "Pro", label: "GROWING TEAMS", tagline: "AI Booking Assistant",
      monthlyPrice: 497, setup: 297,
      desc: "Full booking, follow-up, and multi-channel coverage.",
      features: ["Everything in Basic", "Google Calendar booking", "SMS follow-up sequences", "Website AI chat widget", "Appointment reminders", "Facebook Messenger"],
      featured: false,
    },
    {
      tier: "Elite", label: "THE FULL SYSTEM", tagline: "AI Revenue Machine",
      monthlyPrice: 997, setup: 497,
      desc: "Everything. Inbound, outbound, coaching, reviews, and franchise-ready HQ tools.",
      features: ["Everything in Pro", "Outbound AI campaigns", "Script retiring & win-backs", "AI revenue coaching", "Lead source insights", "Review response writer (SEO)", "Objection detection", "Referral autopilot", "HQ franchise rollup"],
      featured: true,
    },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: DARK }}>

      {/* Global CSS */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 24px rgba(232,112,42,0.2); }
          50% { box-shadow: 0 0 48px rgba(232,112,42,0.45); }
        }
        .elite-glow { animation: glow 3s ease-in-out infinite; }
        .sticky-cta-btn:hover { background: #d15f20 !important; }
      `}</style>

      {/* Bundle banner + Header */}
      <BundleBanner onGetStarted={handleGetStarted} />
      <div style={{ position: "relative", zIndex: 100 }}>
  <NavBar items={NAV_ITEMS} />
</div>
      <SiteFooter onGetStarted={handleGetStarted} />

      <main className="flex-1">

        {/* ── HERO ── */}
        <div ref={heroRef} className="relative z-[60] flex flex-col overflow-hidden pb-4">
          <ContainerScroll
            titleComponent={
              <AnimatedHeroTitle
                onStart={handleGetStarted}
                onContact={() => setIsContactOpen(true)}
              />
            }
          >
            {/* Dashboard preview */}
            <div className="h-full w-full rounded-xl overflow-hidden flex flex-col font-sans" style={{ background: CARD_DARK, border: "2px solid rgba(245,240,235,0.08)" }}>
              <div className="px-6 py-4 flex justify-between items-center shrink-0" style={{ background: CARD_MID, borderBottom: "1px solid rgba(245,240,235,0.08)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center overflow-hidden p-1" style={{ background: OFF_WHITE }}>
                    <img src="/favicon.png" alt="Logo" className="w-full h-full object-contain" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-sm leading-tight" style={{ color: OFF_WHITE }}>Gladiators Painting</p>
                    <p className="text-xs mt-0.5" style={{ color: "#4ade80" }}>● AI Receptionist Active</p>
                  </div>
                </div>
                <div className="hidden md:flex items-center gap-6 text-sm font-medium" style={{ color: MUTED }}>
                  <div className="flex items-center gap-2"><PhoneCall className="w-4 h-4" style={{ color: ORANGE }} /> 14 Calls Today</div>
                  <div className="flex items-center gap-2"><CalendarCheck className="w-4 h-4" style={{ color: ORANGE }} /> 3 Bookings</div>
                </div>
              </div>

              <div className="flex-1 flex overflow-hidden">
                <div className="w-56 hidden lg:flex flex-col p-4 gap-2 shrink-0" style={{ background: CARD_MID, borderRight: "1px solid rgba(245,240,235,0.07)" }}>
                  {[
                    { icon: Bot, label: "Live Calls", active: true },
                    { icon: CalendarCheck, label: "Calendar", active: false },
                    { icon: MessageSquare, label: "SMS Follow-ups", active: false },
                  ].map(({ icon: Icon, label, active }, i) => (
                    <div key={i} className="px-3 py-2 rounded-lg flex items-center gap-3 text-sm font-medium" style={{ background: active ? "rgba(232,112,42,0.12)" : "transparent", color: active ? ORANGE : MUTED }}>
                      <Icon className="w-4 h-4" />
                      {label}
                    </div>
                  ))}
                </div>

                <div className="flex-1 p-4 md:p-6 flex flex-col gap-4 overflow-y-auto">
                  <div className="rounded-2xl flex-1 flex flex-col overflow-hidden" style={{ background: "#0F0F0E", border: "1px solid rgba(245,240,235,0.07)" }}>
                    <div className="px-5 py-3.5 flex justify-between items-center text-left" style={{ borderBottom: "1px solid rgba(245,240,235,0.07)" }}>
                      <div>
                        <h3 className="font-semibold text-sm" style={{ color: OFF_WHITE }}>Live Transcript</h3>
                        <p className="text-xs mt-0.5" style={{ color: MUTED }}>+1 (713) 555-0199 · Houston, TX</p>
                      </div>
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase" style={{ background: "rgba(96,165,250,0.1)", color: "#60a5fa" }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        Live
                      </div>
                    </div>
                    <div className="flex-1 p-5 flex flex-col gap-5 overflow-y-auto text-left">
                      {[
                        { bot: true, text: "Thank you for calling Gladiators Painting! Are you looking to schedule a free painting estimate?" },
                        { bot: false, text: "Yes, I need the exterior of my house painted. It's a two-story home." },
                        { bot: true, text: "Great! When were you hoping to get started, and what's the best day for a free estimate this week?" },
                        { bot: false, text: "Maybe Thursday or Friday morning works for me." },
                        { bot: true, text: "Perfect — I have Thursday at 9:00 AM available. Can I get your name and address to confirm the booking?" },
                      ].map((msg, i) => (
                        <div key={i} className={`flex gap-3 ${msg.bot ? "" : "justify-end"}`}>
                          {msg.bot && (
                            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(232,112,42,0.12)" }}>
                              <Bot className="w-4 h-4" style={{ color: ORANGE }} />
                            </div>
                          )}
                          <div className="px-4 py-2.5 rounded-2xl text-sm leading-relaxed max-w-[85%]" style={
                            msg.bot
                              ? { background: CARD_MID, color: "rgba(245,240,235,0.8)", borderRadius: "4px 16px 16px 16px" }
                              : { background: ORANGE, color: "#fff", borderRadius: "16px 4px 16px 16px" }
                          }>
                            {msg.text}
                          </div>
                          {!msg.bot && (
                            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(245,240,235,0.08)" }}>
                              <User className="w-4 h-4" style={{ color: MUTED }} />
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="flex justify-center">
                        <div className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: "rgba(74,222,128,0.08)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.15)" }}>
                          <CheckCircle2 className="w-3.5 h-3.5" /> AI verified availability — booking to Google Calendar
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ContainerScroll>
        </div>

        {/* ── TICKER ── */}
        <Ticker />

        {/* ── WHY DIFFERENT ── */}
        <section className="py-20 px-6 max-w-[480px] mx-auto" style={{ borderBottom: "1px solid rgba(245,240,235,0.07)" }}>
          <div className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: ORANGE }}>Why this is different</div>
          <h2 className="font-['Syne'] text-3xl font-extrabold leading-tight mb-5" style={{ color: OFF_WHITE }}>
            Call bots answer the phone.<br/>
            <span style={{ color: ORANGE }}>We close more revenue.</span>
          </h2>
          <p className="text-sm leading-relaxed mb-7" style={{ color: "rgba(245,240,235,0.55)" }}>
            Tools like Goodcall and Smith.ai stop at inbound. The real money is in what happens
            <em className="not-italic font-semibold" style={{ color: OFF_WHITE }}> after</em> the
            call — follow-up, recovery, coaching, and referrals.
          </p>

          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(245,240,235,0.08)" }}>
            <div className="flex px-3 py-2.5" style={{ background: CARD_MID }}>
              <div className="flex-1 text-xs font-bold uppercase tracking-wide" style={{ color: MUTED }}>Feature</div>
              <div className="w-24 text-center text-xs font-bold uppercase tracking-wide" style={{ color: MUTED }}>Call bots</div>
              <div className="w-24 text-center text-xs font-bold uppercase tracking-wide" style={{ color: ORANGE }}>AFDH</div>
            </div>
            {[
              ["Answers inbound calls", true, true],
              ["Books appointments", true, true],
              ["Outbound campaigns", false, true],
              ["Script retiring (win-backs)", false, true],
              ["Estimate follow-up sequence", false, true],
              ["AI revenue coaching", false, true],
              ["Review writer", false, true],
              ["Close rate by lead source", false, true],
            ].map(([label, callBot, us], i) => (
              <div key={i} className="flex px-3 py-2.5" style={{ borderTop: "1px solid rgba(245,240,235,0.05)", background: i % 2 === 0 ? CARD_DARK : "transparent" }}>
                <div className="flex-1 text-xs" style={{ color: "rgba(245,240,235,0.7)" }}>{label}</div>
                <div className="w-24 text-center text-sm" style={{ color: callBot ? "rgba(245,240,235,0.5)" : "#333" }}>{callBot ? "✓" : <span style={{ color: "#2a2a28" }}>✕</span>}</div>
                <div className="w-24 text-center text-sm" style={{ color: ORANGE }}>{us ? "✓" : "✕"}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── FEATURES ── */}
        <section id="features" className="py-20 px-6 max-w-[480px] mx-auto">
          <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: ORANGE }}>Features</div>
          <h2 className="font-['Syne'] text-3xl font-extrabold leading-tight mb-3" style={{ color: OFF_WHITE }}>
            The full revenue pipeline
          </h2>
          <p className="text-sm mb-8" style={{ color: MUTED }}>Every step automates something your team was dropping.</p>

          <div className="flex flex-col gap-3">
            {[
              { icon: Headphones, name: "AI Receptionist", description: "Natural conversations 24/7. Answers calls, asks the right questions, and sounds like a real team member." },
              { icon: CalendarDays, name: "Book & Transfer", description: "Books estimates directly into Google Calendar and your CRM. Live-transfer to your team when needed." },
              { icon: Zap, name: "Objection Detection", description: "When someone says 'too expensive' the AI detects it and switches to the right recovery sequence automatically." },
              { icon: Users, name: "Referral Autopilot", description: "Customer texts a referral name — AI extracts the contact and calls them within minutes. Completely automatic." },
              { icon: Smartphone, name: "SMS Follow-ups", description: "Automated follow-ups at 24h, 3d, 5d, 10d so quotes never go cold." },
              { icon: BarChart2, name: "Revenue by Source", description: "Every number tagged to a lead source. Know exactly which marketing produces booked revenue — not just calls." },
              { icon: Link2, name: "CRM Sync", description: "Every lead and booking sent to Jobber, DripJobs, Housecall Pro, or any system via Zapier. Zero manual entry." },
              { icon: Star, name: "Review Response Writer", description: "Customer leaves a Google review — AI writes an SEO-optimized owner response. One click to post." },
            ].map((card, i) => (
              <FeatureCard key={i} {...card} onClick={handleGetStarted} />
            ))}
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section id="how-it-works" className="py-20 px-6 max-w-[480px] mx-auto" style={{ borderTop: "1px solid rgba(245,240,235,0.07)" }}>
          <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: ORANGE }}>How it works</div>
          <h2 className="font-['Syne'] text-3xl font-extrabold leading-tight mb-3" style={{ color: OFF_WHITE }}>Set up in minutes</h2>
          <p className="text-sm mb-8" style={{ color: MUTED }}>Your existing number or a new one — we handle the rest.</p>

          <div className="flex flex-col gap-4">
            <StepCard icon={Phone} step={1} title="Connect your number" description="Point your Twilio number to AI Front Desk Helper. No new hardware — works with your current phone system." />
            <StepCard icon={Settings} step={2} title="Configure once" description="Set your welcome message, transfer numbers, and CRM webhook in the dashboard. The AI follows your playbook." />
            <StepCard icon={Zap} step={3} title="Let it run" description="Every call is answered, recorded, and transcribed. Review calls and metrics anytime in the dashboard." />
          </div>
        </section>

        {/* ── PROOF SECTION ── */}
        <section className="py-20 px-6 max-w-[480px] mx-auto" style={{ borderTop: "1px solid rgba(245,240,235,0.07)" }}>
          <div className="rounded-2xl p-8" style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.07)" }}>
            <div className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: ORANGE }}>
              Real results — Gladiators Painting
            </div>
            <h3 className="font-['Syne'] text-2xl font-extrabold leading-snug mb-3" style={{ color: OFF_WHITE }}>
              Running live on a real painting company right now
            </h3>
            <p className="text-sm leading-relaxed mb-7" style={{ color: MUTED }}>
              We didn't build this for contractors — we built it as one. Every feature was tested on a real business before it shipped.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-7">
              {[
                { val: "28", label: "Calls answered by AI last month" },
                { val: "53%", label: "Booking rate (industry avg: 20-30%)" },
                { val: "$11,500", label: "Revenue tracked in dashboard" },
                { val: "15", label: "AI-booked estimates, last 30 days" },
              ].map((s, i) => (
                <div key={i} className="rounded-xl p-5" style={{ background: CARD_MID }}>
                  <div className="font-['Syne'] font-extrabold mb-1" style={{ fontSize: i === 2 ? 20 : 26, color: ORANGE }}>{s.val}</div>
                  <div className="text-xs leading-snug" style={{ color: MUTED }}>{s.label}</div>
                </div>
              ))}
            </div>

            <blockquote className="pl-4" style={{ borderLeft: `3px solid ${ORANGE}` }}>
              <p className="text-sm italic leading-relaxed mb-3" style={{ color: "rgba(245,240,235,0.75)" }}>
                "I built this for my own painting company because I was losing jobs to voicemail every day. Now it answers every call, follows up on every cold estimate, and coaches me on what to fix."
              </p>
              <footer className="text-xs" style={{ color: MUTED }}>
                Drew — Owner, Gladiators Painting & Founder, AFDH
              </footer>
            </blockquote>
          </div>
        </section>

        {/* ── PRICING ── */}
        <section id="pricing" className="py-20 px-6 max-w-[480px] mx-auto" style={{ borderTop: "1px solid rgba(245,240,235,0.07)" }}>
          <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: ORANGE }}>Pricing</div>
          <h2 className="font-['Syne'] text-3xl font-extrabold leading-tight mb-3" style={{ color: OFF_WHITE }}>Let the system do it all.</h2>
          <p className="text-sm mb-7 leading-relaxed" style={{ color: MUTED }}>
            Basic gets you in the door. Elite is the full revenue machine — outbound, coaching, reviews, and pipeline automation.
          </p>

          {/* Annual toggle */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <span className="text-sm font-semibold" style={{ color: isAnnual ? MUTED : OFF_WHITE }}>Monthly</span>
            <div
              className="relative w-12 h-6 rounded-full cursor-pointer transition-all"
              style={{ background: isAnnual ? "rgba(232,112,42,0.2)" : "rgba(245,240,235,0.08)", border: isAnnual ? "1.5px solid rgba(232,112,42,0.5)" : "1.5px solid rgba(245,240,235,0.15)" }}
              onClick={() => setIsAnnual(!isAnnual)}
            >
              <div
                className="absolute top-[3px] w-4 h-4 rounded-full transition-all"
                style={{ left: isAnnual ? "calc(100% - 19px)" : 3, background: isAnnual ? ORANGE : "rgba(245,240,235,0.4)" }}
              />
            </div>
            <span className="text-sm font-semibold" style={{ color: isAnnual ? OFF_WHITE : MUTED }}>Annual</span>
            {isAnnual && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.2)" }}>
                2 months free
              </span>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {plans.map((plan, i) => (
              <PricingCard key={i} {...plan} isAnnual={isAnnual} onStart={handleGetStarted} />
            ))}
          </div>
          <p className="text-xs text-center mt-4" style={{ color: MUTED }}>
            Annual billing charged upfront. Monthly plans cancel anytime.
          </p>
        </section>

        {/* ── WHY US ── */}
        <section id="why-us" className="py-20 px-6 max-w-[480px] mx-auto" style={{ borderTop: "1px solid rgba(245,240,235,0.07)" }}>
          <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: ORANGE }}>Built for</div>
          <h2 className="font-['Syne'] text-3xl font-extrabold leading-tight mb-7" style={{ color: OFF_WHITE }}>
            Home service pros who are done leaving money on the table
          </h2>
          {[
            { trade: "Painting contractors", line: "Answer every estimate call. Follow up every cold quote. Retire the call script." },
            { trade: "Roofing companies", line: "Speed-to-lead wins in roofing. AI answers in 2 rings, books the inspection." },
            { trade: "HVAC & plumbing", line: "Emergency after-hours calls captured automatically. Never miss an urgent job." },
            { trade: "Fencing & landscaping", line: "Outbound AI calls your seasonal past customers. Reactivation on autopilot." },
            { trade: "Franchise groups", line: "HQ dashboard with AI coaching across all locations. Built for multi-unit scale." },
          ].map((item, i) => (
            <div key={i} className="flex gap-4 py-4" style={{ borderBottom: i < 4 ? "1px solid rgba(245,240,235,0.07)" : "none" }}>
              <span className="text-lg mt-0.5" style={{ color: ORANGE }}>→</span>
              <div>
                <div className="font-['Syne'] text-sm font-bold mb-1" style={{ color: OFF_WHITE }}>{item.trade}</div>
                <div className="text-sm leading-relaxed" style={{ color: MUTED }}>{item.line}</div>
              </div>
            </div>
          ))}
        </section>

        {/* ── FINAL CTA ── */}
        <section className="py-20 px-6 text-center max-w-[480px] mx-auto" style={{ paddingBottom: showStickyCTA ? 120 : 80 }}>
          <div style={{ background: "radial-gradient(ellipse at center, rgba(232,112,42,0.12) 0%, transparent 70%)", padding: "8px 0" }}>
            <h2 className="font-['Syne'] text-4xl font-extrabold leading-tight mb-4" style={{ color: OFF_WHITE }}>
              Ready to stop <span style={{ color: ORANGE }}>missing revenue?</span>
            </h2>
            <p className="text-sm leading-relaxed mb-8" style={{ color: MUTED }}>
              Create your account and connect your first number in minutes.
            </p>
            <button
              onClick={handleGetStarted}
              className="px-10 py-4 rounded-lg text-base font-bold text-white mb-4 transition-all hover:-translate-y-0.5 block mx-auto"
              style={{ background: ORANGE, fontFamily: "'Syne', sans-serif" }}
              onMouseEnter={e => e.currentTarget.style.background = "#d15f20"}
              onMouseLeave={e => e.currentTarget.style.background = ORANGE}
            >
              Get Started →
            </button>
            <button
              onClick={() => navigate("/login")}
              className="text-sm font-semibold transition-colors"
              style={{ background: "none", border: "none", cursor: "pointer", color: MUTED }}
              onMouseEnter={e => e.currentTarget.style.color = OFF_WHITE}
              onMouseLeave={e => e.currentTarget.style.color = MUTED}
            >
              I already have an account
            </button>
            <p className="text-xs mt-5" style={{ color: "#2a2a28" }}>
              By signing up you agree to receive SMS messages from AI Front Desk Helper.{" "}
              <Link to="/privacy-policy" style={{ color: "#3a3a38" }}>Privacy Policy</Link>.
            </p>
          </div>
        </section>

      </main>

      {/* ── FOOTER ── */}
      <SiteFooter />

      {/* ── STICKY BOTTOM CTA ── */}
      <AnimatePresence>
        {showStickyCTA && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 250 }}
            className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-[90] px-5 pb-5 pt-3"
            style={{ background: "linear-gradient(to top, rgba(17,16,16,1) 60%, transparent)" }}
          >
            <div
              className="rounded-2xl px-5 py-4 flex items-center justify-between cursor-pointer transition-all hover:-translate-y-0.5"
              style={{ background: ORANGE, boxShadow: "0 8px 32px rgba(232,112,42,0.4)" }}
              onClick={handleGetStarted}
            >
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-white/70 mb-0.5">Elite Plan · Full Revenue Machine</div>
                <div className="font-['Syne'] text-sm font-extrabold text-white">Do it all for you — $997/mo →</div>
              </div>
              <div className="px-3.5 py-2 rounded-lg text-xs font-bold text-white" style={{ background: "rgba(255,255,255,0.15)" }}>
                Start now
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MODALS ── */}
      <AnimatePresence>
        {isSmsConsentOpen && (
          <SmsConsentModal
            isOpen={isSmsConsentOpen}
            onClose={() => setIsSmsConsentOpen(false)}
            onAccept={handleConsentAccepted}
          />
        )}
      </AnimatePresence>

      <ContactModal
        isOpen={isContactOpen}
        onClose={() => setIsContactOpen(false)}
      />

    </div>
  );
}
