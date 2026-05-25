import { useState } from 'react'
import { Menu, X } from 'lucide-react'

const STRIPE_URL = import.meta.env.VITE_STRIPE_CHECKOUT_URL || '#pricing'

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
]

export default function Nav({ visible }) {
  const [open, setOpen] = useState(false)

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-700 ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
      }`}
      style={{ backgroundColor: '#000' }}
    >
      <div
        className="mx-auto flex items-center"
        style={{ maxWidth: 1400, height: 72, paddingLeft: 48, paddingRight: 48 }}
      >
        <a href="/" style={{ marginRight: 80 }}>
          <span className="font-display" style={{ fontSize: 22, letterSpacing: 2, color: '#fff' }}>
            AI REP COACH
          </span>
        </a>

        <div className="hidden md:flex items-center justify-center" style={{ gap: 36, flex: 1 }}>
          {NAV_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              style={{ fontSize: 15, color: '#aaa' }}
              className="hover:text-brand-700 transition-colors"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center" style={{ gap: 28 }}>
          <a href="#" style={{ fontSize: 15, color: '#aaa' }} className="hover:text-brand-700 transition-colors">
            Login
          </a>
          <a
            href={STRIPE_URL}
            className="hover:opacity-90 transition-opacity"
            style={{
              backgroundColor: '#facc15',
              color: '#000',
              fontSize: 14,
              fontWeight: 600,
              paddingLeft: 28,
              paddingRight: 28,
              paddingTop: 12,
              paddingBottom: 12,
              borderRadius: 9999,
            }}
          >
            Schedule Your Demo
          </a>
        </div>

        <button onClick={() => setOpen(!open)} className="ml-auto md:hidden" style={{ color: '#fff' }}>
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden" style={{ backgroundColor: '#000', paddingLeft: 48, paddingRight: 48, paddingBottom: 24 }}>
          {NAV_LINKS.map((l) => (
            <a key={l.label} href={l.href} onClick={() => setOpen(false)} className="block" style={{ padding: '14px 0', fontSize: 15, color: '#aaa' }}>
              {l.label}
            </a>
          ))}
          <a href="#" className="block" style={{ padding: '14px 0', fontSize: 15, color: '#aaa' }}>Login</a>
          <a
            href={STRIPE_URL}
            className="block text-center"
            style={{
              marginTop: 12,
              backgroundColor: '#facc15',
              color: '#000',
              fontSize: 14,
              fontWeight: 600,
              padding: '12px 0',
              borderRadius: 9999,
            }}
          >
            Schedule Your Demo
          </a>
        </div>
      )}
    </nav>
  )
}
