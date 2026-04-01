import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";

export default function TermsOfService() {
  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
      <SiteHeader />
      <main className="flex-1">
        <article className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <header className="mb-12">
            <h1 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 tracking-tight">
              AIFrontDeskHelper Terms of Service
            </h1>
            <p className="mt-3 text-stone-500 text-sm">Effective Date: March 30, 2026</p>
            <p className="mt-4 text-stone-600 text-sm leading-relaxed">
              Welcome to AIFrontDeskHelper. These Terms of Service ("Terms") govern your access
              to and use of the AIFrontDeskHelper platform, website, and services. By accessing
              or using our services, you agree to comply with these Terms. If you do not agree
              with these Terms, you may not access or use the services.
            </p>
          </header>

          <div className="font-sans text-stone-700 leading-relaxed space-y-10">

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                1. Overview of Services
              </h2>
              <p className="mb-4">
                AIFrontDeskHelper provides AI-powered communication and automation tools that
                help businesses respond to customer inquiries across multiple communication
                channels.
              </p>
              <p className="mb-4">Services may include:</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>AI website chat automation</li>
                <li>SMS messaging responses</li>
                <li>Automated call responses or missed-call follow-ups</li>
                <li>Facebook or messaging platform automation</li>
                <li>Lead capture and customer communication tools</li>
                <li>Appointment scheduling assistance</li>
                <li>Automated follow-up messaging</li>
              </ul>
              <p>
                The platform is designed to help businesses improve response times and
                communication with their customers.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                2. Eligibility
              </h2>
              <p className="mb-4">
                By using AIFrontDeskHelper services, you represent that:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>You are at least 18 years old</li>
                <li>You have the authority to enter into this agreement</li>
                <li>You will use the platform in compliance with applicable laws and regulations</li>
              </ul>
              <p>
                Businesses using the platform are responsible for ensuring that their use of
                AIFrontDeskHelper complies with all local, state, national, and international
                laws.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                3. Acceptable Use
              </h2>
              <p className="mb-4">
                Users of AIFrontDeskHelper agree not to use the platform for:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Sending spam or unsolicited marketing messages</li>
                <li>Harassment, abusive, or misleading communications</li>
                <li>Fraudulent activity</li>
                <li>Illegal services or prohibited products</li>
                <li>Unauthorized data collection</li>
                <li>Violating telecommunications or messaging regulations</li>
              </ul>
              <p>
                AIFrontDeskHelper reserves the right to suspend or terminate accounts that
                violate these guidelines.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                4. Messaging Compliance
              </h2>
              <p className="mb-4">
                Businesses using AIFrontDeskHelper to send SMS messages must comply with all
                messaging laws and regulations, including applicable telecommunications and
                consumer protection rules.
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Businesses must ensure they have obtained proper consent before sending text messages to customers.</li>
                <li>Recipients of SMS messages must be able to opt out at any time by replying: <strong>STOP</strong></li>
                <li>Users may request assistance by replying: <strong>HELP</strong></li>
                <li>Message frequency may vary depending on the interaction between the customer and the business.</li>
                <li>Message and data rates may apply depending on the recipient's mobile carrier.</li>
              </ul>

              <h3 className="font-serif text-lg font-semibold text-stone-800 mt-8 mb-3">
                4A. Outbound Calling — Business Responsibility and TCPA Compliance
              </h3>
              <p className="mb-4">
                Businesses using the AIFrontDeskHelper outbound calling feature are solely
                responsible for ensuring that all contacts on uploaded call lists have provided
                appropriate prior express written consent to be contacted by phone, automated
                system, or AI-powered voice technology as required by the Telephone Consumer
                Protection Act (TCPA) and all applicable federal, state, and local telemarketing
                laws and regulations.
              </p>
              <p className="mb-4">
                By uploading a contact list and initiating outbound calling campaigns through
                the platform, the business account holder represents and warrants that:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>All contacts on the uploaded list have provided prior express written consent to receive calls from the business</li>
                <li>The business has maintained records of consent that can be produced upon request</li>
                <li>All contacts have been scrubbed against the National Do Not Call Registry where required</li>
                <li>The business will honor all opt-out requests immediately and permanently</li>
                <li>All outbound calling activity complies with applicable calling hour restrictions</li>
              </ul>
              <p className="mb-4">
                AIFrontDeskHelper provides outbound calling as a technology platform only.
                AIFrontDeskHelper assumes no liability whatsoever for outbound communications
                made to contacts without proper consent, TCPA violations, Do Not Call
                violations, or any other regulatory violation arising from the business account
                holder's use of the outbound calling feature.
              </p>
              <p>
                Violation of TCPA or applicable telemarketing laws is the exclusive legal and
                financial responsibility of the business account holder. The business account
                holder agrees to indemnify, defend, and hold harmless AIFrontDeskHelper from
                any claims, penalties, fines, or legal costs arising from the business's
                outbound calling activity on the platform. AIFrontDeskHelper reserves the right
                to immediately suspend or terminate outbound calling access for any account
                suspected of TCPA violations or prohibited calling practices without prior
                notice.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                5. Customer Communications
              </h2>
              <p>
                AIFrontDeskHelper uses artificial intelligence to assist in responding to
                customer inquiries. While the platform strives to provide helpful responses,
                AI-generated replies may not always fully address complex or unique situations.
                Businesses remain responsible for ensuring the accuracy of information provided
                to customers.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                6. Account Responsibilities
              </h2>
              <p className="mb-4">
                Users are responsible for maintaining the security of their accounts and login
                credentials.
              </p>
              <p className="mb-4">You agree not to:</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Share your login credentials with unauthorized individuals</li>
                <li>Attempt to gain unauthorized access to the platform</li>
                <li>Interfere with system security or operation</li>
              </ul>
              <p>
                AIFrontDeskHelper is not responsible for losses resulting from unauthorized
                account access caused by user negligence.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                7. Data &amp; Privacy
              </h2>
              <p>
                Use of the platform is also governed by the AIFrontDeskHelper{" "}
                <a href="/privacy-policy" className="text-stone-900 underline hover:no-underline font-medium">
                  Privacy &amp; Messaging Policy
                </a>
                , which explains how data is collected, used, and protected. By using the
                platform, you acknowledge and agree to the practices described in the Privacy
                Policy.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                8. Service Availability
              </h2>
              <p className="mb-4">
                AIFrontDeskHelper strives to provide reliable service but does not guarantee
                uninterrupted availability.
              </p>
              <p className="mb-4">Service interruptions may occur due to:</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Maintenance or updates</li>
                <li>Third-party service disruptions</li>
                <li>Network outages</li>
                <li>System improvements</li>
              </ul>
              <p>AIFrontDeskHelper is not liable for temporary service interruptions.</p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                9. Third-Party Services
              </h2>
              <p>
                AIFrontDeskHelper may integrate with third-party platforms including messaging
                providers, hosting services, or communication tools. Use of these services may
                be subject to the terms and policies of those third parties. AIFrontDeskHelper
                is not responsible for the policies or actions of third-party service providers.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                10. Intellectual Property
              </h2>
              <p className="mb-4">
                All software, technology, branding, and platform content associated with
                AIFrontDeskHelper are the intellectual property of AIFrontDeskHelper.
              </p>
              <p className="mb-4">Users may not:</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Copy or distribute platform software</li>
                <li>Reverse engineer the platform</li>
                <li>Reproduce platform features without authorization</li>
              </ul>
              <p>Businesses retain ownership of their own customer data.</p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                11. Limitation of Liability
              </h2>
              <p className="mb-4">
                AIFrontDeskHelper provides services on an "as-is" and "as-available" basis.
              </p>
              <p className="mb-4">
                To the fullest extent permitted by law, AIFrontDeskHelper shall not be liable
                for:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Indirect or incidental damages</li>
                <li>Lost profits or lost business opportunities</li>
                <li>Communication errors caused by external services</li>
                <li>Carrier or messaging delivery issues</li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                12. Account Suspension or Termination
              </h2>
              <p className="mb-4">
                AIFrontDeskHelper reserves the right to suspend or terminate accounts that:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Violate these Terms</li>
                <li>Engage in prohibited messaging practices</li>
                <li>Use the platform for unlawful purposes</li>
              </ul>
              <p>
                Accounts may also be suspended to protect system security or comply with legal
                obligations.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                13. Modifications to the Terms
              </h2>
              <p>
                AIFrontDeskHelper may update these Terms from time to time to reflect changes
                in technology, law, or service functionality. Updated terms will be posted on
                this page with the revised effective date. Continued use of the platform
                constitutes acceptance of the updated Terms.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                14. Governing Law
              </h2>
              <p>
                These Terms of Service shall be governed by and construed in accordance with
                the laws of the State of Nebraska, without regard to its conflict of law
                principles. Any legal action or proceeding arising out of or relating to these
                Terms shall be brought exclusively in the state or federal courts located in
                Nebraska, and both parties consent to personal jurisdiction in such courts.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                15. Contact Information
              </h2>
              <p className="mb-4">
                If you have questions regarding these Terms of Service, please contact:
              </p>
              <p className="mb-1"><strong>AIFrontDeskHelper Support</strong></p>
              <p className="mb-1">
                Email:{" "}
                <a
                  href="mailto:drew@aifrontdeskhelper.com"
                  className="text-stone-900 underline hover:no-underline"
                >
                  drew@aifrontdeskhelper.com
                </a>
              </p>
              <p>
                Website:{" "}
                <a
                  href="https://www.aifrontdeskhelper.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-stone-900 underline hover:no-underline"
                >
                  www.aifrontdeskhelper.com
                </a>
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                16. Refund Policy
              </h2>

              <h3 className="font-serif text-lg font-semibold text-stone-800 mt-4 mb-3">
                Setup Fees
              </h3>
              <p className="mb-4">
                All setup fees are non-refundable. Setup fees cover the cost of account
                configuration, onboarding, system integration, and initial platform setup. By
                paying the setup fee and proceeding with onboarding the customer acknowledges
                that setup services have been rendered and no refund will be issued.
              </p>

              <h3 className="font-serif text-lg font-semibold text-stone-800 mt-4 mb-3">
                Monthly Subscription Fees
              </h3>
              <p className="mb-4">
                Monthly subscription fees are non-refundable once a billing cycle has begun.
                If a customer cancels their subscription mid-cycle the account will remain
                active until the end of the current billing period. No partial month refunds
                will be issued.
              </p>

              <h3 className="font-serif text-lg font-semibold text-stone-800 mt-4 mb-3">
                Minute and SMS Bundle Purchases
              </h3>
              <p className="mb-4">
                Purchased minute and SMS bundles are non-refundable. Unused bundle minutes
                roll over for 90 days from the date of purchase. After 90 days unused bundle
                minutes expire with no refund or credit issued.
              </p>

              <h3 className="font-serif text-lg font-semibold text-stone-800 mt-4 mb-3">
                Exceptions
              </h3>
              <p className="mb-4">
                AIFrontDeskHelper may at its sole discretion issue credits or partial refunds
                in cases of documented platform failure or service outage that prevents normal
                platform use for more than 72 consecutive hours. Refund requests must be
                submitted in writing to{" "}
                <a
                  href="mailto:drew@aifrontdeskhelper.com"
                  className="text-stone-900 underline hover:no-underline"
                >
                  drew@aifrontdeskhelper.com
                </a>{" "}
                within 14 days of the billing date in question. AIFrontDeskHelper is not
                obligated to issue refunds for customer dissatisfaction, underutilization of
                the platform, or business decisions made by the account holder.
              </p>

              <h3 className="font-serif text-lg font-semibold text-stone-800 mt-4 mb-3">
                Chargebacks
              </h3>
              <p>
                Customers who initiate a chargeback or payment dispute without first contacting
                AIFrontDeskHelper support will have their account immediately suspended pending
                resolution. AIFrontDeskHelper reserves the right to recover chargeback fees
                and associated costs from the account holder.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                17. Dispute Resolution and Arbitration
              </h2>

              <h3 className="font-serif text-lg font-semibold text-stone-800 mt-4 mb-3">
                Informal Resolution First
              </h3>
              <p className="mb-4">
                Before initiating any formal dispute process, both parties agree to attempt to
                resolve any dispute informally by contacting AIFrontDeskHelper support at{" "}
                <a
                  href="mailto:drew@aifrontdeskhelper.com"
                  className="text-stone-900 underline hover:no-underline"
                >
                  drew@aifrontdeskhelper.com
                </a>
                . Both parties agree to make a good faith effort to resolve the dispute within
                30 days of written notice.
              </p>

              <h3 className="font-serif text-lg font-semibold text-stone-800 mt-4 mb-3">
                Binding Arbitration
              </h3>
              <p className="mb-4">
                If informal resolution fails, any dispute, claim, or controversy arising out
                of or relating to these Terms or the use of AIFrontDeskHelper services shall
                be resolved by binding arbitration rather than in court, except that either
                party may bring claims in small claims court if the claim qualifies.
              </p>

              <h3 className="font-serif text-lg font-semibold text-stone-800 mt-4 mb-3">
                Arbitration Rules
              </h3>
              <p className="mb-4">
                Arbitration shall be conducted by a single arbitrator under the rules of the
                American Arbitration Association. The arbitration shall take place in Nebraska
                or by remote hearing. The arbitrator's decision shall be final and binding and
                may be entered as a judgment in any court of competent jurisdiction.
              </p>

              <h3 className="font-serif text-lg font-semibold text-stone-800 mt-4 mb-3">
                No Class Actions
              </h3>
              <p className="mb-4">
                Both parties agree that any dispute resolution proceedings will be conducted
                on an individual basis only. Class actions, class arbitrations, and
                consolidation of individual arbitrations are not permitted under these Terms.
              </p>

              <h3 className="font-serif text-lg font-semibold text-stone-800 mt-4 mb-3">
                Costs
              </h3>
              <p>
                Each party shall bear its own legal costs and fees in any arbitration
                proceeding unless the arbitrator determines that a party has acted in bad
                faith, in which case the arbitrator may award reasonable fees and costs to the
                prevailing party.
              </p>
            </section>

            <section className="mt-10 pt-8 border-t border-stone-200">
              <p className="text-stone-500 text-sm">
                These Terms of Service should be read alongside our{" "}
                <a
                  href="/privacy-policy"
                  className="text-stone-900 underline hover:no-underline font-medium"
                >
                  Privacy &amp; Messaging Policy
                </a>{" "}
                and{" "}
                <a
                  href="/cookie-policy"
                  className="text-stone-900 underline hover:no-underline font-medium"
                >
                  Cookie Policy
                </a>
                . Together these three documents govern your use of the AIFrontDeskHelper
                platform.
              </p>
            </section>

          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
