import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { Check } from 'lucide-react'

const CHECKOUT_URLS = {
  Standard: import.meta.env.VITE_STRIPE_CHECKOUT_URL_STANDARD || import.meta.env.VITE_STRIPE_CHECKOUT_URL || '#',
  Pro: import.meta.env.VITE_STRIPE_CHECKOUT_URL_PRO || '#',
  Elite: import.meta.env.VITE_STRIPE_CHECKOUT_URL_ELITE || '#',
}

const TIERS = [
  {
    name: 'Standard',
    price: '$119',
    period: '/rep/mo',
    features: ['Phone pop-up cues', 'Tablet sidebar coaching', 'All 8 cue types', 'Post-call cue review', 'Cue type toggles'],
    popular: false,
  },
  {
    name: 'Pro',
    price: '$199',
    period: '/rep/mo',
    features: ['Everything in Standard', 'Earbud audio coaching', 'Priority AI analysis', 'Custom cue rules', 'Team analytics dashboard'],
    popular: true,
  },
  {
    name: 'Elite',
    price: '$249',
    period: '/rep/mo',
    features: ['Everything in Pro', 'Apple Watch + Wear OS', 'DISC personality coaching', 'White-label branding', 'Dedicated support'],
    popular: false,
  },
]

export default function Pricing() {
  const sectionRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start end', 'start start'] })
  const headingY = useTransform(scrollYProgress, [0, 1], [150, 0])
  const headingOpacity = useTransform(scrollYProgress, [0, 0.5], [0, 1])

  return (
    <section id="pricing" ref={sectionRef} style={{ backgroundColor: '#fff', paddingTop: 120, paddingBottom: 120 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
        <motion.div style={{ y: headingY, opacity: headingOpacity }} className="text-center">
          <h2
            className="font-display"
            style={{ fontSize: 'clamp(3rem, 10vw, 9rem)', lineHeight: 0.85, letterSpacing: 2, color: '#000' }}
          >
            PRICING
          </h2>
          <p style={{ marginTop: 20, fontSize: 16, color: '#888', maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
            Per-rep, per-month. 14-day free trial. Cancel anytime.
          </p>
        </motion.div>

        <div className="grid" style={{ marginTop: 70, gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {TIERS.map((tier, i) => (
            <motion.div
              key={tier.name}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              style={{
                borderRadius: 20,
                padding: 36,
                backgroundColor: tier.popular ? '#000' : '#f5f5f5',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {tier.popular && (
                <span style={{
                  position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
                  backgroundColor: '#facc15', color: '#000', fontSize: 12, fontWeight: 700,
                  padding: '6px 18px', borderRadius: 9999, letterSpacing: 1,
                }}>
                  MOST POPULAR
                </span>
              )}
              <span style={{ fontSize: 13, fontWeight: 600, color: tier.popular ? '#888' : '#999', letterSpacing: 1 }}>
                {tier.name.toUpperCase()}
              </span>
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span className="font-display" style={{ fontSize: 56, color: tier.popular ? '#fff' : '#000', lineHeight: 1 }}>
                  {tier.price}
                </span>
                <span style={{ fontSize: 14, color: '#888' }}>{tier.period}</span>
              </div>
              <div style={{ marginTop: 32, flex: 1 }}>
                {tier.features.map((f) => (
                  <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0' }}>
                    <Check size={16} style={{ color: tier.popular ? '#facc15' : '#000', marginTop: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 14, color: tier.popular ? '#ccc' : '#555' }}>{f}</span>
                  </div>
                ))}
              </div>
              <a
                href={/^https?:\/\//.test(CHECKOUT_URLS[tier.name]) ? CHECKOUT_URLS[tier.name] : '#'}
                style={{
                  display: 'block', textAlign: 'center', marginTop: 32, borderRadius: 9999,
                  padding: '14px 0', fontSize: 14, fontWeight: 600,
                  backgroundColor: tier.popular ? '#facc15' : '#000',
                  color: tier.popular ? '#000' : '#fff',
                }}
              >
                Start free trial
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
