import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function SmsTerms() {
  useEffect(() => {
    document.title = "SMS Terms & Conditions | AI Front Desk Helper";
  }, []);

  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f5f4f0',
      fontFamily: 'Arial, sans-serif',
      padding: '40px 24px'
    }}>
      <div style={{
        maxWidth: '680px',
        margin: '0 auto',
        backgroundColor: '#fff',
        borderRadius: '16px',
        border: '1px solid #e5e5e5',
        padding: '40px 48px'
      }}>

        {/* Logo / Back */}
        <div style={{ marginBottom: '32px' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none',
              border: 'none',
              color: '#E8600A',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              padding: '0',
              marginBottom: '20px',
              display: 'block'
            }}
          >
            ← Back to AI Front Desk Helper
          </button>
          <div style={{
            width: '40px',
            height: '40px',
            backgroundColor: '#E8600A',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: '800',
            fontSize: '14px',
            marginBottom: '16px'
          }}>
            FD
          </div>
          <h1 style={{
            fontSize: '24px',
            fontWeight: '700',
            color: '#1a1a1a',
            margin: '0 0 6px 0'
          }}>
            SMS Terms & Conditions
          </h1>
          <p style={{
            fontSize: '13px',
            color: '#888',
            margin: '0'
          }}>
            AI Front Desk Helper · Effective Date: March 15, 2026
          </p>
        </div>

        {/* Consent */}
        <section style={{ marginBottom: '28px' }}>
          <h2 style={{
            fontSize: '15px',
            fontWeight: '700',
            color: '#1a1a1a',
            margin: '0 0 10px 0'
          }}>
            SMS Messaging Consent
          </h2>
          <p style={{
            fontSize: '14px',
            color: '#444',
            lineHeight: '1.7',
            margin: '0'
          }}>
            By providing your phone number and checking the consent box during 
            registration at{' '}
            <a href="https://aifrontdeskhelper.com" style={{ color: '#E8600A' }}>
              aifrontdeskhelper.com
            </a>
            , you agree to receive SMS text messages from AI Front Desk Helper 
            related to your inquiry, including appointment scheduling, follow-ups, 
            and service notifications. Message frequency may vary. Message and data 
            rates may apply. Reply STOP to opt out at any time. Reply HELP for 
            assistance. Consent is not required as a condition of purchasing any 
            goods or services.
          </p>
        </section>

        <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '0 0 28px 0' }} />

        {/* How we collect */}
        <section style={{ marginBottom: '28px' }}>
          <h2 style={{
            fontSize: '15px',
            fontWeight: '700',
            color: '#1a1a1a',
            margin: '0 0 10px 0'
          }}>
            How We Collect Consent
          </h2>
          <p style={{
            fontSize: '14px',
            color: '#444',
            lineHeight: '1.7',
            margin: '0 0 12px 0'
          }}>
            Before completing registration, a consent modal appears that cannot 
            be bypassed. The user must actively check an unchecked checkbox 
            confirming they have read and agree to these SMS messaging terms. 
            The Continue button remains disabled until consent is confirmed.
          </p>
          <p style={{
            fontSize: '14px',
            color: '#444',
            lineHeight: '1.7',
            margin: '0'
          }}>
            Users may also opt in by texting START to our number. They will 
            immediately receive a confirmation: <em>"AI Front Desk Helper: You 
            have successfully opted in to receive messages including appointment 
            updates, follow-ups, and service notifications. Message frequency 
            may vary. Message and data rates may apply. Reply STOP to opt out 
            or HELP for assistance."</em>
          </p>
        </section>

        <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '0 0 28px 0' }} />

        {/* Opt out */}
        <section style={{ marginBottom: '28px' }}>
          <h2 style={{
            fontSize: '15px',
            fontWeight: '700',
            color: '#1a1a1a',
            margin: '0 0 10px 0'
          }}>
            Opt-Out Instructions
          </h2>
          <p style={{
            fontSize: '14px',
            color: '#444',
            lineHeight: '1.7',
            margin: '0'
          }}>
            Reply <strong>STOP</strong> to any message to unsubscribe at any time. 
            You will receive a confirmation and no further messages will be sent. 
            Reply <strong>HELP</strong> for assistance. For additional support 
            contact{' '}
            <a href="mailto:drew@aifrontdeskhelper.com" style={{ color: '#E8600A' }}>
              drew@aifrontdeskhelper.com
            </a>
          </p>
        </section>

        <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '0 0 28px 0' }} />

        {/* Rates */}
        <section style={{ marginBottom: '28px' }}>
          <h2 style={{
            fontSize: '15px',
            fontWeight: '700',
            color: '#1a1a1a',
            margin: '0 0 10px 0'
          }}>
            Message & Data Rates
          </h2>
          <p style={{
            fontSize: '14px',
            color: '#444',
            lineHeight: '1.7',
            margin: '0'
          }}>
            Message and data rates may apply depending on your mobile carrier 
            and service plan. AI Front Desk Helper is not responsible for 
            carrier fees associated with SMS messaging.
          </p>
        </section>

        <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '0 0 28px 0' }} />

        {/* Privacy */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={{
            fontSize: '15px',
            fontWeight: '700',
            color: '#1a1a1a',
            margin: '0 0 10px 0'
          }}>
            Privacy Policy
          </h2>
          <p style={{
            fontSize: '14px',
            color: '#444',
            lineHeight: '1.7',
            margin: '0'
          }}>
            Your information is handled in accordance with our{' '}
            <a href="/privacy-policy" style={{ color: '#E8600A' }}>
              Privacy & Messaging Policy
            </a>
            . We do not sell, rent, or share personal data with third parties 
            for marketing purposes.
          </p>
        </section>

        {/* Contact */}
        <div style={{
          backgroundColor: '#f5f4f0',
          borderRadius: '10px',
          padding: '16px 20px',
          fontSize: '13px',
          color: '#666'
        }}>
          <strong style={{ color: '#1a1a1a' }}>Contact</strong><br />
          AI Front Desk Helper Support<br />
          Email:{' '}
          <a href="mailto:drew@aifrontdeskhelper.com" style={{ color: '#E8600A' }}>
            drew@aifrontdeskhelper.com
          </a>
          <br />
          Website:{' '}
          <a href="https://aifrontdeskhelper.com" style={{ color: '#E8600A' }}>
            aifrontdeskhelper.com
          </a>
        </div>

      </div>
    </div>
  );
}
