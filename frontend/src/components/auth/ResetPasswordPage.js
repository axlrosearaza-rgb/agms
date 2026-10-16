import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../../services';
import { Icons } from '../common';
import ConstellationBg, { AuthGlow } from './ConstellationBg';
import { checkPassword, isStrongPassword } from '../../utils/passwordRules';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Show / hide each password box (the eye buttons).
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const rules = checkPassword(password);
  const strong = isStrongPassword(password);

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
    if (!strong) {
      setError('Choose a stronger password — it must meet every rule below.');
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
      {/* Same background as the Login page. */}
      <ConstellationBg />
      <AuthGlow />
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
            <div style={styles.field}>
              <input
                type={showPassword ? 'text' : 'password'} style={styles.inputWithEye} placeholder="Create a strong password"
                value={password} onChange={(e) => setPassword(e.target.value)} autoFocus
              />
              <button type="button" style={styles.eye} onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? 'Hide password' : 'Show password'} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <Icons.EyeOff /> : <Icons.Eye />}
              </button>
            </div>
            {/* What the password still needs — a rule disappears once it is
                met, so nothing shows when the password is already strong. */}
            {rules.some((r) => !r.ok) && (
              <ul style={styles.rules}>
                {rules.filter((r) => !r.ok).map((r) => (
                  <li key={r.key} style={{ ...styles.rule, color: 'rgba(255,255,255,0.55)' }}>
                    <span style={styles.ruleMark}>•</span>{r.label}
                  </li>
                ))}
              </ul>
            )}
            <label style={styles.label}>Confirm New Password</label>
            <div style={styles.field}>
              <input
                type={showConfirm ? 'text' : 'password'} style={styles.inputWithEye} placeholder="Re-enter password"
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <button type="button" style={styles.eye} onClick={() => setShowConfirm((v) => !v)}
                title={showConfirm ? 'Hide password' : 'Show password'} aria-label={showConfirm ? 'Hide password' : 'Show password'}>
                {showConfirm ? <Icons.EyeOff /> : <Icons.Eye />}
              </button>
            </div>
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
    background: '#060d1c', padding: 20, fontFamily: 'Inter, sans-serif', position: 'relative', overflow: 'hidden',
  },
  card: {
    width: '100%', maxWidth: 420, background: 'rgba(10, 20, 42, 0.78)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 16, padding: '36px 32px', backdropFilter: 'blur(10px)', position: 'relative', zIndex: 1,
    boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
  },
  eyebrow: { fontSize: 11, fontWeight: 600, letterSpacing: 2.5, textTransform: 'uppercase', color: '#3ab8cc', marginBottom: 8 },
  title: { fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 700, color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, marginBottom: 24 },
  label: { display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 6, marginTop: 14 },
  input: {
    width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 10, fontSize: 13, color: 'rgba(255,255,255,0.9)', outline: 'none', fontFamily: 'inherit',
  },
  rules: { listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 3 },
  rule: { fontSize: 12, display: 'flex', alignItems: 'center', gap: 7, transition: 'color 0.2s ease' },
  ruleMark: { width: 12, textAlign: 'center', fontWeight: 700 },
  // A password box with the show / hide (eye) button inside its right edge.
  field: { position: 'relative' },
  inputWithEye: {
    width: '100%', padding: '12px 44px 12px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 10, fontSize: 13, color: 'rgba(255,255,255,0.9)', outline: 'none', fontFamily: 'inherit',
  },
  eye: {
    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 34, height: 34,
    display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none',
    borderRadius: 8, cursor: 'pointer', color: 'rgba(255,255,255,0.55)', padding: 0,
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
