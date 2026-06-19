import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { Check } from 'lucide-react'

// Volume pricing — same full product at every size; price per seat drops as
// the team grows. Matches the billing brackets (REP_COACH_STRIPE_PRICE_T1..T4).
const TIERS = [
  { name: '1–2 reps', price: '$149', period: '/rep/mo', popular: false },
  { name: '3–9 reps', price: '$129', period: '/rep/mo', popular: true },
  { name: '10–24 reps', price: '$109', period: '/rep/mo', popular: false },
  { name: '25+ reps', price: '$89', period: '/rep/mo', popular: false },
]

// Every plan includes the full product — volume only changes the per-seat price.
const INCLUDED = [
  'Real-time in-ear coaching cues',
  'All 8 cue types + earbud audio',
  'DISC customer insights',
  'Post-visit AI scoring & review',
  'Apple Watch + Wear OS',
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
          <p style={{ marginTop: 20, fontSize: 16, color: '#888', maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>
            One product, volume pricing — the more reps, the lower the per-seat price.
            14-day free trial. Cancel anytime.
          </p>
        </motion.div>

        <div className="grid" style={{ marginTop: 70, gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {TIERS.map((tier, i) => (
            <motion.div
              key={tier.name}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              style={{
                borderRadius: 20,
                padding: 28,
                backgroundColor: tier.popular ? '#000' : '#f5f5f5',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {tier.popular && (
                <span style={{
                  position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
                  backgroundColor: '#facc15', color: '#000', fontSize: 11, fontWeight: 700,
                  padding: '6px 16px', borderRadius: 9999, letterSpacing: 1, whiteSpace: 'nowrap',
                }}>
                  MOST POPULAR
                </span>
              )}
              <span style={{ fontSize: 13, fontWeight: 600, color: tier.popular ? '#888' : '#999', letterSpacing: 1 }}>
                {tier.name}
              </span>
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span className="font-display" style={{ fontSize: 48, color: tier.popular ? '#fff' : '#000', lineHeight: 1 }}>
                  {tier.price}
                </span>
                <span style={{ fontSize: 13, color: '#888' }}>{tier.period}</span>
              </div>
              <div style={{ marginTop: 24, flex: 1 }}>
                {INCLUDED.map((f) => (
                  <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0' }}>
                    <Check size={15} style={{ color: tier.popular ? '#facc15' : '#000', marginTop: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: tier.popular ? '#ccc' : '#555' }}>{f}</span>
                  </div>
                ))}
              </div>
              <a
                href="#trial"
                style={{
                  display: 'block', textAlign: 'center', marginTop: 28, borderRadius: 9999,
                  padding: '13px 0', fontSize: 14, fontWeight: 600,
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
