import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { ShimmerButton } from "./ui/shimmer-button";
import { Phone } from "lucide-react";

export function SiteHeader() {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2 group transition-all">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-stone-900 to-stone-700 text-white shadow-lg shadow-stone-200 group-hover:scale-105 transition-transform duration-200">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L14.85 8.65L22 9.25L16.5 13.9L18.1 21L12 17.25L5.9 21L7.5 13.9L2 9.25L9.15 8.65L12 2Z" fill="currentColor" />
                <path d="M12 6L13.5 10H10.5L12 6Z" fill="#fff" opacity="0.5" />
              </svg>
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
