import { Link, useNavigate } from "react-router-dom";
import { ContainerScroll } from "../components/ui/container-scroll-animation";
import { AnimatedHeroTitle } from "../components/ui/animated-hero";
import { NavBar } from "../components/ui/tubelight-navbar";
import { PhoneCall, CalendarCheck, MessageSquare, Bot, User, CheckCircle2, Home as HomeIcon, Layers, DollarSign, ShieldCheck, Headphones, CalendarDays, Link2, Smartphone, Phone, Settings, Zap } from "lucide-react";
import { BentoGrid, BentoCard } from "../components/ui/bento-grid";
import { ShimmerButton } from "../components/ui/shimmer-button";

const NAV_ITEMS = [
  { name: "Features", url: "#features", icon: Layers },
  { name: "How it works", url: "#how-it-works", icon: HomeIcon },
  { name: "Pricing", url: "#pricing", icon: DollarSign },
  { name: "Why us", url: "#why-us", icon: ShieldCheck },
];

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
      {/* Floating Tubelight Navbar */}
      <NavBar items={NAV_ITEMS} />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link
              to="/"
              className="flex items-center gap-2 font-semibold text-stone-900 text-lg"
            >
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-stone-800 text-white text-sm font-bold">
                FD
              </span>
              <span>Front Desk</span>
            </Link>
            <div className="flex items-center gap-3">
              <Link
                to="/login"
                className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
              >
                Log in
              </Link>
              <ShimmerButton
                onClick={() => navigate("/login?signup=1")}
                className="text-sm text-white font-medium px-4 py-2"
                shimmerSize="0.04em"
                background="rgba(41, 37, 36, 1)"
              >
                Get started
              </ShimmerButton>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <div className="flex flex-col overflow-hidden pb-4 md:pt-20">
          <ContainerScroll
            titleComponent={
              <AnimatedHeroTitle
                onStart={() => navigate("/login?signup=1")}
                onLogin={() => navigate("/login")}
              />
            }
          >
            <div className="h-full w-full bg-stone-50 rounded-xl overflow-hidden flex flex-col font-sans border-2 border-stone-200">
              {/* Header */}
              <div className="bg-white border-b border-stone-200 px-6 py-4 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-brand-600 rounded-lg text-white flex items-center justify-center font-bold text-xs shadow-sm">
                    FD
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-stone-900 text-sm leading-tight">Gladiators Home Services</p>
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
                      <p className="font-semibold text-stone-900 line-clamp-1">Sink Repair - John D.</p>
                      <p className="text-stone-500 text-xs mt-1">Tomorrow at 10:00 AM</p>
                    </div>
                  </div>
                </div>

                {/* Main Content: Call Interface */}
                <div className="flex-1 p-4 md:p-8 flex flex-col gap-6 overflow-y-auto">
                  <div className="bg-white rounded-2xl shadow-sm border border-stone-200 flex-1 flex flex-col overflow-hidden">
                    <div className="px-6 py-4 border-b border-stone-100 bg-stone-50/50 flex justify-between items-center text-left">
                      <div>
                        <h3 className="font-semibold text-stone-900">Live Transcript</h3>
                        <p className="text-xs text-stone-500 mt-0.5">+1 (512) 555-0199 • Austin, TX</p>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold uppercase tracking-wider shrink-0">
                        <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse"></span> Calling
                      </div>
                    </div>

                    <div className="flex-1 p-6 flex flex-col gap-6 overflow-y-auto bg-stone-50/30 text-left">
                      {/* Messages */}
                      <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                          <Bot className="w-4 h-4 text-brand-700" />
                        </div>
                        <div className="bg-white border border-stone-200 shadow-sm rounded-2xl rounded-tl-none px-5 py-3 text-sm text-stone-700 max-w-[85%] leading-relaxed">
                          Hi, thanks for calling Acme Home Services! I'm the virtual assistant. Are you looking to get a new estimate or do you need help with an existing job?
                        </div>
                      </div>

                      <div className="flex gap-4 justify-end">
                        <div className="bg-brand-600 text-white shadow-sm rounded-2xl rounded-tr-none px-5 py-3 text-sm max-w-[85%] leading-relaxed">
                          I have a leaking pipe under my kitchen sink, I need someone to come out and fix it.
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
                          I can definitely help line someone up for that. Just to confirm, are you located in our standard service area of Austin?
                        </div>
                      </div>

                      <div className="flex gap-4 justify-end">
                        <div className="bg-brand-600 text-white shadow-sm rounded-2xl rounded-tr-none px-5 py-3 text-sm max-w-[85%] leading-relaxed">
                          Yes, I'm in South Austin.
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
                          Great! I have a technician available tomorrow at 10:00 AM or Thursday at 2:00 PM. Would either of those work for you?
                        </div>
                      </div>

                      <div className="flex justify-center mt-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-green-700 bg-green-50 px-3 py-2 rounded-lg border border-green-200 shadow-sm">
                          <CheckCircle2 className="w-3.5 h-3.5" /> AI verified availability on Google Calendar
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ContainerScroll>
        </div>

        {/* Features */}
        <section id="features" className="py-20 sm:py-24 bg-white border-y border-stone-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">
                Everything you need to capture leads
              </h2>
              <p className="mt-4 text-lg text-stone-600 max-w-2xl mx-auto">
                One system to answer, qualify, book, and follow up—without hiring a full-time receptionist.
              </p>
            </div>
            <BentoGrid className="lg:grid-rows-3">
              <BentoCard
                Icon={Headphones}
                name="AI Receptionist"
                description="Natural conversations 24/7. Answers calls, asks the right questions, and sounds like a real team member."
                href="/login?signup=1"
                cta="Get started"
                background={
                  <>
                    <img src="https://images.unsplash.com/photo-1596524430615-b46475ddff6e?auto=format&fit=crop&w=800&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    <div className="absolute inset-0 " />
                  </>
                }
                className="lg:row-start-1 lg:row-end-4 lg:col-start-2 lg:col-end-3"
              />
              <BentoCard
                Icon={CalendarDays}
                name="Book & Transfer"
                description="Books appointments and estimates. Live-transfer to your team when the caller needs a human."
                href="/login?signup=1"
                cta="Get started"
                background={
                  <>
                    <img src="https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=800&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    <div className="absolute inset-0 " />
                  </>
                }
                className="lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-3"
              />
              <BentoCard
                Icon={Link2}
                name="CRM Sync"
                description="Sends every lead and booking to your CRM or Zapier. Stay in sync with DripJobs and your existing tools."
                href="/login?signup=1"
                cta="Get started"
                background={
                  <>
                    <img src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    <div className="absolute inset-0 bg-gradient-to-t from-white via-white/90 to-white/40" />
                  </>
                }
                className="lg:col-start-1 lg:col-end-2 lg:row-start-3 lg:row-end-4"
              />
              <BentoCard
                Icon={Smartphone}
                name="SMS Follow-ups"
                description="Automated follow-ups at 24h, 3d, 5d, and 10d so quotes don't go cold."
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
                Icon={Bot}
                name="Lead Qualification"
                description="AI asks interior or exterior, when they want to start, and their budget — qualifying leads before they reach you."
                href="/login?signup=1"
                cta="Get started"
                background={
                  <>
                    <img src="https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=800&q=80" alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    <div className="absolute inset-0 bg-gradient-to-t from-white via-white/90 to-white/40" />
                  </>
                }
                className="lg:col-start-3 lg:col-end-3 lg:row-start-2 lg:row-end-4"
              />
            </BentoGrid>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="py-20 sm:py-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">
                How it works
              </h2>
              <p className="mt-4 text-lg text-stone-600 max-w-2xl mx-auto">
                Get set up in minutes. Your existing number or a new one — we handle the rest.
              </p>
            </div>
            <div className="relative">
              {/* Connecting line */}
              <div className="hidden md:block absolute top-16 left-[16.67%] right-[16.67%] h-0.5 bg-gradient-to-r from-stone-200 via-stone-300 to-stone-200" />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Step 1 */}
                <div className="group relative bg-white rounded-2xl border border-stone-200 p-8 text-center transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-stone-300">
                  <div className="relative z-10">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-stone-800 to-stone-600 text-white flex items-center justify-center shadow-lg shadow-stone-300/50 transition-transform duration-300 group-hover:scale-110">
                      <Phone className="w-6 h-6" />
                    </div>
                    <span className="inline-block mt-4 text-xs font-bold uppercase tracking-widest text-stone-400">Step 1</span>
                    <h3 className="mt-2 text-xl font-semibold text-stone-900">Connect your number</h3>
                    <p className="mt-3 text-stone-600 leading-relaxed">
                      Point your Twilio number to Front Desk. No new hardware — works with your current phone system.
                    </p>
                  </div>
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-stone-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>

                {/* Step 2 */}
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

                {/* Step 3 */}
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

        {/* Pricing */}
        <section id="pricing" className="py-20 sm:py-24 bg-white border-y border-stone-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">
                Simple pricing
              </h2>
              <p className="mt-4 text-lg text-stone-600 max-w-2xl mx-auto">
                Start with Basic to never miss a call. Upgrade when you need scheduling and follow-up automation.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Basic — full detail */}
              <div className="rounded-2xl border-2 border-stone-200 bg-stone-50/50 p-8 flex flex-col">
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
                  <span className="text-3xl font-bold text-stone-900">$29</span>
                  <span className="text-stone-500">/month</span>
                </div>

                <div className="mt-8 pt-6 border-t border-stone-200">
                  <p className="text-xs text-stone-500 mb-3">300 voice min · 500 SMS/mo</p>
                  <button
                    type="button"
                    onClick={() => navigate("/login?signup=1")}
                    className="w-full inline-flex items-center justify-center px-6 py-3 rounded-xl text-sm font-semibold text-white bg-stone-800 hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-600 transition-colors"
                  >
                    Get started
                  </button>
                </div>
              </div>

              {/* Pro — compact */}
              <div className="rounded-2xl border border-stone-200 bg-white p-8 flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl" aria-hidden>🥈</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Growing teams</span>
                </div>
                <h3 className="mt-4 text-2xl font-bold text-stone-900">Pro</h3>
                <p className="text-base font-medium text-stone-600 mt-1">AI Booking Assistant</p>
                <p className="mt-3 text-sm text-stone-600">
                  Everything in Basic plus Google Calendar, website chat, Facebook messaging, and appointment reminders.
                </p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-stone-900">$79</span>
                  <span className="text-stone-500">/month</span>
                </div>
                <p className="mt-6 text-xs text-stone-500">800 voice min · 1,500 SMS/mo</p>
                <button
                  type="button"
                  onClick={() => navigate("/login?signup=1")}
                  className="mt-auto pt-8 w-full inline-flex items-center justify-center px-6 py-3 rounded-xl text-sm font-semibold text-stone-700 bg-white border-2 border-stone-200 hover:border-stone-300 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 transition-colors"
                >
                  Get started
                </button>
              </div>

              {/* Elite — compact */}
              <div className="rounded-2xl border border-stone-200 bg-white p-8 flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl" aria-hidden>🥇</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Scaling companies</span>
                </div>
                <h3 className="mt-4 text-2xl font-bold text-stone-900">Elite</h3>
                <p className="text-base font-medium text-stone-600 mt-1">AI Sales & Follow-Up Engine</p>
                <p className="mt-3 text-sm text-stone-600">
                  Everything in Pro plus AI follow-up calls, SMS sequences, no-show recovery, and revenue recovery.
                </p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-stone-900">$199</span>
                  <span className="text-stone-500">/month</span>
                </div>
                <p className="mt-6 text-xs text-stone-500">2,000 voice min · 4,000 SMS/mo</p>
                <button
                  type="button"
                  onClick={() => navigate("/login?signup=1")}
                  className="mt-auto pt-8 w-full inline-flex items-center justify-center px-6 py-3 rounded-xl text-sm font-semibold text-stone-700 bg-white border-2 border-stone-200 hover:border-stone-300 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 transition-colors"
                >
                  Get started
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Why us */}
        <section id="why-us" className="py-20 sm:py-24 bg-white border-y border-stone-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">
                Built for home service pros
              </h2>
              <p className="mt-4 text-lg text-stone-600 max-w-2xl mx-auto">
                Contractors, painters, roofers, and field service companies use Front Desk to stop losing leads to voicemail.
              </p>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
              {[
                "Answer every call—no more missed opportunities",
                "Qualify leads and book jobs while you’re on site",
                "Live transfer when a caller needs to talk now",
                "Recordings and transcripts for every call",
                "Sync to DripJobs, Zapier, or your CRM",
                "Follow-up SMS so quotes don’t go cold",
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

        {/* CTA */}
        <section className="py-20 sm:py-28">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">
              Ready to stop missing calls?
            </h2>
            <p className="mt-4 text-lg text-stone-600">
              Create your account and connect your first number in minutes.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <ShimmerButton
                onClick={() => navigate("/login?signup=1")}
                className="w-full sm:w-auto text-base text-white font-semibold px-8 py-4"
                shimmerSize="0.05em"
                background="rgba(41, 37, 36, 1)"
              >
                Get started free
              </ShimmerButton>
              <Link
                to="/login"
                className="text-base font-semibold text-stone-600 hover:text-stone-900 transition-colors"
              >
                I already have an account
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-stone-900 text-stone-300 py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-stone-700 text-white text-sm font-bold">
                FD
              </span>
              <span className="font-semibold text-white">Front Desk</span>
            </div>
            <nav className="flex items-center gap-6">
              <Link to="/login" className="text-sm hover:text-white transition-colors">
                Log in
              </Link>
              <button
                type="button"
                onClick={() => navigate("/login?signup=1")}
                className="text-sm hover:text-white transition-colors"
              >
                Sign up
              </button>
            </nav>
          </div>
          <div className="mt-8 pt-8 border-t border-stone-700 text-center sm:text-left text-sm text-stone-500">
            © {new Date().getFullYear()} Front Desk. AI phone assistant for your business.
          </div>
        </div>
      </footer>
    </div>
  );
}
