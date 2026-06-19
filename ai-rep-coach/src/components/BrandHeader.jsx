import { Link } from 'react-router-dom'

export default function BrandHeader() {
  return (
    <header style={{ padding: '20px 32px' }}>
      <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
        <img
          src="/AI_Rep_coach_nobg.png"
          alt="AI Rep Coach"
          style={{ height: 36, width: 'auto', display: 'block', filter: 'brightness(0) invert(1)' }}
        />
        <span className="font-display" style={{ fontSize: 20, letterSpacing: 2, color: '#fff' }}>
          AI REP COACH
        </span>
      </Link>
    </header>
  )
}
