import PublicPageShell from './PublicPageShell';

const Section = ({ title, children }) => (
  <section className="mb-6 last:mb-0">
    <h2 className="text-base font-bold text-navy mb-2">{title}</h2>
    <div className="text-[13.5px] leading-relaxed text-gray-600 space-y-2">{children}</div>
  </section>
);

export default function PrivacyPolicy() {
  return (
    <PublicPageShell
      title="Privacy Policy"
      subtitle="Academic Grade Management System (AGMS) — College of Arts and Sciences, Samar State University"
    >
      <p className="text-xs text-gray-400 mb-6">Version 1.0 · Last updated: 2026</p>

      <Section title="1. Introduction">
        <p>
          The Academic Grade Management System (AGMS) is a web-based platform used by the College of Arts and
          Sciences (CAS), Samar State University (SSU), to manage student enrollment, grading, academic records,
          and related communication between students, faculty, chairpersons, and administrators. This Privacy
          Policy explains how we collect, use, store, and protect the personal information of everyone who uses
          the system.
        </p>
      </Section>

      <Section title="2. Legal Basis">
        <p>
          This Policy is issued in compliance with the <strong>Data Privacy Act of 2012 (Republic Act No. 10173)</strong>,
          its Implementing Rules and Regulations, and the relevant issuances of the National Privacy Commission
          (NPC) of the Philippines. By using AGMS, you acknowledge that your personal data will be processed
          under the terms described here.
        </p>
      </Section>

      <Section title="3. Information We Collect">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Student information</strong> — full name, student number, program, year level, section, contact details.</li>
          <li><strong>Faculty and Chairperson information</strong> — full name, employee number, program(s) handled, academic rank, position, employment type.</li>
          <li><strong>Grades and academic records</strong> — class records, midterm/final grades, GWA, INC/dropped status, endorsement and promotion history.</li>
          <li><strong>Account credentials</strong> — username or student number, and an encrypted password.</li>
          <li><strong>System activity</strong> — login times, actions taken within the system (for audit and security purposes), and messages exchanged through the built-in messaging feature.</li>
        </ul>
      </Section>

      <Section title="4. Purpose of Collection">
        <p>Your personal data is processed only for legitimate academic and administrative purposes, including:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Verifying identity and managing user accounts;</li>
          <li>Enrolling students in classes and recording their academic performance;</li>
          <li>Encoding, reviewing, approving, and releasing grades;</li>
          <li>Generating official grading sheets, class records, and academic reports;</li>
          <li>Endorsement, promotion, and academic standing evaluation;</li>
          <li>Enabling communication between students, faculty, chairpersons, and administrators; and</li>
          <li>Maintaining system security and an audit trail of account activity.</li>
        </ul>
      </Section>

      <Section title="5. Data Storage">
        <p>
          All data is stored in a secured database accessible only through the AGMS application. Access is
          restricted according to each account's role (Admin, Chairperson, Faculty, or Student) — users can
          only view or modify the information relevant to their own function and scope.
        </p>
      </Section>

      <Section title="6. Data Retention">
        <p>
          Academic records (grades, class records, and related documents) are retained for as long as
          necessary to fulfill academic, legal, and administrative requirements, consistent with the
          University's records retention policy and applicable regulations from the Commission on Higher
          Education (CHED). Account information is retained while the account remains active and for a
          reasonable period afterward for audit and reference purposes.
        </p>
      </Section>

      <Section title="7. Data Security Measures">
        <ul className="list-disc pl-5 space-y-1">
          <li>Passwords are encrypted and never stored or displayed in plain text;</li>
          <li>Access to the system requires authentication, and every account is scoped to a specific role;</li>
          <li>Sensitive actions (grade changes, account creation, approvals) are logged for accountability;</li>
          <li>Communication between your browser and the system is expected to be transmitted over a secured connection in production deployment.</li>
        </ul>
      </Section>

      <Section title="8. Data Sharing">
        <p>
          Personal data collected through AGMS is used strictly within the system and is <strong>not sold, rented,
          or shared with third parties</strong> for commercial purposes. Limited information may only be disclosed:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Among authorized University personnel (Admin, Chairperson, Faculty) as needed to perform their academic functions;</li>
          <li>When required by law, regulation, or a valid order from a competent government authority; or</li>
          <li>With your explicit consent.</li>
        </ul>
      </Section>

      <Section title="9. Your Rights Under the Data Privacy Act">
        <p>As a data subject, you have the right to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Be informed</strong> that your personal data is being processed;</li>
          <li><strong>Access</strong> your own personal data held by the system;</li>
          <li><strong>Object</strong> to the processing of your data, subject to legal and contractual restrictions;</li>
          <li><strong>Correct</strong> inaccurate or outdated personal data;</li>
          <li><strong>Erasure or blocking</strong> of your data under circumstances allowed by law;</li>
          <li><strong>Data portability</strong>, where technically feasible; and</li>
          <li><strong>File a complaint</strong> with the National Privacy Commission (NPC) if you believe your rights have been violated.</li>
        </ul>
      </Section>

      <Section title="10. Contact Information">
        <p>
          For questions, concerns, or requests regarding this Privacy Policy or your personal data, please
          contact the College of Arts and Sciences, Samar State University:
        </p>
        <p>
          Samar State University, Arteche Blvd., Catbalogan City, Philippines 6700<br />
          Phone: (055) 530-0629<br />
          Email: info@ssu.edu.ph<br />
          Website: www.ssu.edu.ph
        </p>
      </Section>
    </PublicPageShell>
  );
}
