import { Link, useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-stone-200">
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
            <nav className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors">
                Features
              </a>
              <a href="#how-it-works" className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors">
                How it works
              </a>
              <a href="#pricing" className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors">
                Pricing
              </a>
              <a href="#why-us" className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors">
                Why us
              </a>
            </nav>
            <div className="flex items-center gap-3">
              <Link
                to="/login"
                className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
              >
                Log in
              </Link>
              <button
                type="button"
                onClick={() => navigate("/login?signup=1")}
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium text-white bg-stone-800 hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-600 transition-colors"
              >
                Get started
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative py-20 sm:py-28 lg:py-32 overflow-hidden">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-stone-900 tracking-tight">
              Never miss a call again
            </h1>
            <p className="mt-6 text-xl sm:text-2xl text-stone-600 max-w-2xl mx-auto leading-relaxed">
              An AI phone assistant that answers every call, qualifies leads, books jobs, and connects you to your CRM—so you focus on the work that matters.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => navigate("/login?signup=1")}
                className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 rounded-xl text-base font-semibold text-white bg-stone-800 hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-600 transition-colors shadow-lg shadow-stone-900/10"
              >
                Start free
              </button>
              <Link
                to="/login"
                className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 rounded-xl text-base font-semibold text-stone-700 bg-white border-2 border-stone-200 hover:border-stone-300 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 transition-colors"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>

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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              <div className="rounded-2xl border border-stone-200 bg-stone-50/50 p-6">
                <div className="w-12 h-12 rounded-xl bg-stone-800 text-white flex items-center justify-center text-lg font-bold mb-4">
                  AI
                </div>
                <h3 className="text-lg font-semibold text-stone-900">AI receptionist</h3>
                <p className="mt-2 text-sm text-stone-600">
                  Natural conversations 24/7. Answers calls, asks the right questions, and sounds like a real team member.
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50/50 p-6">
                <div className="w-12 h-12 rounded-xl bg-stone-800 text-white flex items-center justify-center text-lg font-bold mb-4">
                  📅
                </div>
                <h3 className="text-lg font-semibold text-stone-900">Book & transfer</h3>
                <p className="mt-2 text-sm text-stone-600">
                  Books appointments and estimates. Live-transfer to your team when the caller needs a human right away.
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50/50 p-6">
                <div className="w-12 h-12 rounded-xl bg-stone-800 text-white flex items-center justify-center text-lg font-bold mb-4">
                  CRM
                </div>
                <h3 className="text-lg font-semibold text-stone-900">CRM sync</h3>
                <p className="mt-2 text-sm text-stone-600">
                  Sends every lead and booking to your CRM or Zapier. Stay in sync with DripJobs and your existing tools.
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50/50 p-6">
                <div className="w-12 h-12 rounded-xl bg-stone-800 text-white flex items-center justify-center text-lg font-bold mb-4">
                  📱
                </div>
                <h3 className="text-lg font-semibold text-stone-900">Follow-ups</h3>
                <p className="mt-2 text-sm text-stone-600">
                  Automated SMS follow-ups at 24h, 3d, 5d, and 10d so quotes don’t go cold.
                </p>
              </div>
            </div>
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
                Get set up in minutes. Your existing number or a new one—we handle the rest.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
              <div className="text-center">
                <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-stone-800 text-white text-xl font-bold">
                  1
                </span>
                <h3 className="mt-5 text-lg font-semibold text-stone-900">Connect your number</h3>
                <p className="mt-2 text-stone-600">
                  Point your Twilio number to Front Desk. No new hardware—works with your current phone system.
                </p>
              </div>
              <div className="text-center">
                <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-stone-800 text-white text-xl font-bold">
                  2
                </span>
                <h3 className="mt-5 text-lg font-semibold text-stone-900">Configure once</h3>
                <p className="mt-2 text-stone-600">
                  Set your welcome message, transfer numbers, and CRM webhook in the dashboard. The AI follows your playbook.
                </p>
              </div>
              <div className="text-center">
                <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-stone-800 text-white text-xl font-bold">
                  3
                </span>
                <h3 className="mt-5 text-lg font-semibold text-stone-900">Let it run</h3>
                <p className="mt-2 text-stone-600">
                  Every call is answered, recorded, and transcribed. Review calls and metrics anytime in the dashboard.
                </p>
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
              <button
                type="button"
                onClick={() => navigate("/login?signup=1")}
                className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 rounded-xl text-base font-semibold text-white bg-stone-800 hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-600 transition-colors"
              >
                Get started free
              </button>
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
