export default function Footer() {
  return (
    <footer style={{ backgroundColor: '#000', borderTop: '1px solid #222', padding: '48px 0' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24 }}>
        <span className="font-display" style={{ fontSize: 18, letterSpacing: 2, color: '#fff' }}>
          AI REP COACH
        </span>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <a href="mailto:support@airepcoach.com" style={{ fontSize: 13, color: '#666', textDecoration: 'none' }}>
            support@airepcoach.com
          </a>
          <a href="#" style={{ fontSize: 13, color: '#666', textDecoration: 'none' }}>Privacy Policy</a>
          <a href="#" style={{ fontSize: 13, color: '#666', textDecoration: 'none' }}>Terms of Service</a>
        </div>
        <span style={{ fontSize: 12, color: '#444' }}>&copy; {new Date().getFullYear()} AI Rep Coach</span>
      </div>
    </footer>
  )
}
