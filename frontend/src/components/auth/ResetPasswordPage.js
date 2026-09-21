import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../../services';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('This reset link is missing its token. Please request a new one.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      setLoading(true);
      const { data } = await authService.resetPassword({ token, password, confirmPassword });
      setSuccess(data.message);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.shell}>
      <div style={styles.card}>
        <p style={styles.eyebrow}>Account Recovery</p>
        <h2 style={styles.title}>Set a New Password</h2>
        <p style={styles.subtitle}>Choose a new password for your AGMS account.</p>

        {error && <div style={styles.error}>{error}</div>}

        {success ? (
          <div style={styles.success}>
            <p style={{ margin: 0 }}>{success}</p>
            <p style={{ margin: '8px 0 0', opacity: 0.8 }}>Redirecting you to Sign In…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={styles.label}>New Password</label>
            <input
              type="password" style={styles.input} placeholder="Min. 8 characters"
              value={password} onChange={(e) => setPassword(e.target.value)} autoFocus
            />
            <label style={styles.label}>Confirm New Password</label>
            <input
              type="password" style={styles.input} placeholder="Re-enter password"
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <button type="submit" style={styles.submit} disabled={loading}>
              {loading ? 'Resetting...' : 'Reset Password'}
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
  label: { display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 6, marginTop: 14 },
  input: {
    width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 10, fontSize: 13, color: 'rgba(255,255,255,0.9)', outline: 'none', fontFamily: 'inherit',
  },
  submit: {
    width: '100%', padding: 14, border: 'none', borderRadius: 12, fontSize: 13, fontWeight: 700,
    letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', color: '#06100f', marginTop: 22,
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
  backRow: { textAlign: 'center', marginTop: 18 },
  link: { color: '#e8cc7a', fontWeight: 600, fontSize: 13, textDecoration: 'none' },
};
