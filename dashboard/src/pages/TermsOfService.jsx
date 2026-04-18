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
              Welcome to AIFrontDeskHelper. These Terms of Service govern your access
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
                channels, including AI voice calls, SMS messaging, website chat, messaging
                platform automation, lead capture, appointment scheduling, Google Reviews
                automation, multi-location management, and customer nurturing sequences.
              </p>
              <p>
                The platform is designed to help businesses improve response times and capture
                more revenue from existing leads.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                2. Eligibility
              </h2>
              <p className="mb-4">
                By using AIFrontDeskHelper services, you represent that you are at least 18 years old,
                have the authority to enter into this agreement, and will use the platform in compliance
                with applicable laws and regulations.
              </p>
              <p>
                Businesses using the platform are responsible for ensuring that their use of
                AIFrontDeskHelper complies with all local, state, national, and international laws.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                3. Acceptable Use
              </h2>
              <p className="mb-4">
                Users of AIFrontDeskHelper agree not to use the platform for sending spam or
                unsolicited marketing messages, harassment or misleading communications, fraudulent
                activity, illegal services, unauthorized data collection, or for violating
                telecommunications or messaging regulations.
              </p>
              <p>
                AIFrontDeskHelper reserves the right to suspend or terminate accounts that violate
                these guidelines.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                4. Messaging Compliance
              </h2>
              <p className="mb-4">
                Businesses using AIFrontDeskHelper to send SMS messages must comply with all messaging
                laws and regulations, including applicable telecommunications and consumer protection rules.
                Businesses must ensure they have obtained proper consent before sending text messages
                to customers. Recipients of SMS messages must be able to opt out at any time by replying
                STOP. Users may request assistance by replying HELP. Message frequency may vary.
                Message and data rates may apply.
              </p>

              <h3 className="font-serif text-lg font-semibold text-stone-800 mt-8 mb-3">
                4A. Outbound Calling — TCPA Compliance
              </h3>
              <p className="mb-4">
                Businesses using the AIFrontDeskHelper outbound calling feature are solely responsible
                for ensuring that all contacts on uploaded call lists have provided appropriate prior
                express written consent to be contacted by phone, automated system, or AI-powered voice
                technology as required by the Telephone Consumer Protection Act (TCPA) and all applicable
                federal, state, and local telemarketing laws and regulations.
              </p>
              <p className="mb-4">
                By uploading a contact list and initiating outbound calling campaigns, the business
                account holder represents that all contacts have provided prior express written consent,
                consent records can be produced on request, contacts have been scrubbed against the
                National Do Not Call Registry where required, opt-out requests will be honored
                immediately, and all calling activity complies with calling hour restrictions.
              </p>
              <p>
                AIFrontDeskHelper provides outbound calling as a technology platform only. Violation
                of TCPA or applicable telemarketing laws is the exclusive legal and financial
                responsibility of the business account holder. The business account holder agrees to
                indemnify, defend, and hold harmless AIFrontDeskHelper from any claims, penalties,
                fines, or legal costs arising from the business's outbound calling activity.
                AIFrontDeskHelper reserves the right to immediately suspend or terminate outbound
                calling access for any account suspected of TCPA violations.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                5. Customer Communications and AI Responses
              </h2>
              <p>
                AIFrontDeskHelper uses artificial intelligence to assist in responding to customer
                inquiries across voice, SMS, chat, and messaging channels. While the platform strives
                to provide helpful responses, AI-generated replies may not always fully address complex
                situations. Businesses remain responsible for ensuring the accuracy of information
                provided to their customers and are encouraged to maintain appropriate human oversight
                for sensitive interactions.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                6. Account Responsibilities
              </h2>
              <p>
                Users are responsible for maintaining the security of their accounts and login
                credentials. You agree not to share your login credentials with unauthorized individuals,
                attempt to gain unauthorized access to the platform, or interfere with system security
                or operation. AIFrontDeskHelper is not responsible for losses resulting from unauthorized
                account access caused by user negligence.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                7. Data and Privacy
              </h2>
              <p>
                Use of the platform is governed by the AIFrontDeskHelper Privacy and Messaging Policy
                available at aifrontdeskhelper.com/privacy-policy, which explains how data is collected,
                used, and protected. By using the platform, you acknowledge and agree to the practices
                described in the Privacy Policy.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                8. Service Availability
              </h2>
              <p>
                AIFrontDeskHelper strives to provide reliable service but does not guarantee
                uninterrupted availability. Service interruptions may occur due to maintenance, updates,
                third-party service disruptions, network outages, or system improvements.
                AIFrontDeskHelper is not liable for temporary service interruptions.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                9. Third-Party Services
              </h2>
              <p>
                AIFrontDeskHelper integrates with third-party platforms including messaging providers
                such as Twilio, payment processors such as Stripe, AI language model providers such
                as OpenAI, cloud infrastructure, scheduling services, CRM platforms, and review
                platforms such as Google. Use of these integrations may be subject to the terms and
                policies of those third parties. AIFrontDeskHelper is not responsible for the policies
                or actions of third-party service providers.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                10. Intellectual Property and Data Ownership
              </h2>
              <p className="mb-4">
                All software, technology, branding, and platform content associated with
                AIFrontDeskHelper are the intellectual property of AIFrontDeskHelper. Users may not
                copy or distribute platform software, reverse engineer the platform, or reproduce
                platform features without authorization.
              </p>
              <p className="mb-4">
                Businesses retain full ownership of their own customer data, including contact
                information, call recordings, message transcripts, appointment records, and CRM entries
                generated through platform use. AIFrontDeskHelper acts as a data processor for this
                information and uses it solely to provide the contracted services.
              </p>
              <p className="mb-4">
                Customers may request an export of their business data at any time by contacting
                support. AI-generated responses sent on behalf of a business are the business's property
                to use as they see fit. AIFrontDeskHelper does not use customer conversation data,
                call recordings, or message transcripts to train foundation AI models.
              </p>
              <p>
                Upon cancellation of a business account, customer data will be retained for up to
                30 days during which the account holder may request an export. After this 30-day window,
                customer data will be permanently deleted from production systems, subject to any legal
                retention requirements.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                11. Limitation of Liability
              </h2>
              <p>
                AIFrontDeskHelper provides services on an as-is and as-available basis. To the fullest
                extent permitted by law, AIFrontDeskHelper shall not be liable for indirect or
                incidental damages, lost profits, lost business opportunities, communication errors
                caused by external services, carrier or messaging delivery issues, or inaccurate
                AI-generated responses when a business has failed to maintain appropriate oversight.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                12. Account Suspension or Termination
              </h2>
              <p>
                AIFrontDeskHelper reserves the right to suspend or terminate accounts that violate
                these Terms, engage in prohibited messaging practices, use the platform for unlawful
                purposes, or fail to pay subscription or add-on fees when due. Accounts may also be
                suspended to protect system security or comply with legal obligations.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                13. Modifications to the Terms
              </h2>
              <p>
                AIFrontDeskHelper may update these Terms from time to time to reflect changes in
                technology, law, or service functionality. Updated terms will be posted on this page
                with the revised effective date. Continued use of the platform constitutes acceptance
                of the updated Terms.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                14. Governing Law
              </h2>
              <p>
                These Terms shall be governed by and construed in accordance with the laws of the
                State of Nebraska, without regard to its conflict of law principles. Any legal action
                or proceeding arising out of or relating to these Terms shall be brought exclusively
                in the state or federal courts located in Nebraska, and both parties consent to
                personal jurisdiction in such courts.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                15. Contact Information
              </h2>
              <p className="mb-4">
                For questions regarding these Terms, please contact AIFrontDeskHelper Support.
              </p>
              <p className="mb-1">Email: drew@aifrontdeskhelper.com</p>
              <p>Website: www.aifrontdeskhelper.com</p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                16. Billing and Refund Policy
              </h2>
              <p className="mb-4">
                All setup fees are non-refundable. Monthly subscription fees are non-refundable once
                a billing cycle has begun. If a customer cancels mid-cycle, the account will remain
                active until the end of the current billing period. No partial month refunds are issued.
              </p>
              <p className="mb-4">
                Annual subscriptions are billed in advance for the full 12-month term. Annual
                subscriptions may be refunded on a prorated basis within 7 days of purchase, less any
                setup fees and a reasonable administrative processing fee. After 7 days, annual
                subscriptions are non-refundable.
              </p>
              <p className="mb-4">
                Add-on features such as Google Reviews automation, Customer Nurturing and Referral
                messaging, and additional outbound calling capacity are billed separately from the
                base subscription. Add-ons may be cancelled at any time and will remain active through
                the end of the current billing cycle. No prorated refunds are issued for unused add-on
                time within a billing cycle.
              </p>
              <p className="mb-4">
                For businesses operating multiple locations under a single AIFrontDeskHelper account,
                additional locations beyond the primary location are billed at a recurring monthly rate
                equal to 50 percent of the parent account's effective monthly rate at the time the
                location is added. Adding a new location does not incur a separate setup fee. Rate
                changes to existing locations require 30 days written notice. Removal of a location
                takes effect at the end of the current billing cycle with no prorated refund. Data
                belonging to a removed location will be retained for 30 days for export purposes before
                permanent deletion. The primary HQ location cannot be removed while secondary locations
                remain active.
              </p>
              <p className="mb-4">
                Purchased minute and SMS bundles are non-refundable. Unused bundle minutes roll over
                for 90 days from the date of purchase. After 90 days, unused minutes expire with no
                refund or credit issued.
              </p>
              <p className="mb-4">
                White label branding is included with qualifying plans and available as a paid add-on
                to other plans. White label status may be changed by AIFrontDeskHelper based on plan
                changes, add-on cancellation, or account standing. Upon loss of white label eligibility,
                the dashboard will revert to standard AIFrontDeskHelper branding at the start of the
                next billing cycle.
              </p>
              <p className="mb-4">
                AIFrontDeskHelper may at its sole discretion issue credits or partial refunds in cases
                of documented platform failure or service outage that prevents normal platform use for
                more than 72 consecutive hours. Refund requests must be submitted in writing to
                drew@aifrontdeskhelper.com within 14 days of the billing date in question.
                AIFrontDeskHelper is not obligated to issue refunds for customer dissatisfaction,
                underutilization, or business decisions made by the account holder.
              </p>
              <p>
                Customers who initiate a chargeback or payment dispute without first contacting
                AIFrontDeskHelper support will have their account immediately suspended pending
                resolution. AIFrontDeskHelper reserves the right to recover chargeback fees and
                associated costs from the account holder.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
                17. Dispute Resolution and Arbitration
              </h2>
              <p className="mb-4">
                Before initiating any formal dispute process, both parties agree to attempt to resolve
                any dispute informally by contacting AIFrontDeskHelper support at
                drew@aifrontdeskhelper.com. Both parties agree to make a good faith effort to resolve
                the dispute within 30 days of written notice.
              </p>
              <p className="mb-4">
                If informal resolution fails, any dispute, claim, or controversy arising out of or
                relating to these Terms or the use of AIFrontDeskHelper services shall be resolved by
                binding arbitration rather than in court, except that either party may bring claims in
                small claims court if the claim qualifies.
              </p>
              <p className="mb-4">
                Arbitration shall be conducted by a single arbitrator under the rules of the American
                Arbitration Association. The arbitration shall take place in Nebraska or by remote
                hearing. The arbitrator's decision shall be final and binding and may be entered as a
                judgment in any court of competent jurisdiction.
              </p>
              <p className="mb-4">
                Both parties agree that any dispute resolution proceedings will be conducted on an
                individual basis only. Class actions, class arbitrations, and consolidation of
                individual arbitrations are not permitted under these Terms.
              </p>
              <p>
                Each party shall bear its own legal costs and fees in any arbitration proceeding unless
                the arbitrator determines that a party has acted in bad faith, in which case the
                arbitrator may award reasonable fees and costs to the prevailing party.
              </p>
            </section>

            <section className="mt-10 pt-8 border-t border-stone-200">
              <p className="text-stone-500 text-sm">
                These Terms of Service should be read alongside our Privacy and Messaging Policy
                available at aifrontdeskhelper.com/privacy-policy, SMS Terms at
                aifrontdeskhelper.com/sms-terms, and Cookie Policy at aifrontdeskhelper.com/cookies.
                Together these documents govern your use of the AIFrontDeskHelper platform.
              </p>
            </section>

          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
