import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { Mic, Brain, Smartphone } from 'lucide-react'

const STEPS = [
  {
    num: '01',
    icon: Mic,
    title: 'Record',
    desc: 'Your phone mic picks up the conversation. No earbuds, no extra hardware — just your phone on the table.',
    img: 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=500&h=600&fit=crop',
  },
  {
    num: '02',
    icon: Brain,
    title: 'AI Analyzes',
    desc: 'GPT-4o reads the transcript in 12-second windows and decides if you need a coaching nudge right now.',
    img: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=500&h=600&fit=crop',
  },
  {
    num: '03',
    icon: Smartphone,
    title: 'Get Coached',
    desc: 'A subtle cue pops on your phone and watch — ASK, LISTEN, CLOSE. Glance and go.',
    img: 'https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=500&h=600&fit=crop',
  },
]

export default function HowItWorks() {
  const sectionRef = useRef(null)
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'start start'],
  })

  const headingY = useTransform(scrollYProgress, [0, 1], [200, 0])
  const headingScale = useTransform(scrollYProgress, [0, 0.6, 1], [0.6, 1, 1])
  const headingOpacity = useTransform(scrollYProgress, [0, 0.4], [0, 1])

  return (
    <section id="how-it-works" ref={sectionRef} style={{ backgroundColor: '#fff', paddingTop: 100, paddingBottom: 100 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
        <motion.div
          style={{ y: headingY, scale: headingScale, opacity: headingOpacity }}
          className="text-center"
        >
          <h2
            className="font-display"
            style={{ fontSize: 'clamp(4rem, 12vw, 11rem)', lineHeight: 0.85, letterSpacing: 2, color: '#000' }}
          >
            HOW IT WORKS
          </h2>
          <div className="flex justify-center" style={{ marginTop: 24 }}>
            <span
              style={{
                display: 'inline-block',
                backgroundColor: '#facc15',
                color: '#000',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 2,
                padding: '8px 20px',
              }}
            >
              3 SIMPLE STEPS
            </span>
          </div>
        </motion.div>

        <div
          className="grid gap-6"
          style={{ marginTop: 80, gridTemplateColumns: 'repeat(3, 1fr)' }}
        >
          {STEPS.map((step, i) => (
            <motion.div
              key={step.num}
              initial={{ opacity: 0, y: 80 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ delay: i * 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              style={{
                backgroundColor: '#facc15',
                borderRadius: 20,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ padding: '28px 28px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ fontSize: 22, fontWeight: 700, color: '#000' }}>{step.title}</h3>
                  <p style={{ fontSize: 14, color: '#333', lineHeight: 1.6, marginTop: 8, maxWidth: 280 }}>{step.desc}</p>
                </div>
                <span className="font-display" style={{ fontSize: 28, color: 'rgba(0,0,0,0.15)' }}>{step.num}</span>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '24px 28px 0' }}>
                <img
                  src={step.img}
                  alt={step.title}
                  style={{ width: '80%', height: 280, objectFit: 'cover', borderRadius: '12px 12px 0 0' }}
                  loading="lazy"
                />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
