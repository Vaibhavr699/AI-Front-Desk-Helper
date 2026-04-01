import { Link, useNavigate } from "react-router-dom";
import { ContainerScroll } from "../components/ui/container-scroll-animation";
import { AnimatedHeroTitle } from "../components/ui/animated-hero";
import { NavBar } from "../components/ui/tubelight-navbar";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import {
  PhoneCall, CalendarCheck, MessageSquare, Bot, User, CheckCircle2,
  Home as HomeIcon, Layers, DollarSign, ShieldCheck, Headphones,
  CalendarDays, Link2, Smartphone, Phone, Settings, Zap, Users, BarChart2
} from "lucide-react";
import { BentoGrid, BentoCard } from "../components/ui/bento-grid";
import { ShimmerButton } from "../components/ui/shimmer-button";
import { ContactModal } from "../components/ContactModal";
import { useState } from "react";

const NAV_ITEMS = [
  { name: "Features",     url: "#features",     icon: Layers      },
  { name: "How it works", url: "#how-it-works", icon: HomeIcon    },
  { name: "Pricing",      url: "#pricing",      icon: DollarSign  },
  { name: "Why us",       url: "#why-us",       icon: ShieldCheck },
];

/* ─────────────────────────────────────────────────────────────
   SMS CONSENT MODAL
   Fires when any "Get Started" or "Start setup" button is clicked.
   User must check the consent box before proceeding to signup.
───────────────────────────────────────────────────────────── */
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
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sms-consent-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal box */}
      <div className="relative z-10 w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 flex flex-col gap-6">

        {/* Header */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="text-stone-400 hover:text-stone-600 transition-colors p-1 rounded-lg hover:bg-stone-100"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <h2 id="sms-consent-title" className="text-xl font-bold text-stone-900">
            Before you get started
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Please review and agree to our messaging policy.
          </p>
        </div>

        {/* Consent text box */}
        <div className="bg-stone-50 rounded-xl p-4 border border-stone-200 text-xs text-stone-600 leading-relaxed space-y-3">
          <p>
            By submitting this form, you agree to receive text messages from{" "}
            <span className="font-semibold text-stone-800">AI Front Desk Helper</span>{" "}
            related to your inquiry, including appointment updates, follow-ups, and service
            notifications. Message frequency varies. Message &amp; data rates may apply.
            Reply <strong>STOP</strong> to opt out.
          </p>
          <p>
            I agree to receive SMS text messages from{" "}
            <span className="font-semibold text-stone-800">AI Front Desk Helper</span>{" "}
            regarding my estimate request, appointment scheduling, and project updates.
            Message &amp; data rates may apply. Reply <strong>STOP</strong> to opt out.{" "}
            <a
              href="/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-500 hover:text-orange-600 underline underline-offset-2 font-medium"
            >
              View Privacy Policy
            </a>
            .
          </p>
          <p className="text-[11px] text-stone-400">
            Consent is not required as a condition of purchasing services.
          </p>
        </div>

        {/* Checkbox */}
        <label className="flex items-start gap-3 cursor-pointer group">
          <div className="flex-shrink-0 mt-0.5">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="w-4 h-4 rounded border-stone-300 text-orange-500 focus:ring-orange-500 focus:ring-offset-0 cursor-pointer"
            />
          </div>
          <span className="text-sm text-stone-700 leading-snug">
            I have read and agree to the SMS messaging terms above.
          </span>
        </label>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 px-4 py-3 rounded-xl border border-stone-200 bg-white text-sm font-semibold text-stone-600 hover:border-stone-300 hover:text-stone-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={!checked}
            className={`flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white transition-all ${
              checked
                ? "bg-orange-500 hover:bg-orange-600 shadow-lg shadow-orange-200 cursor-pointer"
                : "bg-stone-200 text-stone-400 cursor-not-allowed"
            }`}
          >
            Continue to sign up →
          </button>
        </div>

      </div>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [isSmsConsentOpen, setIsSmsConsentOpen] = useState(false);

  function handleGetStarted() {
    setIsSmsConsentOpen(true);
  }

  function handleConsentAccepted() {
    setIsSmsConsentOpen(false);
    navigate("/login?signup=1");
  }

  return (
    <div className="min-h-screen flex flex-col bg-stone-50">

      {/* Floating Tubelight Navbar */}
      <NavBar items={NAV_ITEMS} />

      <SiteHeader />

      <main className="flex-1">

        {/* ════════════════════════════════════════════════
            HERO
        ════════════════════════════════════════════════ */}
        <div className="relative z-[60] flex flex-col overflow-hidden pb-4">
          <ContainerScroll
            titleComponent={
              <AnimatedHeroTitle
                onStart={handleGetStarted}
                onLogin={() => navigate("/login")}
                onContact={() => {
                  console.log("Opening contact modal");
                  setIsContactOpen(true);
                }}
              />
            }
          >
            <div className="h-full w-full bg-stone-50 rounded-xl overflow-hidden flex flex-col font-sans border-2 border-stone-200">

              {/* Dashboard header */}
              <div className="bg-white border-b border-stone-200 px-6 py-4 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-white border border-stone-200 rounded-xl flex items-center justify-center shadow-md overflow-hidden p-1">
                    <img src="/favicon.png" alt="Logo" className="w-full h-full object-contain" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-stone-900 text-sm leading-tight">Gladiators Painting</p>
                    <p className="text-xs text-stone-500 mt-0.5">AI Receptionist Active 🟢</p>
                  </div>
                </div>
                <div className="hidden md:flex items-center gap-6 text-sm font-medium text-stone-600">
                  <div className="flex items-center gap-2"><PhoneCall className="w-4 h-4 text-stone-400" /> 14 Calls Today</div>
                  <div className="flex items-center gap-2"><CalendarCheck className="w-4 h-4 text-stone-400" /> 3 Bookings</div>
                </div>
              </div>

              {/* Viewport */}
              <div className="flex-1 flex overflow-hidden bg-stone-100/50">

                {/* Sidebar */}
                <div className="w-64 bg-white border-r border-stone-200 hidden lg:flex flex-col p-4 gap-2 shrink-0">
                  <div className="px-3 py-2 bg-brand-50 rounded-lg font-medium text-sm text-brand-900 flex items-center gap-3">
                    <Bot className="w-4 h-4 text-brand-600" /> Live Calls
                  </div>
                  <div className="px-3 py-2 text-stone-600 font-medium text-sm hover:bg-stone-50 rounded-lg flex items-center gap-3">
                    <CalendarCheck className="w-4 h-4 text-stone-400" /> Calendar
                  </div>
                  <div className="px-3 py-2 text-stone-600 font-medium text-sm hover:bg-stone-50 rounded-lg flex items-center gap-3">
                    <MessageSquare className="w-4 h-4 text-stone-400" /> SMS Follow-ups
                  </div>
                  <div className="mt-auto text-left">
                    <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider px-3 mb-2">Recent Bookings</p>
                    <div className="p-3 bg-white border border-stone-200 rounded-xl shadow-sm text-sm">
                      <p className="font-semibold text-stone-900 line-clamp-1">Exterior Paint — Mike T.</p>
                      <p className="text-stone-500 text-xs mt-1">Tomorrow at 10:00 AM</p>
                    </div>
                  </div>
                </div>

                {/* Live transcript */}
                <div className="flex-1 p-4 md:p-8 flex flex-col gap-6 overflow-y-auto">
                  <div className="bg-white rounded-2xl shadow-sm border border-stone-200 flex-1 flex flex-col overflow-hidden">
                    <div className="px-6 py-4 border-b border-stone-100 bg-stone-50/50 flex justify-between items-center text-left">
                      <div>
                        <h3 className="font-semibold text-stone-900">Live Transcript</h3>
                        <p className="text-xs text-stone-500 mt-0.5">+1 (713) 555-0199 • Houston, TX</p>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold uppercase tracking-wider shrink-0">
                        <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse"></span> Live
                      </div>
                    </div>

                    <div className="flex-1 p-6 flex flex-col gap-6 overflow-y-auto bg-stone-50/30 text-left">

                      <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                          <Bot className="w-4 h-4 text-brand-700" />
                        </div>
                        <div className="bg-white border border-stone-200 shadow-sm rounded-2xl rounded-tl-none px-5 py-3 text-sm text-stone-700 max-w-[85%] leading-relaxed">
                          Thank you for calling Gladiators Painting! Are you looking to schedule a free painting estimate?
                        </div>
                      </div>

                      <div className="flex gap-4 justify-end">
                        <div className="bg-brand-600 text-white shadow-sm rounded-2xl rounded-tr-none px-5 py-3 text-sm max-w-[85%] leading-relaxed">
                          Yes, I need the exterior of my house painted. It's a two-story home.
                        </div>
                        <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center shrink-0 text-stone-500">
                          <User className="w-4 h-4" />
                        </div>
                      </div>

                      <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                          <Bot className="w-4 h-4 text-brand-700" />
                        </div>
                        <div className="bg-white border border-stone-200 shadow-sm rounded-2xl rounded-tl-none px-5 py-3 text-sm text-stone-700 max-w-[85%] leading-relaxed">
                          Great! When were you hoping to get started, and what's the best day for a free estimate this week?
                        </div>
                      </div>

                      <div className="flex gap-4 justify-end">
                        <div className="bg-brand-600 text-white shadow-sm rounded-2xl rounded-tr-none px-5 py-3 text-sm max-w-[85%] leading-relaxed">
                          Maybe Thursday or Friday morning works for me.
                        </div>
                        <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center shrink-0 text-stone-500">
                          <User className="w-4 h-4" />
                        </div>
                      </div>

                      <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                          <Bot className="w-4 h-4 text-brand-700" />
                        </div>
                        <div className="bg-white border border-stone-200 shadow-sm rounded-2xl rounded-tl-none px-5 py-3 text-sm text-stone-700 max-w-[85%] leading-relaxed">
                          Perfect — I have Thursday at 9:00 AM available. Can I get your name and address to confirm the booking?
                        </div>
                      </div>

                      <div className="flex justify-center mt-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-green-700 bg-green-50 px-3 py-2 rounded-lg border border-green-200 shadow-sm">
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

        {/* ════════════════════════════════════════════════
            FEATURES
        ════════════════════════════════════════════════ */}
        <section id="features" className="py-20 sm:py-24 bg-white border-y border-stone-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">
                Everything you need to capture leads
              </h2>
              <p className="mt-4 text-lg text-stone-600 max-w-2xl mx-auto">
                One system to answer, qualify, book, and follow up — without hiring a full-time receptionist.
              </p>
            </div>
            <BentoGrid className="lg:grid-rows-3">
              <BentoCard
                Icon={Headphones}
                name="AI Receptionist"
                description="Natural conversations 24/7. Answers calls, asks the right questions, and sounds like a real team member. Live transcripts of every call in your dashboard."
                href="/login?signup=1"
                cta="Get started"
                background={
                  <>
                    <img src="https://images.unsplash.com/photo-1596524430615-b46475ddff6e?auto=format&fit=crop&w=800&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    <div className="absolute inset-0" />
                  </>
                }
                className="lg:row-start-1 lg:row-end-4 lg:col-start-2 lg:col-end-3"
              />
              <BentoCard
                Icon={CalendarDays}
                name="Book & Transfer"
                description="Books estimates and appointments directly into Google Calendar and your CRM. Live-transfer to your team when the caller needs a human."
                href="/login?signup=1"
                cta="Get started"
                background={
                  <>
                    <img src="https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=800&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    <div className="absolute inset-0" />
                  </>
                }
                className="lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-2"
              />
              <BentoCard
                Icon={Zap}
                name="Objection Detection"
                description="When someone says 'too expensive' or 'need to think about it' the AI detects it and automatically switches to the right recovery sequence. No competitor does this."
                href="/login?signup=1"
                cta="See how it works"
                background={
                  <>
                    <img src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    <div className="absolute inset-0 bg-gradient-to-t from-white via-white/90 to-white/40" />
                  </>
                }
                className="lg:col-start-1 lg:col-end-2 lg:row-start-2 lg:row-end-3"
              />
              <BentoCard
                Icon={Users}
                name="Referral Autopilot"
                description="Customer texts back a referral name and number — AI reads the reply, extracts their contact, and calls the referral within minutes. Completely automatic."
                href="/login?signup=1"
                cta="See how it works"
                background={
                  <>
                    <img src="https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=800&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    <div className="absolute inset-0 bg-gradient-to-t from-white via-white/90 to-white/40" />
                  </>
                }
                className="lg:col-start-1 lg:col-end-2 lg:row-start-3 lg:row-end-4"
              />
              <BentoCard
                Icon={Smartphone}
                name="SMS Follow-ups"
                description="Automated follow-ups at 24h, 3d, 5d, and 10d so quotes don't go cold. Intelligent sequences — not generic blasts."
                href="/login?signup=1"
                cta="Get started"
                background={
                  <>
                    <img src="https://images.unsplash.com/photo-1611746872915-64382b5c76da?auto=format&fit=crop&w=800&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    <div className="absolute inset-0 bg-gradient-to-t from-white via-white/90 to-white/40" />
                  </>
                }
                className="lg:col-start-3 lg:col-end-3 lg:row-start-1 lg:row-end-2"
              />
              <BentoCard
                Icon={BarChart2}
                name="Revenue by Source"
                description="Every phone number tagged to a lead source. Know exactly which marketing — Google Ads, yard signs, Facebook — is producing booked revenue. Not just calls."
                href="/login?signup=1"
                cta="See the dashboard"
                background={
                  <>
                    <img src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    <div className="absolute inset-0 bg-gradient-to-t from-white via-white/90 to-white/40" />
                  </>
                }
                className="lg:col-start-3 lg:col-end-3 lg:row-start-2 lg:row-end-3"
              />
              <BentoCard
                Icon={Link2}
                name="CRM Sync"
                description="Sends every lead and booking to Jobber, DripJobs, Housecall Pro, or any system via Zapier. Zero manual entry."
                href="/login?signup=1"
                cta="Get started"
                background={
                  <>
                    <img src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    <div className="absolute inset-0 bg-gradient-to-t from-white via-white/90 to-white/40" />
                  </>
                }
                className="lg:col-start-3 lg:col-end-3 lg:row-start-3 lg:row-end-4"
              />
            </BentoGrid>
          </div>
        </section>

        {/* ════════════════════════════════════════════════
            HOW IT WORKS
        ════════════════════════════════════════════════ */}
        <section id="how-it-works" className="py-20 sm:py-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">How it works</h2>
              <p className="mt-4 text-lg text-stone-600 max-w-2xl mx-auto">
                Get set up in minutes. Your existing number or a new one — we handle the rest.
              </p>
            </div>
            <div className="relative">
              <div className="hidden md:block absolute top-16 left-[16.67%] right-[16.67%] h-0.5 bg-gradient-to-r from-stone-200 via-stone-300 to-stone-200" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

                <div className="group relative bg-white rounded-2xl border border-stone-200 p-8 text-center transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-stone-300">
                  <div className="relative z-10">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-stone-800 to-stone-600 text-white flex items-center justify-center shadow-lg shadow-stone-300/50 transition-transform duration-300 group-hover:scale-110">
                      <Phone className="w-6 h-6" />
                    </div>
                    <span className="inline-block mt-4 text-xs font-bold uppercase tracking-widest text-stone-400">Step 1</span>
                    <h3 className="mt-2 text-xl font-semibold text-stone-900">Connect your number</h3>
                    <p className="mt-3 text-stone-600 leading-relaxed">
                      Point your Twilio number to AI Front Desk Helper. No new hardware — works with your current phone system.
                    </p>
                  </div>
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-stone-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>

                <div className="group relative bg-white rounded-2xl border border-stone-200 p-8 text-center transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-stone-300">
                  <div className="relative z-10">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-500 text-white flex items-center justify-center shadow-lg shadow-brand-200/50 transition-transform duration-300 group-hover:scale-110">
                      <Settings className="w-6 h-6" />
                    </div>
                    <span className="inline-block mt-4 text-xs font-bold uppercase tracking-widest text-stone-400">Step 2</span>
                    <h3 className="mt-2 text-xl font-semibold text-stone-900">Configure once</h3>
                    <p className="mt-3 text-stone-600 leading-relaxed">
                      Set your welcome message, transfer numbers, and CRM webhook in the dashboard. The AI follows your playbook.
                    </p>
                  </div>
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-brand-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>

                <div className="group relative bg-white rounded-2xl border border-stone-200 p-8 text-center transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-stone-300">
                  <div className="relative z-10">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-green-600 to-green-500 text-white flex items-center justify-center shadow-lg shadow-green-200/50 transition-transform duration-300 group-hover:scale-110">
                      <Zap className="w-6 h-6" />
                    </div>
                    <span className="inline-block mt-4 text-xs font-bold uppercase tracking-widest text-stone-400">Step 3</span>
                    <h3 className="mt-2 text-xl font-semibold text-stone-900">Let it run</h3>
                    <p className="mt-3 text-stone-600 leading-relaxed">
                      Every call is answered, recorded, and transcribed. Review calls and metrics anytime in the dashboard.
                    </p>
                  </div>
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-green-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>

              </div>
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════
            PRICING
        ════════════════════════════════════════════════ */}
        <section id="pricing" className="py-20 sm:py-24 bg-white border-y border-stone-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">Simple pricing</h2>
              <p className="mt-4 text-lg text-stone-600 max-w-2xl mx-auto">
                Start with Basic to never miss a call. Upgrade when you need scheduling and follow-up automation.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

              {/* Basic */}
              <div className="rounded-2xl border-2 border-stone-200 bg-white p-8 flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl" aria-hidden>🥉</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Small ops</span>
                </div>
                <h3 className="mt-4 text-2xl font-bold text-stone-900">Basic</h3>
                <p className="text-base font-medium text-stone-600 mt-1">AI Front Desk Starter</p>
                <p className="mt-3 text-sm text-stone-600">
                  Best for small contractors who just want missed calls handled.
                </p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-stone-900">$297</span>
                  <span className="text-stone-500">/month</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-brand-600">+$197 setup fee</p>
                <ul className="mt-4 space-y-2 text-sm text-stone-600">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> 24/7 AI call answering</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Missed call text back</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Lead capture + CRM forwarding</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Basic qualification script</li>
                </ul>
                <div className="mt-8 pt-6 border-t border-stone-200">
                  <p className="text-xs text-stone-500 mb-3">500 voice min · 500 SMS/mo</p>
                  <button
                    type="button"
                    onClick={handleGetStarted}
                    className="w-full inline-flex items-center justify-center px-6 py-3 rounded-xl text-sm font-semibold text-white bg-stone-800 hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-600 transition-colors"
                  >
                    Get started
                  </button>
                </div>
              </div>

              {/* Pro — MOST POPULAR */}
              <div className="rounded-2xl border-2 border-orange-500 bg-white p-8 flex flex-col relative shadow-xl shadow-orange-100">
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="bg-orange-500 text-white text-xs font-bold px-5 py-1.5 rounded-full uppercase tracking-wider shadow-lg">
                    Most Popular
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span className="text-2xl" aria-hidden>🥈</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-orange-500">Growing teams</span>
                </div>
                <h3 className="mt-4 text-2xl font-bold text-stone-900">Pro</h3>
                <p className="text-base font-medium text-stone-600 mt-1">AI Booking Assistant</p>
                <p className="mt-3 text-sm text-stone-600">
                  Everything in Basic plus Google Calendar, website chat, Facebook messaging, and appointment reminders.
                </p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-stone-900">$497</span>
                  <span className="text-stone-500">/month</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-brand-600">+$297 setup fee</p>
                <ul className="mt-4 space-y-2 text-sm text-stone-600">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Everything in Basic</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Google Calendar integration</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Website AI chat widget</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Facebook Messenger</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Appointment reminders</li>
                </ul>
                <div className="mt-8 pt-6 border-t border-stone-200">
                  <p className="text-xs text-stone-500 mb-3">1,200 voice min · 1,500 SMS/mo</p>
                  <button
                    type="button"
                    onClick={handleGetStarted}
                    className="w-full inline-flex items-center justify-center px-6 py-3 rounded-xl text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 transition-colors"
                  >
                    Get started
                  </button>
                </div>
              </div>

              {/* Elite */}
              <div className="rounded-2xl border-2 border-stone-200 bg-white p-8 flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl" aria-hidden>🥇</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Scaling companies</span>
                </div>
                <h3 className="mt-4 text-2xl font-bold text-stone-900">Elite</h3>
                <p className="text-base font-medium text-stone-600 mt-1">AI Sales & Follow-Up Engine</p>
                <p className="mt-3 text-sm text-stone-600">
                  Everything in Pro plus AI follow-up calls, objection detection, outbound campaigns, and revenue recovery.
                </p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-stone-900">$997</span>
                  <span className="text-stone-500">/month</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-brand-600">+$497 setup fee</p>
                <ul className="mt-4 space-y-2 text-sm text-stone-600">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Everything in Pro</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> AI follow-up calls + objection detection</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Outbound AI campaigns</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Referral autopilot</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> Revenue recovery system</li>
                </ul>
                <div className="mt-8 pt-6 border-t border-stone-200">
                  <p className="text-xs text-stone-500 mb-3">3,000 voice min · 4,000 SMS/mo</p>
                  <button
                    type="button"
                    onClick={handleGetStarted}
                    className="w-full inline-flex items-center justify-center px-6 py-3 rounded-xl text-sm font-semibold text-white bg-stone-800 hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-600 transition-colors"
                  >
                    Get started
                  </button>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════
            CASE STUDY — NEW SECTION
        ════════════════════════════════════════════════ */}
        <section className="py-20 sm:py-24 bg-stone-900">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-orange-400 font-bold uppercase tracking-wider text-sm mb-4">
              Real results — Gladiators Painting
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Running on a real painting company right now
            </h2>
            <p className="text-stone-400 text-lg mb-14 max-w-2xl mx-auto">
              We didn't build this for contractors — we built it as one. Every feature was tested on a real painting business before it shipped.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-14">
              <div className="bg-stone-800 rounded-2xl p-8 border border-stone-700">
                <div className="text-5xl font-bold text-orange-400 mb-2">28</div>
                <div className="text-stone-300 text-sm font-medium">Calls answered by AI last month</div>
                <div className="mt-2 text-stone-500 text-xs">Zero missed — including evenings and weekends</div>
              </div>
              <div className="bg-stone-800 rounded-2xl p-8 border border-stone-700">
                <div className="text-5xl font-bold text-orange-400 mb-2">53%</div>
                <div className="text-stone-300 text-sm font-medium">Booking rate</div>
                <div className="mt-2 text-stone-500 text-xs">Industry average is 20–30%</div>
              </div>
              <div className="bg-stone-800 rounded-2xl p-8 border border-stone-700">
                <div className="text-5xl font-bold text-orange-400 mb-2">$11,500</div>
                <div className="text-stone-300 text-sm font-medium">Revenue tracked in dashboard</div>
                <div className="mt-2 text-stone-500 text-xs">From 15 AI-booked estimates — last 30 days</div>
              </div>
            </div>

            <blockquote className="border-l-4 border-orange-500 pl-6 text-left max-w-2xl mx-auto">
              <p className="text-stone-300 text-lg italic leading-relaxed">
                "I built this for my own painting company because I was losing jobs to voicemail every day on the job site. Now the AI answers every call, follows up on every cold estimate, and calls my referrals automatically. I see all of it in one dashboard."
              </p>
              <footer className="mt-4">
                <p className="text-white font-semibold">Drew</p>
                <p className="text-stone-500 text-sm">Gladiators Painting + AI Front Desk Helper</p>
              </footer>
            </blockquote>
          </div>
        </section>

        {/* ════════════════════════════════════════════════
            WHY US
        ════════════════════════════════════════════════ */}
        <section id="why-us" className="py-20 sm:py-24 bg-white border-y border-stone-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">
                Built for home service pros
              </h2>
              <p className="mt-4 text-lg text-stone-600 max-w-2xl mx-auto">
                Painting contractors, roofers, HVAC companies, fencing, and plumbing use AI Front Desk Helper to stop losing leads and revenue.
              </p>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
              {[
                "Painting contractors — answer every estimate call automatically",
                "Roofing companies — follow up on every cold quote at 24h, 3d, 5d, 10d",
                "HVAC and plumbing — capture after-hours emergency calls",
                "Fencing and landscaping — outbound AI calls your past customers",
                "Multi-location contractors — one dashboard for all locations",
                "Franchise groups — built for multi-location growth",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-stone-700">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold mt-0.5">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ════════════════════════════════════════════════
            CTA
        ════════════════════════════════════════════════ */}
        <section className="py-20 sm:py-28">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">
              Ready to stop missing revenue?
            </h2>
            <p className="mt-4 text-lg text-stone-600">
              Create your account and connect your first number in minutes.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <ShimmerButton
                onClick={handleGetStarted}
                className="w-full sm:w-auto text-base text-white font-semibold px-8 py-4"
                shimmerSize="0.05em"
                background="rgba(41, 37, 36, 1)"
              >
                Get Started
              </ShimmerButton>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="w-full sm:w-auto px-8 py-4 rounded-xl border border-stone-300 bg-white text-base font-semibold text-stone-700 hover:text-stone-900 hover:border-stone-400 transition-colors"
              >
                I already have an account
              </button>
            </div>
            <p className="mt-4 text-xs text-stone-400">
              By signing up you agree to receive SMS messages from AI Front Desk Helper.{" "}
              <a href="/privacy-policy" className="underline hover:text-stone-600">Privacy Policy</a>.
            </p>
          </div>
        </section>

      </main>

      <SiteFooter />

      <ContactModal
        isOpen={isContactOpen}
        onClose={() => setIsContactOpen(false)}
      />

      {/* SMS Consent Modal — fires on all Get Started / Start setup clicks */}
      <SmsConsentModal
        isOpen={isSmsConsentOpen}
        onClose={() => setIsSmsConsentOpen(false)}
        onAccept={handleConsentAccepted}
      />

    </div>
  );
}
