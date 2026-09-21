const nodemailer = require('nodemailer');

// Gmail SMTP — sends account-recovery and registration-approval emails.
// Requires EMAIL_USER (a Gmail address) + EMAIL_PASS (a 16-character Gmail
// "App Password", NOT the regular account password — Gmail requires this for
// SMTP login when 2-Step Verification is on, which it must be to generate one).
// See: https://myaccount.google.com/apppasswords
let transporter = null;
const isConfigured = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);

if (isConfigured) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
} else {
  console.warn(
    '⚠️  EMAIL_USER / EMAIL_PASS are not set — password-reset and approval emails will be ' +
    'logged to the console instead of actually sent. Add both to backend/.env to enable real delivery.'
  );
}

const BRAND_FOOTER = `
  <p style="font-size:11px;color:#9ca3af;margin-top:24px;">
    Samar State University · College of Arts and Sciences<br/>
    This is an automated message from the Academic Grade Management System (AGMS). Please do not reply directly to this email.
  </p>
`;

const wrap = (title, bodyHtml) => `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 28px;background:#ffffff;">
    <div style="background:#060d1c;padding:18px 24px;border-radius:10px 10px 0 0;">
      <p style="color:#c9a84c;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0;">AGMS · College of Arts and Sciences</p>
    </div>
    <div style="border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px;padding:24px;">
      <h2 style="color:#060d1c;font-size:19px;margin:0 0 14px;">${title}</h2>
      ${bodyHtml}
      ${BRAND_FOOTER}
    </div>
  </div>
`;

// Sends via Gmail SMTP when configured; otherwise logs to the console so the
// rest of the app (registration, approval, password reset) keeps working in
// development without real credentials.
const sendEmail = async ({ to, subject, html }) => {
  if (!isConfigured) {
    console.log(`\n📧 [DEV MODE — email not sent, no EMAIL_USER/EMAIL_PASS configured]\nTo: ${to}\nSubject: ${subject}\n${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`);
    return { simulated: true };
  }
  return transporter.sendMail({
    from: `"AGMS - College of Arts and Sciences" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
};

const sendPasswordResetEmail = async (toEmail, name, resetLink) => {
  const html = wrap('Reset Your Password', `
    <p style="color:#374151;font-size:14px;line-height:1.6;">Hi ${name},</p>
    <p style="color:#374151;font-size:14px;line-height:1.6;">
      We received a request to reset the password for your AGMS account. Click the button below to
      choose a new password. This link expires in <strong>1 hour</strong>.
    </p>
    <p style="text-align:center;margin:26px 0;">
      <a href="${resetLink}" style="background:#c9a84c;color:#060d1c;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;display:inline-block;">Reset Password</a>
    </p>
    <p style="color:#9ca3af;font-size:12px;line-height:1.6;">
      If you didn't request this, you can safely ignore this email — your password will not be changed.
      If the button doesn't work, copy and paste this link into your browser:<br/>
      <span style="word-break:break-all;">${resetLink}</span>
    </p>
  `);
  return sendEmail({ to: toEmail, subject: 'AGMS — Reset Your Password', html });
};

const sendVerificationCodeEmail = async (toEmail, name, code) => {
  const html = wrap('Verify Your Email Address', `
    <p style="color:#374151;font-size:14px;line-height:1.6;">Hi ${name},</p>
    <p style="color:#374151;font-size:14px;line-height:1.6;">
      Thanks for registering for AGMS. Enter this code on the registration page to confirm this is
      your email address. It expires in <strong>15 minutes</strong>.
    </p>
    <p style="text-align:center;margin:26px 0;">
      <span style="background:#060d1c;color:#c9a84c;font-weight:700;font-size:28px;letter-spacing:8px;padding:14px 24px;border-radius:8px;display:inline-block;">${code}</span>
    </p>
    <p style="color:#9ca3af;font-size:12px;line-height:1.6;">
      If you didn't try to register for AGMS, you can safely ignore this email.
    </p>
  `);
  return sendEmail({ to: toEmail, subject: 'AGMS — Your Verification Code', html });
};

const sendAccountApprovedEmail = async (toEmail, name, loginUrl) => {
  const html = wrap('Your Account Has Been Approved', `
    <p style="color:#374151;font-size:14px;line-height:1.6;">Hi ${name},</p>
    <p style="color:#374151;font-size:14px;line-height:1.6;">
      Good news — your AGMS registration has been reviewed and <strong>approved</strong> by the
      College of Arts and Sciences faculty. You may now sign in using your Student ID Number and password.
    </p>
    <p style="text-align:center;margin:26px 0;">
      <a href="${loginUrl}" style="background:#c9a84c;color:#060d1c;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;display:inline-block;">Sign In to AGMS</a>
    </p>
  `);
  return sendEmail({ to: toEmail, subject: 'AGMS — Your Account Has Been Approved', html });
};

const sendAccountRejectedEmail = async (toEmail, name) => {
  const html = wrap('Registration Rejected', `
    <p style="color:#374151;font-size:14px;line-height:1.6;">Hi ${name},</p>
    <p style="color:#374151;font-size:14px;line-height:1.6;">
      We regret to inform you that your student registration for the <strong>Academic Grade Management System (AGMS)</strong> at Samar State University has been reviewed by the Department Chairperson and was <strong>rejected</strong>.
    </p>
    <div style="background:#fef2f2;border:1px solid #fee2e2;border-left:4px solid #ef4444;padding:14px;border-radius:8px;margin:20px 0;">
      <p style="color:#991b1b;font-weight:700;font-size:14px;margin:0 0 6px;">Registration Notice</p>
      <p style="color:#b91c1c;font-size:13.5px;margin:0;line-height:1.5;">
        Your account registration has been rejected and you cannot log in to the system.
      </p>
    </div>
    <p style="color:#374151;font-size:14px;line-height:1.6;">
      This decision is usually due to invalid, incomplete, or unverified student credentials submitted at registration. If you believe this is an error or need further clarification, please contact the College of Arts and Sciences Department Chairperson's office.
    </p>
  `);
  return sendEmail({ to: toEmail, subject: 'AGMS — Registration Rejected', html });
};

module.exports = { sendEmail, sendPasswordResetEmail, sendVerificationCodeEmail, sendAccountApprovedEmail, sendAccountRejectedEmail, isEmailConfigured: isConfigured };
