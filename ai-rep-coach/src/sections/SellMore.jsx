import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

const STATS = [
  {
    type: 'image',
    img: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=700&h=900&fit=crop',
    stat: '45% Increase',
    sub: 'In Sales',
    highlight: 'with AI Rep Coach',
  },
  {
    type: 'stat',
    stat: '+28%',
    sub: 'Close Rate',
    desc: 'Average improvement in close rate within 90 days of using real-time coaching cues.',
  },
  {
    type: 'stat',
    stat: '3.2x',
    sub: 'ROI',
    desc: 'For every dollar spent on AI Rep Coach, teams see 3.2x return in closed revenue.',
  },
]

export default function SellMore() {
  const sectionRef = useRef(null)
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  })

  const coachYPct = useTransform(scrollYProgress, [0, 0.3, 0.5], ['0%', '0%', '-110%'])
  const sellYPct = useTransform(scrollYProgress, [0.3, 0.5], ['110%', '0%'])
  const headingScale = useTransform(scrollYProgress, [0, 0.3], [0.7, 1])
  const headingOpacityIn = useTransform(scrollYProgress, [0, 0.2], [0, 1])

  return (
    <section ref={sectionRef} style={{ backgroundColor: '#fff', position: 'relative', height: '250vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <motion.div
          style={{ scale: headingScale, opacity: headingOpacityIn }}
          className="text-center"
        >
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 'clamp(0.5rem, 2vw, 1.5rem)' }}>
            <div style={{ position: 'relative', overflow: 'hidden', height: 'clamp(4rem, 12vw, 11rem)', display: 'flex', alignItems: 'center' }}>
              <span
                className="font-display"
                style={{
                  fontSize: 'clamp(4rem, 12vw, 11rem)',
                  lineHeight: 1,
                  letterSpacing: 2,
                  visibility: 'hidden',
                }}
              >
                COACH
              </span>
              <motion.span
                className="font-display"
                style={{
                  y: coachYPct,
                  fontSize: 'clamp(4rem, 12vw, 11rem)',
                  lineHeight: 1,
                  letterSpacing: 2,
                  color: '#000',
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                COACH
              </motion.span>
              <motion.span
                className="font-display"
                style={{
                  y: sellYPct,
                  fontSize: 'clamp(4rem, 12vw, 11rem)',
                  lineHeight: 1,
                  letterSpacing: 2,
                  color: '#000',
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                SELL
              </motion.span>
            </div>
            <span
              className="font-display"
              style={{
                fontSize: 'clamp(4rem, 12vw, 11rem)',
                lineHeight: 1,
                letterSpacing: 2,
                color: '#000',
              }}
            >
              MORE
            </span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="grid w-full gap-5"
          style={{ maxWidth: 1200, padding: '0 24px', marginTop: 60, gridTemplateColumns: '2fr 1fr 1fr' }}
        >
          {STATS.map((item, i) => (
            <div
              key={i}
              style={{
                borderRadius: 20,
                overflow: 'hidden',
                position: 'relative',
                minHeight: 320,
                backgroundColor: item.type === 'image' ? '#111' : '#facc15',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {item.type === 'image' ? (
                <>
                  <img
                    src={item.img}
                    alt=""
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.6 }}
                    loading="lazy"
                  />
                  <div style={{ position: 'relative', zIndex: 1, padding: 32, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', flex: 1 }}>
                    <p style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
                      {item.stat}<br />{item.sub}
                    </p>
                    <p style={{ fontSize: 16, fontWeight: 600, color: '#facc15', marginTop: 4 }}>{item.highlight}</p>
                  </div>
                </>
              ) : (
                <div style={{ padding: 32, display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
                  <span className="font-display" style={{ fontSize: 64, color: '#000', lineHeight: 1 }}>{item.stat}</span>
                  <p style={{ fontSize: 18, fontWeight: 700, color: '#000', marginTop: 8 }}>{item.sub}</p>
                  <p style={{ fontSize: 14, color: '#333', marginTop: 12, lineHeight: 1.6 }}>{item.desc}</p>
                </div>
              )}
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
