import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

const FEATURES = [
  {
    title: 'DISC Personality Detection',
    desc: 'AI detects whether the customer is a D, I, S, or C — and tells you when your communication style mismatches theirs.',
    img: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=600&h=400&fit=crop',
  },
  {
    title: 'Objection Handling',
    desc: "When the customer raises a concern and you deflect, you'll get a nudge: address it head-on.",
    img: 'https://images.unsplash.com/photo-1556745757-8d76bdb6984b?w=600&h=400&fit=crop',
  },
  {
    title: 'Post-Call Cue Review',
    desc: 'Every cue is saved with the exact transcript that triggered it. Managers see what fired and whether the rep acted.',
    img: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&h=400&fit=crop',
  },
  {
    title: 'WPM Monitoring',
    desc: 'The AI tracks speaking pace in real-time. Hit 180+ words per minute and it tells you to slow down.',
    img: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&h=400&fit=crop',
  },
  {
    title: 'Per-Rep Cue Toggles',
    desc: 'Reps choose which cue types fire. Disable rapport cues for repeat customers. Your rules, your flow.',
    img: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=600&h=400&fit=crop',
  },
  {
    title: 'Team Analytics',
    desc: 'See which reps get the most "missing close" cues. Track trends over 30 days. Compare across the team.',
    img: 'https://images.unsplash.com/photo-1551434678-e076c223a692?w=600&h=400&fit=crop',
  },
]

export default function Features() {
  const sectionRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start end', 'start start'] })
  const headingY = useTransform(scrollYProgress, [0, 1], [150, 0])
  const headingOpacity = useTransform(scrollYProgress, [0, 0.5], [0, 1])

  return (
    <section id="features" ref={sectionRef} style={{ backgroundColor: '#000', paddingTop: 120, paddingBottom: 120 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
        <motion.div style={{ y: headingY, opacity: headingOpacity }} className="text-center">
          <h2
            className="font-display"
            style={{ fontSize: 'clamp(3rem, 10vw, 9rem)', lineHeight: 0.85, letterSpacing: 2, color: '#facc15' }}
          >
            FEATURES
          </h2>
          <p style={{ marginTop: 20, fontSize: 16, color: '#888', maxWidth: 500, marginLeft: 'auto', marginRight: 'auto' }}>
            Everything your team needs to close more — built into one app.
          </p>
        </motion.div>

        <div
          className="grid"
          style={{ marginTop: 80, gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}
        >
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              style={{
                borderRadius: 20,
                overflow: 'hidden',
                backgroundColor: '#111',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ height: 220, overflow: 'hidden', position: 'relative' }}>
                <img src={f.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7 }} loading="lazy" />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #111, transparent 60%)' }} />
              </div>
              <div style={{ padding: '24px 28px 28px' }}>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{f.title}</h3>
                <p style={{ fontSize: 14, color: '#999', lineHeight: 1.7, marginTop: 8 }}>{f.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
