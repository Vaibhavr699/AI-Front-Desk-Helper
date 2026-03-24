import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { ShimmerButton } from "./ui/shimmer-button";
import { Phone } from "lucide-react";

export function SiteHeader() {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-[500] bg-white/95 backdrop-blur border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2 group transition-all">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-stone-200 shadow-sm group-hover:scale-105 transition-transform duration-200 overflow-hidden p-1">
              <img src="/favicon.png" alt="Logo" className="w-full h-full object-contain" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-stone-900 leading-none">AI Front Desk</span>
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mt-0.5">Helper</span>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors">
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
  );
}
