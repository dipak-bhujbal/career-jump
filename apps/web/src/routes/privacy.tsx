import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({ component: PrivacyRoute });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

function PrivacyRoute() {
  return (
    <div className="min-h-screen bg-[hsl(var(--background))] p-6 md:p-12">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-10">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center text-white shadow-sm shrink-0">
            <Sparkles size={18} />
          </div>
          <div>
            <div className="font-bold text-sm">Career Jump</div>
            <div className="text-xs text-[hsl(var(--muted-foreground))]">Private job radar</div>
          </div>
        </div>

        <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] mb-8">
          <ArrowLeft size={14} /> Back
        </Link>

        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-8">
          Effective date: January 1, 2025 · Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </p>

        <div className="space-y-8">
          <Section title="1. Introduction">
            <p>
              Career Jump ("we", "us", "our") operates a private job-tracking SaaS platform. This Privacy Policy explains what personal information we collect, how we use it, and your rights — including rights under the California Consumer Privacy Act (CCPA) and other applicable US privacy laws.
            </p>
            <p>
              We treat all users as California residents for simplicity, meaning everyone gets the same strong data rights regardless of location.
            </p>
          </Section>

          <Section title="2. Information We Collect">
            <p><strong className="text-[hsl(var(--foreground))]">Account information:</strong> Email address, display name, and encrypted password (handled by AWS Cognito — we never see your raw password).</p>
            <p><strong className="text-[hsl(var(--foreground))]">Job tracking data:</strong> Job listings you view or apply to, application status, interview notes, and action plan entries. This data is yours and isolated to your account.</p>
            <p><strong className="text-[hsl(var(--foreground))]">Usage data:</strong> Application logs retained for 6 hours for debugging. No long-term behavioral analytics.</p>
            <p><strong className="text-[hsl(var(--foreground))]">Device and session data:</strong> Browser preferences (theme, density) stay in local storage, while a session identifier and coarse device-security fingerprint are sent with API requests to help us detect broken sessions, protect accounts, and debug sign-in issues.</p>
          </Section>

          <Section title="3. How We Use Your Information">
            <ul className="list-disc list-inside space-y-1">
              <li>To authenticate you and secure your account</li>
              <li>To store and display your job tracking data</li>
              <li>To send email notifications you opt into (new job alerts, weekly digest, status updates)</li>
              <li>To process account deletion and data export requests</li>
              <li>To maintain platform security and debug issues (logs)</li>
            </ul>
            <p>We do <strong className="text-[hsl(var(--foreground))]">not</strong> sell your data, share it with advertisers, or use it for cross-site tracking.</p>
          </Section>

          <Section title="4. Your Rights (CCPA &amp; General)">
            <p><strong className="text-[hsl(var(--foreground))]">Right to Know:</strong> You can view all data associated with your account at any time from the Profile page, and download a full JSON export.</p>
            <p><strong className="text-[hsl(var(--foreground))]">Right to Delete:</strong> You can delete your account and all associated data from Profile → Danger Zone. Deletion is immediate and irreversible.</p>
            <p><strong className="text-[hsl(var(--foreground))]">Right to Opt-Out of Sale:</strong> We do not sell personal information. Not applicable.</p>
            <p><strong className="text-[hsl(var(--foreground))]">Right to Non-Discrimination:</strong> Exercising any privacy right will not affect your access to Career Jump.</p>
            <p><strong className="text-[hsl(var(--foreground))]">Right to Correct:</strong> Update your email and display name from the Profile page at any time.</p>
          </Section>

          <Section title="5. Data Retention">
            <ul className="list-disc list-inside space-y-1">
              <li>Account and job data: retained until you delete your account</li>
              <li>Application logs: auto-deleted after 6 hours</li>
              <li>Auth tokens: access tokens expire after 1 hour; refresh tokens after 30 days</li>
              <li>Email notification logs: retained 90 days for deliverability analysis</li>
            </ul>
          </Section>

          <Section title="6. Data Security">
            <p>Your data is encrypted in transit (HTTPS via CloudFront) and at rest (AWS DynamoDB encryption, Cognito encrypted credential storage). We use AWS infrastructure in the US-East-1 region.</p>
            <p>Multi-tenant isolation is enforced at the API layer — each request is validated against your Cognito identity token and can only access your own data partition.</p>
          </Section>

          <Section title="7. Email Communications">
            <p>We send transactional emails (verification, password reset) and optional notification emails (new jobs, weekly digest, status updates) through our configured delivery providers, which can include AWS SES and an admin-managed webhook relay. You can manage notification preferences from Settings → Email Notifications. Transactional emails cannot be opted out of as they are required for account security.</p>
          </Section>

          <Section title="8. Third-Party Services">
            <ul className="list-disc list-inside space-y-1">
              <li><strong className="text-[hsl(var(--foreground))]">AWS Cognito</strong> — authentication and identity management (US)</li>
              <li><strong className="text-[hsl(var(--foreground))]">AWS DynamoDB</strong> — data storage, encrypted at rest (US-East-1)</li>
              <li><strong className="text-[hsl(var(--foreground))]">AWS SES and admin-managed mail relays</strong> — transactional and notification email delivery (US)</li>
              <li><strong className="text-[hsl(var(--foreground))]">AWS CloudFront / S3</strong> — static asset hosting (US CDN)</li>
            </ul>
            <p>All third parties are AWS services subject to AWS's compliance certifications (SOC2, ISO 27001, HIPAA-eligible).</p>
          </Section>

          <Section title="9. Children's Privacy">
            <p>Career Jump is not directed to children under 13. We do not knowingly collect data from minors. If you believe a minor has created an account, contact us and we will delete it immediately.</p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>We may update this policy. When we do, we'll update the "Last updated" date above and notify users by email if changes are material.</p>
          </Section>

          <Section title="11. Contact">
            <p>
              For privacy requests, data exports, or questions:
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>Email: <a href="mailto:privacy@careerjump.app" className="text-blue-500 hover:text-blue-400">privacy@careerjump.app</a></li>
              <li>Data export: Profile → Export my data</li>
              <li>Data deletion: Profile → Danger Zone → Delete account</li>
            </ul>
          </Section>
        </div>

        <div className="mt-12 pt-6 border-t border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))]">
          © {new Date().getFullYear()} Career Jump. All rights reserved.
        </div>
      </div>
    </div>
  );
}
