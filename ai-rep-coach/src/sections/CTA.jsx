import { useState } from 'react'
import { motion } from 'framer-motion'

const API_URL = import.meta.env.VITE_API_URL || ''
const DEMO_URL = import.meta.env.VITE_DEMO_URL || '#demo'

export default function CTA() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/rep/signup/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong')
      if (data.checkout_url) {
        window.location.href = data.checkout_url
        return
      }
      throw new Error('Could not start checkout. Please try again.')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
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
            See it on a real visit. Book a 15-minute demo and we'll show you how
            AI Rep Coach scores your team's conversations.
          </p>

          <a
            href={DEMO_URL}
            className="inline-flex items-center justify-center hover:opacity-90 transition-opacity"
            style={{
              marginTop: 36, backgroundColor: '#000', color: '#facc15',
              fontSize: 16, fontWeight: 700, padding: '16px 40px',
              borderRadius: 9999, textDecoration: 'none', gap: 8,
            }}
          >
            Schedule Your Demo
            <span style={{ fontSize: 18 }}>→</span>
          </a>

          <div style={{ marginTop: 40, paddingTop: 32, borderTop: '1px solid rgba(0,0,0,0.12)', maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 16 }}>
              Or start a 14-day free trial — card required, cancel anytime before day 14
            </p>
            <form onSubmit={handleSubmit}>
              <div
                style={{
                  display: 'flex', alignItems: 'center',
                  backgroundColor: '#fff', borderRadius: 9999, padding: 5,
                  border: '1px solid rgba(0,0,0,0.1)',
                }}
              >
                <input
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="outline-none"
                  style={{ flex: 1, minWidth: 0, backgroundColor: 'transparent', padding: '11px 18px', fontSize: 14, color: '#000' }}
                />
                <button
                  type="submit"
                  style={{
                    flexShrink: 0, backgroundColor: 'rgba(0,0,0,0.08)', color: '#000',
                    fontSize: 13, fontWeight: 600, padding: '11px 22px', borderRadius: 9999, border: 'none', cursor: 'pointer',
                  }}
                >
                  {loading ? 'Starting…' : 'Start trial'}
                </button>
              </div>
              {error && (
                <p style={{ marginTop: 12, fontSize: 13, color: '#991b1b' }}>{error}</p>
              )}
            </form>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
