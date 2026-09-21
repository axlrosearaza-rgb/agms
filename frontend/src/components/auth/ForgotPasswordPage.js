import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../../services';

// Mirrors RegisterPage.js's EMAIL_REGEX — registration now accepts a Gmail or
// SSU email, so recovery has to accept whichever one the student actually used.
const EMAIL_REGEX = /^[a-zA-Z0-9](\.?[a-zA-Z0-9_-]){2,}@(gmail\.com|([a-zA-Z0-9-]+\.)*ssu\.edu\.ph)$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!EMAIL_REGEX.test(email.trim().toLowerCase())) {
      setError('Please enter a valid Gmail or SSU email address.');
      return;
    }

    try {
      setLoading(true);
      const { data } = await authService.forgotPassword(email.trim().toLowerCase());
      setSent(true);
      setError('');
      // Server always returns a generic message either way — never reveals
      // whether the address is actually registered.
      void data;
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.shell}>
      <div style={styles.card}>
        <p style={styles.eyebrow}>Account Recovery</p>
        <h2 style={styles.title}>Forgot Password?</h2>
        <p style={styles.subtitle}>
          Enter the Gmail or SSU email address you registered with. We'll send you a link to reset your password.
        </p>

        {error && <div style={styles.error}>{error}</div>}

        {sent ? (
          <div style={styles.success}>
            <p style={{ margin: 0 }}>
              If <strong>{email}</strong> is registered, a password reset link has been sent to it.
              Check your inbox (and spam folder) — the link expires in 1 hour.
            </p>
            <Link to="/login" style={styles.backLink}>← Back to Sign In</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={styles.label}>Gmail or SSU Email</label>
            <input
              type="email"
              style={styles.input}
              placeholder="juandelacruz@gmail.com or juandelacruz@ssu.edu.ph"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <button type="submit" style={styles.submit} disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
            <p style={styles.backRow}>
              <Link to="/login" style={styles.link}>← Back to Sign In</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

const styles = {
  shell: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(135deg, #060d1c 0%, #0a1525 100%)', padding: 20, fontFamily: 'Inter, sans-serif',
  },
  card: {
    width: '100%', maxWidth: 420, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16, padding: '36px 32px', backdropFilter: 'blur(10px)',
  },
  eyebrow: { fontSize: 11, fontWeight: 600, letterSpacing: 2.5, textTransform: 'uppercase', color: '#3ab8cc', marginBottom: 8 },
  title: { fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 700, color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, marginBottom: 24 },
  label: { display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 6 },
  input: {
    width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 10, fontSize: 13, color: 'rgba(255,255,255,0.9)', outline: 'none', marginBottom: 18, fontFamily: 'inherit',
  },
  submit: {
    width: '100%', padding: 14, border: 'none', borderRadius: 12, fontSize: 13, fontWeight: 700,
    letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', color: '#06100f',
    background: 'linear-gradient(135deg, #a87a20 0%, #c9a84c 45%, #e8cc7a 100%)',
  },
  error: {
    background: 'rgba(220,50,50,0.1)', border: '1px solid rgba(220,50,50,0.25)', borderLeft: '3px solid #e05555',
    color: '#ff9a9a', padding: '11px 14px', borderRadius: 10, fontSize: 12.5, marginBottom: 18,
  },
  success: {
    background: 'rgba(40,180,100,0.1)', border: '1px solid rgba(40,180,100,0.25)', borderLeft: '3px solid #28b464',
    color: '#bdf0d4', padding: '16px 18px', borderRadius: 10, fontSize: 13, lineHeight: 1.6,
  },
  backLink: { display: 'inline-block', marginTop: 14, color: '#e8cc7a', fontWeight: 600, fontSize: 13, textDecoration: 'none' },
  backRow: { textAlign: 'center', marginTop: 18 },
  link: { color: '#e8cc7a', fontWeight: 600, fontSize: 13, textDecoration: 'none' },
};
