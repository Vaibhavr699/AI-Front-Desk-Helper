import { Link, useLocation } from "react-router-dom";

/**
 * Navigation link with active state styling.
 * @param {string} to - Route path
 * @param {React.ReactNode} children - Link label
 * @param {function} [onClick] - Optional click handler (e.g. close mobile menu)
 */
export default function NavLink({ to, children, onClick }) {
  const location = useLocation();
  const isActive =
    location.pathname === to || (to !== "/" && location.pathname.startsWith(to));

  return (
    <Link
      to={to}
      onClick={onClick}
      className={`text-sm font-medium px-3 py-2 rounded-md ${
        isActive
          ? "bg-stone-200 text-stone-900"
          : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
      }`}
    >
      {children}
    </Link>
  );
}
