import { Link } from 'react-router-dom'
import BrandHeader from '../components/BrandHeader'

const ACCENT = '#FACC15'

export default function SignupSuccess() {
  return (
    <div style={{ backgroundColor: '#000', color: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <BrandHeader />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
        <div style={{ width: '100%', maxWidth: 460, textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', background: ACCENT,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 28px', fontSize: 32,
          }}>
            ✓
          </div>

          <h1 className="font-display" style={{ fontSize: 38, color: '#fff', lineHeight: 1.1, marginBottom: 16 }}>
            You're in! Your trial has started.
          </h1>

          <p style={{ color: '#aaa', fontSize: 16, lineHeight: 1.7, marginBottom: 28 }}>
            Your 14-day free trial is active — you won't be charged until it ends.
            We've emailed you a secure link to set your password.
          </p>

          <div style={{ background: '#111', borderRadius: 14, padding: 24, textAlign: 'left', marginBottom: 28 }}>
            <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: '#888', marginBottom: 14 }}>NEXT STEPS</p>
            <ol style={{ color: '#ccc', fontSize: 15, lineHeight: 1.9, paddingLeft: 20, margin: 0 }}>
              <li>Check your inbox for the welcome email</li>
              <li>Click <strong style={{ color: '#fff' }}>"Set your password"</strong> (link expires in 24 hours)</li>
              <li>Log in and start coaching</li>
            </ol>
          </div>

          <p style={{ color: '#666', fontSize: 13, lineHeight: 1.6 }}>
            Didn't get the email? Check spam, or reach us at{' '}
            <a href="mailto:support@airepcoach.com" style={{ color: ACCENT, textDecoration: 'none' }}>
              support@airepcoach.com
            </a>.
          </p>

          <Link
            to="/login"
            style={{
              display: 'inline-block', marginTop: 28, background: ACCENT, color: '#000',
              fontSize: 15, fontWeight: 700, padding: '13px 36px', borderRadius: 9999, textDecoration: 'none',
            }}
          >
            Go to login →
          </Link>
        </div>
      </div>
    </div>
  )
}
