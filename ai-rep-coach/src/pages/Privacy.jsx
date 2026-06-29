import { Link } from 'react-router-dom'
import Footer from '../components/Footer'

const ACCENT = '#FACC15'

function Section({ title, children }) {
  return (
    <section style={{ marginTop: 36 }}>
      <h2 className="font-display" style={{ color: '#fff', fontSize: 20, letterSpacing: 0.5, marginBottom: 12 }}>
        {title}
      </h2>
      <div style={{ color: '#aaa', fontSize: 15, lineHeight: 1.75 }}>{children}</div>
    </section>
  )
}

export default function Privacy() {
  return (
    <div style={{ backgroundColor: '#000', color: '#ccc', minHeight: '100vh' }}>
      <header
        style={{
          borderBottom: '1px solid #222',
          padding: '20px 0',
        }}
      >
        <div
          style={{
            maxWidth: 820,
            margin: '0 auto',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/AI_Rep_coach_nobg.png" alt="AI Rep Coach" style={{ height: 30, width: 'auto', display: 'block', filter: 'brightness(0) invert(1)' }} />
            <span className="font-display" style={{ fontSize: 18, letterSpacing: 2, color: '#fff' }}>
              AI REP COACH
            </span>
          </Link>
          <Link to="/" style={{ fontSize: 13, color: ACCENT, textDecoration: 'none' }}>
            ← Back to home
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: 820, margin: '0 auto', padding: '48px 24px 80px' }}>
        <h1 className="font-display" style={{ color: '#fff', fontSize: 40, lineHeight: 1.1, letterSpacing: 0.5 }}>
          Privacy Policy
        </h1>
        <p style={{ color: '#666', fontSize: 14, marginTop: 12 }}>Last updated: May 29, 2026</p>

        <p style={{ color: '#aaa', fontSize: 15, lineHeight: 1.75, marginTop: 24 }}>
          This Privacy Policy explains how AI Rep Coach (&quot;AI Rep Coach&quot;, &quot;we&quot;, &quot;us&quot;) collects, uses,
          and shares information when you use the AI Rep Coach mobile application and related services
          (the &quot;Service&quot;). The Service is a sales-coaching tool for field sales representatives that records
          in-home and phone sales conversations and provides AI-generated coaching and feedback.
        </p>

        <Section title="Who this policy is for">
          <p>
            The Service is provided to sales organizations (&quot;Customers&quot;) and used by their sales
            representatives (&quot;Reps&quot;). If you are a Rep, your employer administers your account. If you are a
            homeowner or prospect whose conversation is recorded by a Rep, the &quot;Information we collect&quot; and
            &quot;Recording and consent&quot; sections below apply to you.
          </p>
        </Section>

        <Section title="Information we collect">
          <p style={{ marginBottom: 10 }}>We collect the following categories of information:</p>
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <li>
              <strong style={{ color: '#ddd' }}>Account &amp; profile.</strong> Email address, name, phone number,
              role, and seat/subscription tier provided when an account is created or invited.
            </li>
            <li>
              <strong style={{ color: '#ddd' }}>Authentication.</strong> A password hash and a time-based one-time
              passcode (TOTP) secret used for two-factor sign-in. Face ID / fingerprint biometrics are processed
              entirely on your device by the operating system &mdash; we never receive or store your biometric data.
            </li>
            <li>
              <strong style={{ color: '#ddd' }}>Audio recordings &amp; transcripts.</strong> When a Rep starts a
              recording, we capture audio of the sales conversation through the device microphone, generate a
              written transcript, and derive coaching analysis from it.
            </li>
            <li>
              <strong style={{ color: '#ddd' }}>Customer / lead information.</strong> Details a Rep enters about a
              prospect, such as name, address, phone, email, project type, and notes.
            </li>
            <li>
              <strong style={{ color: '#ddd' }}>Coaching data.</strong> AI-generated scores, strengths and
              improvement areas, communication-style (DISC) profiles, and session history.
            </li>
            <li>
              <strong style={{ color: '#ddd' }}>Device &amp; technical data.</strong> Device type, app version, push
              notification token, IP address, and diagnostic logs.
            </li>
          </ul>
        </Section>

        <Section title="How we use information">
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>To transcribe recorded conversations and generate AI coaching, scores, and feedback.</li>
            <li>To provide, maintain, secure, and improve the Service.</li>
            <li>To authenticate users and enforce seat and subscription limits.</li>
            <li>To send operational notifications (for example, when a call has been scored).</li>
            <li>To comply with legal obligations and enforce our terms.</li>
          </ul>
          <p style={{ marginTop: 10 }}>
            We do not sell your personal information, and we do not use recordings or transcripts to train
            third-party foundation models.
          </p>
        </Section>

        <Section title="Recording and consent">
          <p>
            Recording is started manually by a Rep and is never silent or automatic. The app surfaces the consent
            requirements for the Rep&apos;s selected jurisdiction and, in two-party (all-party) consent regions,
            requires the Rep to confirm that the other participants have agreed before recording can begin. Reps and
            their organizations are responsible for obtaining any consent required by applicable law. If you are a
            conversation participant and wish to access or delete a recording, contact the recording organization or
            reach us at the address below.
          </p>
        </Section>

        <Section title="AI processing and service providers">
          <p style={{ marginBottom: 10 }}>
            We share information with trusted service providers (&quot;subprocessors&quot;) only as needed to operate
            the Service. They are bound to use the data solely to provide their services to us:
          </p>
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li><strong style={{ color: '#ddd' }}>OpenAI</strong> &mdash; speech-to-text transcription, coaching analysis, and audio cue generation.</li>
            <li><strong style={{ color: '#ddd' }}>Amazon Web Services (S3)</strong> &mdash; secure storage of audio recordings.</li>
            <li><strong style={{ color: '#ddd' }}>Twilio</strong> &mdash; in-app calling and messaging where used.</li>
            <li><strong style={{ color: '#ddd' }}>Cloud hosting &amp; database providers</strong> &mdash; application hosting and data storage.</li>
            <li><strong style={{ color: '#ddd' }}>Expo</strong> &mdash; push notification delivery.</li>
          </ul>
          <p style={{ marginTop: 10 }}>
            We may also disclose information if required by law or to protect the rights, safety, and security of our
            users and the Service.
          </p>
        </Section>

        <Section title="Data retention">
          <p>
            We retain recordings, transcripts, and coaching data for as long as the associated account is active or
            as needed to provide the Service, and thereafter as required for legal, accounting, or dispute-resolution
            purposes. A Customer organization may request deletion of its data, after which we delete or de-identify
            it within a commercially reasonable period.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Data is encrypted in transit using TLS. Recordings are stored in access-controlled cloud storage and
            account credentials are protected with hashing and two-factor authentication. No method of transmission
            or storage is completely secure, but we work to protect your information using industry-standard
            safeguards.
          </p>
        </Section>

        <Section title="Your rights and choices">
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>You may request access to, correction of, or deletion of your personal information.</li>
            <li>You can control microphone, notification, and biometric permissions in your device settings.</li>
            <li>Depending on your location, you may have additional rights under laws such as the GDPR or CCPA.</li>
          </ul>
          <p style={{ marginTop: 10 }}>
            To exercise these rights, contact us at the address below. If your account was created by an employer, we
            may direct your request to that organization, which controls the data.
          </p>
        </Section>

        <Section title="Microphone permission">
          <p>
            The app requests microphone access solely to record sales conversations when a Rep manually starts a
            recording. The microphone is not used at any other time.
          </p>
        </Section>

        <Section title="Children">
          <p>The Service is intended for business use by adults and is not directed to anyone under 18.</p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this Privacy Policy from time to time. Material changes will be reflected by updating the
            &quot;Last updated&quot; date above and, where appropriate, through in-app notice.
          </p>
        </Section>

        <Section title="Contact us">
          <p>
            Questions about this policy or your data? Email{' '}
            <a href="mailto:support@airepcoach.com" style={{ color: ACCENT, textDecoration: 'none' }}>
              support@airepcoach.com
            </a>
            .
          </p>
        </Section>
      </main>

      <Footer />
    </div>
  )
}
