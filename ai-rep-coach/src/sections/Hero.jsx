import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

const DEMO_URL = import.meta.env.VITE_DEMO_URL || '#demo'
const TRIAL_URL = import.meta.env.VITE_TRIAL_URL || '#trial'

const PHOTOS = [
  'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=500&h=350&fit=crop',
  'https://images.unsplash.com/photo-1556740758-90de374c12ad?w=500&h=350&fit=crop',
  'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=500&h=350&fit=crop',
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=500&h=350&fit=crop',
  'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=500&h=350&fit=crop',
  'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=500&h=350&fit=crop',
]

const ease = [0.22, 1, 0.36, 1]

export default function Hero({ onIntroComplete }) {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1400),
      setTimeout(() => setPhase(3), 2200),
      setTimeout(() => setPhase(4), 3000),
      setTimeout(() => { setPhase(5); onIntroComplete?.() }, 3600),
    ]
    return () => timers.forEach(clearTimeout)
  }, [onIntroComplete])

  return (
    <section
      className="relative flex flex-col items-center justify-center overflow-hidden"
      style={{ backgroundColor: '#000', minHeight: '100vh', paddingTop: 72 }}
    >
      <div className="relative z-10 flex w-full flex-col items-center">
        <motion.div
          initial={{ y: 150, opacity: 0, filter: 'blur(12px)' }}
          animate={phase >= 1 ? { y: 0, opacity: 1, filter: 'blur(0px)' } : {}}
          transition={{ duration: 1, ease }}
          className="text-center"
        >
          <h1
            className="font-display"
            style={{ fontSize: 'clamp(1rem, 10vw, 9.5rem)', lineHeight: 1, letterSpacing: 4, color: '#facc15', fontWeight: 100, WebkitTextStroke: '1px #facc15', WebkitTextFillColor: 'transparent' }}
          >
            AI COACHING FOR
          </h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : {}}
          transition={{ duration: 0.8 }}
          className="w-full overflow-hidden"
          style={{ marginTop: 16, marginBottom: 16 }}
        >
          <div
            className="flex hover:[animation-play-state:paused]"
            style={{ width: 'max-content', gap: 20, animation: 'scroll 30s linear infinite' }}
          >
            {[...PHOTOS, ...PHOTOS].map((src, i) => (
              <div
                key={i}
                className="shrink-0 overflow-hidden"
                style={{ height: 220, width: 320, borderRadius: 16 }}
              >
                <img src={src} alt="" className="h-full w-full object-cover" loading="eager" />
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ y: 150, opacity: 0, filter: 'blur(12px)' }}
          animate={phase >= 3 ? { y: 0, opacity: 1, filter: 'blur(0px)' } : {}}
          transition={{ duration: 1, ease }}
          className="text-center"
        >
          <h1
            className="font-display"
            style={{ fontSize: 'clamp(3.5rem, 10vw, 9.5rem)', lineHeight: 1, letterSpacing: 4, color: '#facc15', fontWeight: 400 }}
          >
            IN-HOME SALES
          </h1>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 4 ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease }}
          className="text-center"
          style={{ marginTop: 36, fontSize: 17, fontWeight: 500, lineHeight: 1.6, color: '#e5e5e5', maxWidth: 480, padding: '0 24px' }}
        >
          Record in-home salespeople<br />
          and coach them 100x faster with AI Rep Coach.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 5 ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease }}
          className="flex flex-col items-center"
          style={{ marginTop: 32, width: '100%', maxWidth: 460, padding: '0 24px', gap: 16 }}
        >
          <a
            href={DEMO_URL}
            className="flex items-center justify-center"
            style={{
              width: '100%',
              backgroundColor: '#facc15',
              color: '#000',
              fontSize: 16,
              fontWeight: 700,
              padding: '16px 24px',
              borderRadius: 9999,
              textDecoration: 'none',
              gap: 8,
            }}
          >
            Schedule Your Demo
            <span style={{ fontSize: 18 }}>→</span>
          </a>
          <a
            href={TRIAL_URL}
            style={{
              color: 'rgba(255,255,255,0.55)',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            or start a 14-day free trial
          </a>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={phase >= 5 ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="text-center"
          style={{ marginTop: 40, fontSize: 13, color: '#555', padding: '0 24px' }}
        >
          Trusted by leading sales teams in home improvement, HVAC, roofing, and more.
        </motion.p>
      </div>
    </section>
  )
}
