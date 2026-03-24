import { Link } from "react-router-dom";
import { Phone } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="bg-stone-950 text-stone-400 py-16 border-t border-stone-800/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-6 group">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-stone-800 shadow-lg group-hover:scale-105 transition-transform overflow-hidden p-1">
              <img src="/favicon.png" alt="Logo" className="w-full h-full object-contain" />
            </div>
              <div className="flex flex-col">
                <span className="font-bold text-lg text-white leading-none">AI Front Desk</span>
                <span className="text-[10px] font-bold text-stone-600 uppercase tracking-widest mt-0.5">Helper</span>
              </div>
            </Link>
            <p className="text-sm leading-relaxed text-stone-500">
              The intelligent phone assistant for home service companies. Stop losing leads to voicemail and start booking more jobs.
            </p>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-6">Product</h4>
            <ul className="space-y-4 text-sm">
              <li><Link to="/#features" className="hover:text-white transition-colors">Features</Link></li>
              <li><Link to="/#how-it-works" className="hover:text-white transition-colors">How it works</Link></li>
              <li><Link to="/#pricing" className="hover:text-white transition-colors">Pricing</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-6">Platform</h4>
            <ul className="space-y-4 text-sm">
              <li><Link to="/login" className="hover:text-white transition-colors">Dashboard Login</Link></li>
              <li><Link to="/login?signup=1" className="hover:text-white transition-colors">Get Started</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-6">Legal</h4>
            <ul className="space-y-4 text-sm">
              <li><Link to="/privacy-policy" className="hover:text-white transition-colors">Privacy & Messaging Policy</Link></li>
              <li><Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
              <li><Link to="/cookies" className="hover:text-white transition-colors">Cookie Policy</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-6">Contact</h4>
            <ul className="space-y-4 text-sm">
              <li className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-stone-600" />
                <span>Support Line</span>
              </li>
              <li className="flex items-center gap-3 text-stone-500 italic">
                <span>Available 24/7 via AI</span>
              </li>
              <li>
                <a href="mailto:drew@aifrontdeskhelper.com" className="hover:text-white transition-colors">drew@aifrontdeskhelper.com</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-12 border-t border-stone-800 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-sm text-stone-600">
            © {new Date().getFullYear()} AI Front Desk Helper. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
}
