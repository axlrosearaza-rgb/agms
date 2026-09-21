import PublicPageShell from './PublicPageShell';

const Section = ({ title, children }) => (
  <section className="mb-6 last:mb-0">
    <h2 className="text-base font-bold text-navy mb-2">{title}</h2>
    <div className="text-[13.5px] leading-relaxed text-gray-600 space-y-2">{children}</div>
  </section>
);

export default function Terms() {
  return (
    <PublicPageShell
      title="Terms and Conditions"
      subtitle="Academic Grade Management System (AGMS) — College of Arts and Sciences, Samar State University"
    >
      <p className="text-xs text-gray-400 mb-6">Version 1.0 · Last updated: 2026</p>

      <Section title="1. Acceptance of Terms">
        <p>
          By creating an account or otherwise accessing the Academic Grade Management System (AGMS), you agree
          to be bound by these Terms and Conditions and by our Privacy Policy. If you do not agree, please do
          not use the system.
        </p>
      </Section>

      <Section title="2. Authorized Use">
        <p>
          AGMS is intended solely for legitimate academic and administrative purposes of the College of Arts
          and Sciences, Samar State University. Access is limited to enrolled students, faculty, chairpersons,
          and administrators of the College. You agree to use the system only for its intended purpose and not
          to attempt to access data, functions, or accounts that are not authorized for your role.
        </p>
      </Section>

      <Section title="3. Account Responsibility">
        <ul className="list-disc pl-5 space-y-1">
          <li>You are responsible for maintaining the confidentiality of your login credentials;</li>
          <li>You must not share your account or allow another person to use it;</li>
          <li>You must notify the Administrator immediately if you suspect unauthorized access to your account;</li>
          <li>Information you submit (registration details, messages, encoded grades, etc.) must be accurate and truthful.</li>
        </ul>
      </Section>

      <Section title="4. Academic Records and Grades">
        <p>
          Grades and academic records encoded, reviewed, or released through AGMS are official University
          records. Any attempt to alter, falsify, or tamper with grade data outside of authorized, legitimate
          workflows is strictly prohibited and may result in disciplinary and/or legal action.
        </p>
      </Section>

      <Section title="5. Confidentiality">
        <p>
          Academic records accessed through this system are confidential and protected under the Data Privacy
          Act of 2012 (RA 10173). Unauthorized access, copying, disclosure, or distribution of grades or
          personal information belonging to another user is strictly prohibited.
        </p>
      </Section>

      <Section title="6. Prohibited Conduct">
        <ul className="list-disc pl-5 space-y-1">
          <li>Attempting to gain unauthorized access to accounts, data, or system functions;</li>
          <li>Uploading or transmitting harmful code, or attempting to disrupt system operation;</li>
          <li>Using the system to harass, threaten, or send inappropriate messages to other users;</li>
          <li>Misrepresenting your identity or role within the system.</li>
        </ul>
      </Section>

      <Section title="7. Limitation of Liability">
        <p>
          AGMS is provided on an "as is" basis. While the University takes reasonable measures to keep the
          system available, accurate, and secure, it does not guarantee uninterrupted or error-free operation
          and is not liable for damages arising from system downtime, data loss due to circumstances beyond its
          reasonable control, or misuse of the system by another user.
        </p>
      </Section>

      <Section title="8. Changes to These Terms">
        <p>
          These Terms and Conditions may be updated from time to time. Continued use of the system after an
          update constitutes acceptance of the revised Terms.
        </p>
      </Section>

      <Section title="9. Contact">
        <p>
          Questions about these Terms may be directed to the College of Arts and Sciences, Samar State
          University — see our <strong>Contact Us</strong> page for details.
        </p>
      </Section>
    </PublicPageShell>
  );
}
