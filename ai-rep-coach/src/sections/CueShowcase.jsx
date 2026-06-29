import { motion } from 'framer-motion'

const CUES = [
  { label: 'ASK', desc: 'Discovery question needed — stop pitching', color: 'bg-brand-600' },
  { label: 'LISTEN', desc: "They're talking — don't interrupt", color: 'bg-brand-500' },
  { label: 'CLOSE', desc: 'Time to ask for the sale', color: 'bg-brand-700' },
  { label: 'SLOW', desc: "You're talking too fast", color: 'bg-red-500' },
  { label: 'DISC', desc: 'Personality mismatch detected', color: 'bg-brand-600' },
  { label: 'RAPPORT', desc: "They're guarded — build connection", color: 'bg-brand-500' },
  { label: 'OBJECT', desc: 'Address the objection directly', color: 'bg-brand-700' },
  { label: 'CONFIRM', desc: 'Lock in the next step', color: 'bg-emerald-600' },
]

export default function CueShowcase() {
  return (
    <section className="border-t border-cream-300 bg-cream-50 py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center"
        >
          <h2 className="font-display text-4xl tracking-wide text-gray-900 md:text-6xl">
            8 COACHING CUES
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-gray-500">
            The AI reads the conversation in real-time and sends you the right nudge.
            Glance at your watch under the table — one word tells you what to do.
          </p>
        </motion.div>

        <div className="mt-14 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {CUES.map((cue, i) => (
            <motion.div
              key={cue.label}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06, duration: 0.5 }}
              className="group flex flex-col items-center gap-3 rounded-2xl border border-cream-300 bg-white p-6 shadow-sm transition-all hover:border-brand-200 hover:shadow-md hover:shadow-brand-100/50"
            >
              <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${cue.color} text-base font-black tracking-wider text-white shadow-lg`}>
                {cue.label}
              </div>
              <span className="text-center text-xs leading-relaxed text-gray-500">{cue.desc}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
