import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'

const API_URL = import.meta.env.VITE_API_URL || ''
const ACCENT = '#FACC15'

export default function SetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (loading) return
    if (!token) {
      setError('This link is missing its token. Request a new one or contact support.')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not set your password')
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ backgroundColor: '#000', color: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '24px 32px' }}>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, color: ACCENT }}>AI REP COACH</span>
        </Link>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          {done ? (
            <div style={{ textAlign: 'center' }}>
              <h1 className="font-display" style={{ fontSize: 32, color: '#fff', marginBottom: 12 }}>
                Password set!
              </h1>
              <p style={{ color: '#aaa', fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
                You can now log in with your email and new password.
              </p>
              <button onClick={() => navigate('/login')} style={buttonStyle(false)}>
                Go to login →
              </button>
            </div>
          ) : (
            <>
              <h1 className="font-display" style={{ fontSize: 32, color: '#fff', marginBottom: 8 }}>
                Set your password
              </h1>
              <p style={{ color: '#888', fontSize: 14, marginBottom: 28 }}>
                Choose a password to finish setting up your AI Rep Coach account.
              </p>

              <form onSubmit={submit}>
                <input
                  type="password" required placeholder="New password" value={password}
                  onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
                  style={inputStyle}
                />
                <input
                  type="password" required placeholder="Confirm new password" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password"
                  style={{ ...inputStyle, marginTop: 12 }}
                />
                <button type="submit" disabled={loading} style={buttonStyle(loading)}>
                  {loading ? 'Setting…' : 'Set password'}
                </button>
              </form>

              {error && <p style={{ marginTop: 14, color: '#f87171', fontSize: 13 }}>{error}</p>}
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
