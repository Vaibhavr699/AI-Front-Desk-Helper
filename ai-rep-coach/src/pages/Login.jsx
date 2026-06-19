import { useState } from 'react'
import { Link } from 'react-router-dom'

const API_URL = import.meta.env.VITE_API_URL || ''
const ACCENT = '#FACC15'

export default function Login() {
  const [step, setStep] = useState('credentials') // 'credentials' | 'otp' | 'done'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [challengeToken, setChallengeToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submitCredentials(e) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/rep/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login failed')
      if (data.challenge_token) {
        setChallengeToken(data.challenge_token)
        setStep('otp')
      } else {
        setStep('done')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function submitOtp(e) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/rep/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_token: challengeToken, code: code.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Invalid code')
      setStep('done')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function resend() {
    setError('')
    try {
      await fetch(`${API_URL}/api/rep/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_token: challengeToken }),
      })
    } catch {
      setError('Could not resend code.')
    }
  }

  return (
    <div style={{ backgroundColor: '#000', color: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '24px 32px' }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, color: ACCENT }}>AI REP COACH</span>
        </Link>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          {step === 'done' ? (
            <div style={{ textAlign: 'center' }}>
              <h1 className="font-display" style={{ fontSize: 32, color: '#fff', marginBottom: 12 }}>You're in</h1>
              <p style={{ color: '#aaa', fontSize: 15, lineHeight: 1.6 }}>
                Open the AI Rep Coach app on your phone or tablet to start coaching.
                Use the same email and password to sign in.
              </p>
              <p style={{ marginTop: 24, padding: '14px 16px', background: '#1a1a1a', borderRadius: 10, color: '#888', fontSize: 13 }}>
                📱 App download coming soon — we'll email your install link.
              </p>
            </div>
          ) : (
            <>
              <h1 className="font-display" style={{ fontSize: 32, color: '#fff', marginBottom: 8 }}>
                {step === 'otp' ? 'Check your email' : 'Log in'}
              </h1>
              <p style={{ color: '#888', fontSize: 14, marginBottom: 28 }}>
                {step === 'otp'
                  ? `We sent a 6-digit code to ${email}.`
                  : 'Sign in to your AI Rep Coach account.'}
              </p>

              {step === 'credentials' ? (
                <form onSubmit={submitCredentials}>
                  <input
                    type="email" required placeholder="you@company.com" value={email}
                    onChange={(e) => setEmail(e.target.value)} autoComplete="email"
                    style={inputStyle}
                  />
                  <input
                    type="password" required placeholder="Password" value={password}
                    onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                    style={{ ...inputStyle, marginTop: 12 }}
                  />
                  <button type="submit" disabled={loading} style={buttonStyle(loading)}>
                    {loading ? 'Signing in…' : 'Continue'}
                  </button>
                </form>
              ) : (
                <form onSubmit={submitOtp}>
                  <input
                    type="text" required placeholder="6-digit code" value={code} inputMode="numeric"
                    onChange={(e) => setCode(e.target.value)} maxLength={6} autoFocus
                    style={{ ...inputStyle, letterSpacing: 6, textAlign: 'center', fontSize: 20 }}
                  />
                  <button type="submit" disabled={loading} style={buttonStyle(loading)}>
                    {loading ? 'Verifying…' : 'Verify & sign in'}
                  </button>
                  <button type="button" onClick={resend} style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, marginTop: 14, cursor: 'pointer', width: '100%' }}>
                    Didn't get it? Resend code
                  </button>
                </form>
              )}

              {error && <p style={{ marginTop: 14, color: '#f87171', fontSize: 13 }}>{error}</p>}

              <p style={{ marginTop: 28, fontSize: 13, color: '#666', textAlign: 'center' }}>
                Don't have an account? <Link to="/#trial" style={{ color: ACCENT, textDecoration: 'none' }}>Start a free trial</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '14px 16px', fontSize: 15,
  background: '#fff', color: '#000', border: 'none', borderRadius: 10, outline: 'none',
}

function buttonStyle(loading) {
  return {
    width: '100%', marginTop: 16, padding: '14px 0', fontSize: 15, fontWeight: 700,
    background: ACCENT, color: '#000', border: 'none', borderRadius: 9999,
    cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
  }
}
