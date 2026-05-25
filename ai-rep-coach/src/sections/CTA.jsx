import { useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'

const STRIPE_URL = import.meta.env.VITE_STRIPE_CHECKOUT_URL || '#'

export default function CTA() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    if (!email) return
    setSent(true)
  }

  return (
    <section style={{ backgroundColor: '#facc15', paddingTop: 120, paddingBottom: 120 }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px', textAlign: 'center' }}>
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <h2
            className="font-display"
            style={{ fontSize: 'clamp(3rem, 10vw, 8rem)', lineHeight: 0.85, letterSpacing: 2, color: '#000' }}
          >
            READY TO<br />CLOSE MORE?
          </h2>
          <p style={{ marginTop: 24, fontSize: 17, fontWeight: 500, color: '#333', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
            Enter your email and we'll send you a magic link to get started.
            14-day free trial, no credit card required.
          </p>

          {sent ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: 40,
                backgroundColor: '#000', color: '#facc15', fontSize: 15, fontWeight: 600,
                padding: '16px 32px', borderRadius: 9999,
              }}
            >
              <CheckCircle2 size={20} />
              Check your email for the magic link!
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} style={{ marginTop: 40, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center',
                  backgroundColor: '#fff', borderRadius: 9999, padding: 6,
                  boxShadow: '0 8px 30px rgba(0,0,0,0.1)',
                }}
              >
                <input
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="outline-none"
                  style={{ flex: 1, minWidth: 0, backgroundColor: 'transparent', padding: '12px 20px', fontSize: 14, color: '#000' }}
                />
                <button
                  type="submit"
                  style={{
                    flexShrink: 0, backgroundColor: '#000', color: '#facc15',
                    fontSize: 13, fontWeight: 600, padding: '12px 28px', borderRadius: 9999, border: 'none', cursor: 'pointer',
                  }}
                >
                  Schedule Your Demo
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </section>
  )
}
