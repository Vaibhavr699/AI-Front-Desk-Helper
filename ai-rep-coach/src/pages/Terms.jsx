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

export default function Terms() {
  return (
    <div style={{ backgroundColor: '#000', color: '#ccc', minHeight: '100vh' }}>
      <header style={{ borderBottom: '1px solid #222', padding: '20px 0' }}>
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
          Terms of Service
        </h1>
        <p style={{ color: '#666', fontSize: 14, marginTop: 12 }}>Last updated: May 29, 2026</p>

        <p style={{ color: '#aaa', fontSize: 15, lineHeight: 1.75, marginTop: 24 }}>
          These Terms of Service (&quot;Terms&quot;) govern your access to and use of the AI Rep Coach mobile
          application, websites, and related services (the &quot;Service&quot;). By creating an account or using the
          Service, you agree to these Terms. If you are using the Service on behalf of an organization, you
          represent that you are authorized to bind that organization to these Terms.
        </p>

        <Section title="The Service">
          <p>
            AI Rep Coach is a sales-coaching tool for field sales representatives. It records in-home and phone
            sales conversations, transcribes them, and provides AI-generated coaching, scoring, and feedback. We
            may update, improve, or change features of the Service over time.
          </p>
        </Section>

        <Section title="Accounts and eligibility">
          <p>
            The Service is for business use by individuals aged 18 or older. You are responsible for the accuracy of
            your account information, for keeping your credentials and two-factor authentication secure, and for all
            activity that occurs under your account. Notify us promptly of any unauthorized use.
          </p>
        </Section>

        <Section title="Subscriptions, seats, and billing">
          <p>
            Access is sold on a per-seat subscription basis and may include free trials. Fees, billing cycles, and
            seat counts are set out at purchase. Subscriptions renew automatically unless cancelled before the
            renewal date. Except where required by law, fees are non-refundable. We may change pricing on a
            going-forward basis with reasonable notice.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p style={{ marginBottom: 10 }}>You agree not to:</p>
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>Use the Service unlawfully or to record anyone without the consent required by applicable law.</li>
            <li>Share, resell, or exceed your licensed seats, or circumvent usage or security controls.</li>
            <li>Reverse engineer, scrape, or disrupt the Service or its infrastructure.</li>
            <li>Upload unlawful, infringing, or harmful content.</li>
          </ul>
        </Section>

        <Section title="Recording and consent — your responsibility">
          <p>
            You are solely responsible for complying with all laws governing the recording of conversations,
            including obtaining any consent required in one-party and two-party (all-party) consent jurisdictions.
            The Service provides consent prompts as a convenience, but it is your responsibility to ensure recordings
            are lawful. You agree to indemnify us against claims arising from recordings you make.
          </p>
        </Section>

        <Section title="Your data">
          <p>
            As between you and us, you retain ownership of the recordings, transcripts, and customer information you
            provide. You grant us a license to process this content to operate and improve the Service as described
            in our{' '}
            <Link to="/privacy" style={{ color: ACCENT, textDecoration: 'none' }}>
              Privacy Policy
            </Link>
            . We do not sell your data or use your recordings to train third-party foundation models.
          </p>
        </Section>

        <Section title="AI-generated coaching">
          <p>
            Coaching, scores, personality profiles, and other outputs are generated by automated systems and are
            provided for guidance only. They may be incomplete or inaccurate, are not professional, legal, or
            financial advice, and do not guarantee any sales outcome. You are responsible for how you act on them.
          </p>
        </Section>

        <Section title="Intellectual property">
          <p>
            The Service, including its software, design, and content (excluding your data), is owned by AI Rep Coach
            and its licensors and is protected by intellectual property laws. We grant you a limited, non-exclusive,
            non-transferable right to use the Service per these Terms. All rights not expressly granted are reserved.
          </p>
        </Section>

        <Section title="Third-party services">
          <p>
            The Service relies on third-party providers (for example, for transcription, AI analysis, storage, and
            communications). Your use may also be subject to their terms. We are not responsible for third-party
            services we do not control.
          </p>
        </Section>

        <Section title="Disclaimers">
          <p>
            The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind,
            whether express or implied, including merchantability, fitness for a particular purpose, and
            non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or secure.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the maximum extent permitted by law, AI Rep Coach will not be liable for any indirect, incidental,
            special, consequential, or punitive damages, or for lost profits or data. Our total liability for any
            claim relating to the Service will not exceed the amounts you paid us in the twelve months before the
            event giving rise to the claim.
          </p>
        </Section>

        <Section title="Indemnification">
          <p>
            You agree to indemnify and hold harmless AI Rep Coach from claims, damages, and expenses arising out of
            your use of the Service, your content, your recordings, or your breach of these Terms or applicable law.
          </p>
        </Section>

        <Section title="Termination">
          <p>
            You may stop using the Service at any time. We may suspend or terminate access if you breach these Terms
            or to protect the Service or other users. Upon termination, your right to use the Service ends; sections
            that by their nature should survive will survive.
          </p>
        </Section>

        <Section title="Changes to these Terms">
          <p>
            We may update these Terms from time to time. Material changes will be reflected by updating the
            &quot;Last updated&quot; date above and, where appropriate, through in-app notice. Continued use after
            changes take effect constitutes acceptance.
          </p>
        </Section>

        <Section title="Governing law">
          <p>
            These Terms are governed by the laws of the jurisdiction in which AI Rep Coach operates, without regard
            to conflict-of-law rules. Disputes will be resolved in the courts of that jurisdiction unless otherwise
            required by applicable law.
          </p>
        </Section>

        <Section title="Contact us">
          <p>
            Questions about these Terms? Email{' '}
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
