import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

const ROLE_ROUTES = {
  Admin: '/admin',
  Chairperson: '/chairperson',
  Faculty: '/faculty',
  Student: '/student',
};

/* ── Constellation background ── */
function ConstellationBg() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf, W, H;

    const STAR_COUNT = 160;
    let stars = [];
    let mouse = { x: -9999, y: -9999 };

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
      stars = Array.from({ length: STAR_COUNT }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.4 + 0.3,
        a: Math.random() * 0.7 + 0.2,
        speed: Math.random() * 0.25 + 0.05,
        drift: (Math.random() - 0.5) * 0.15,
        twinkle: Math.random() * Math.PI * 2,
        color: Math.random() > 0.65
          ? `rgba(201,168,76,`
          : Math.random() > 0.5
            ? `rgba(58,184,204,`
            : `rgba(200,220,255,`,
      }));
    }

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    });

    resize();
    window.addEventListener('resize', resize);

    let t = 0;
    function draw() {
      raf = requestAnimationFrame(draw);
      t += 0.012;

      const bg = ctx.createLinearGradient(0, 0, W * 0.6, H);
      bg.addColorStop(0,   '#060d1c');
      bg.addColorStop(0.5, '#0a1525');
      bg.addColorStop(1,   '#07111f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const n1 = ctx.createRadialGradient(W * 0.12, H * 0.45, 0, W * 0.12, H * 0.45, W * 0.35);
      n1.addColorStop(0, 'rgba(40,140,180,0.13)');
      n1.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = n1; ctx.fillRect(0, 0, W, H);

      const n2 = ctx.createRadialGradient(W * 0.88, H * 0.55, 0, W * 0.88, H * 0.55, W * 0.32);
      n2.addColorStop(0, 'rgba(180,130,30,0.12)');
      n2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = n2; ctx.fillRect(0, 0, W, H);

      stars.forEach(s => {
        s.y -= s.speed;
        s.x += s.drift;
        if (s.y < -4) { s.y = H + 4; s.x = Math.random() * W; }
        if (s.x < -4 || s.x > W + 4) { s.x = Math.random() * W; }

        const pulse = Math.sin(t * 1.8 + s.twinkle) * 0.3 + 0.7;
        const alpha = s.a * pulse;

        const dx = s.x - mouse.x, dy = s.y - mouse.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 100) {
          const force = (100 - dist) / 100 * 1.2;
          s.x += (dx / dist) * force;
          s.y += (dy / dist) * force;
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * pulse, 0, Math.PI * 2);
        ctx.fillStyle = s.color + alpha + ')';
        ctx.fill();
      });

      ctx.strokeStyle = 'rgba(180,200,255,0.04)';
      ctx.lineWidth = 0.6;
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const d = Math.hypot(stars[i].x - stars[j].x, stars[i].y - stars[j].y);
          if (d < 90) {
            ctx.globalAlpha = (1 - d / 90) * 0.25;
            ctx.beginPath();
            ctx.moveTo(stars[i].x, stars[i].y);
            ctx.lineTo(stars[j].x, stars[j].y);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;

      const vig = ctx.createLinearGradient(0, H * 0.6, 0, H);
      vig.addColorStop(0, 'rgba(6,13,28,0)');
      vig.addColorStop(1, 'rgba(6,13,28,0.7)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
    }

    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0 }} />;
}

export default function LoginPage() {
  const [identifier, setIdentifier]     = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [mounted, setMounted]           = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [currentSemester, setCurrentSemester] = useState(null);
  const [rememberMe, setRememberMe]     = useState(true);

  const { login } = useAuth();
  const navigate  = useNavigate();

  useEffect(() => { const id = setTimeout(() => setMounted(true), 80); return () => clearTimeout(id); }, []);

  useEffect(() => {
    api.get('/semesters/public/current')
      .then(({ data }) => setCurrentSemester(data.semester))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const user = await login(identifier, password, rememberMe);
      navigate(ROLE_ROUTES[user.role] || '/');
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        'Login failed. Please try again.';

      const friendlyMessage =
        err?.code === 'ERR_NETWORK' ||
        err?.message === 'Network Error' ||
        !err?.response
          ? 'Unable to reach the server. Please make sure the backend is running and try again.'
          : message;

      setError(friendlyMessage);
    } finally { setLoading(false); }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&family=Inter:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --gold:        #c9a84c;
          --gold-light:  #e8cc7a;
          --gold-dim:    rgba(201,168,76,0.18);
          --teal:        #3ab8cc;
          --teal-light:  #62d4e6;
          --navy:        #060d1c;
        }

        body { background: var(--navy); font-family: 'Inter', sans-serif; }

        /* ── Layout: split screen ── */
        .lp-shell {
          min-height: 100vh;
          display: grid;
          grid-template-columns: 1fr 440px;
          position: relative;
          overflow: hidden;
        }

        /* ── Left panel ── */
        .lp-left {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: flex-start;
          padding: 60px 64px;
          pointer-events: none;
        }

        .lp-left-badge {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 40px;
          opacity: 0;
          transform: translateX(-24px);
          transition: all 0.8s cubic-bezier(0.16,1,0.3,1) 0.1s;
        }
        .lp-left-badge.in { opacity: 1; transform: translateX(0); }

        .lp-badge-line {
          width: 36px; height: 2px;
          background: linear-gradient(90deg, var(--teal), var(--gold));
          border-radius: 2px;
        }
        .lp-badge-text {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--teal);
        }

        /* ── Logo pair ── */
        .lp-logo-pair {
          display: flex;
          justify-content: center;
          align-items: center;
          margin-bottom: 40px;
          opacity: 0;
          transform: translateX(-24px);
          transition: all 0.8s cubic-bezier(0.16,1,0.3,1) 0.2s;
        }
        .lp-logo-pair.in { opacity: 1; transform: translateX(0); }

        .lp-logo-ring {
          position: relative;
          width: 108px;
          height: 108px;
          flex-shrink: 0;
        }

        .lp-logo-ring::before {
          content: '';
          position: absolute;
          inset: -7px;
          border-radius: 50%;
          border: 1.5px solid var(--halo-color);
          opacity: 0.6;
          pointer-events: none;
        }

        .lp-logo-ring--ssu {
          --halo-color: rgba(58,184,204,0.6);
          --ring-color: #3ab8cc;
        }
        .lp-logo-ring--cas {
          --halo-color: rgba(201,168,76,0.6);
          --ring-color: #c9a84c;
        }
        .lp-logo-ring-disc {
          width: 108px;
          height: 108px;
          border-radius: 50%;
          background: rgba(255,255,255,0.97);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          box-shadow:
            0 0 0 3px var(--ring-color),
            0 14px 40px rgba(0,0,0,0.6),
            0 2px 8px rgba(0,0,0,0.3);
        }

        .lp-logo-ring-disc img {
          width: 92%;
          height: 92%;
          object-fit: contain;
          border-radius: 50%;
        }

        .lp-logo-pair-sep {
          width: 1px;
          height: 56px;
          margin: 0 24px;
          flex-shrink: 0;
          background: linear-gradient(
            to bottom,
            transparent,
            rgba(201,168,76,0.45) 30%,
            rgba(201,168,76,0.45) 70%,
            transparent
          );
          position: relative;
        }
        .lp-logo-pair-sep::after {
          content: '';
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 5px; height: 5px;
          border-radius: 50%;
          background: rgba(201,168,76,0.65);
          box-shadow: 0 0 8px rgba(201,168,76,0.45);
        }

        .lp-left-heading {
          opacity: 0;
          transform: translateX(-24px);
          transition: all 0.85s cubic-bezier(0.16,1,0.3,1) 0.3s;
        }
        .lp-left-heading.in { opacity: 1; transform: translateX(0); }

        .lp-left-heading h1 {
          font-family: 'Playfair Display', serif;
          font-size: clamp(36px, 3.5vw, 52px);
          font-weight: 800;
          line-height: 1.08;
          color: #fff;
          letter-spacing: -1px;
        }
        .lp-left-heading h1 em {
          font-style: italic;
          background: linear-gradient(135deg, var(--gold-light), var(--gold));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .lp-left-desc {
          margin-top: 20px;
          font-size: 15px;
          line-height: 1.65;
          color: rgba(255,255,255,0.45);
          font-weight: 300;
          max-width: 380px;
        }

        .lp-left-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 32px;
          opacity: 0;
          transform: translateX(-24px);
          transition: all 0.85s cubic-bezier(0.16,1,0.3,1) 0.45s;
        }
        .lp-left-tags.in { opacity: 1; transform: translateX(0); }

        .lp-tag {
          padding: 7px 14px;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 100px;
          font-size: 12px;
          font-weight: 500;
          color: rgba(255,255,255,0.5);
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(8px);
          letter-spacing: 0.2px;
        }
        .lp-tag.gold { border-color: rgba(201,168,76,0.3); color: var(--gold); background: rgba(201,168,76,0.06); }
        .lp-tag.teal { border-color: rgba(58,184,204,0.3); color: var(--teal); background: rgba(58,184,204,0.06); }

        /* ── Vertical divider ── */
        .lp-divider {
          position: absolute;
          top: 0; bottom: 0;
          right: 440px;
          width: 1px;
          background: linear-gradient(to bottom, transparent 0%, rgba(201,168,76,0.25) 30%, rgba(201,168,76,0.25) 70%, transparent 100%);
          z-index: 2;
        }

        /* ── Right panel ── */
        .lp-right {
          position: relative;
          z-index: 1;
          background: rgba(8,15,30,0.75);
          backdrop-filter: blur(40px) saturate(150%);
          -webkit-backdrop-filter: blur(40px) saturate(150%);
          border-left: 1px solid rgba(255,255,255,0.07);
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 48px 44px;
          min-height: 100vh;
        }

        .lp-right::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; height: 2px;
          background: linear-gradient(90deg, transparent, var(--teal) 30%, var(--gold) 70%, transparent);
          background-size: 200% 100%;
          animation: edgeShift 6s ease-in-out infinite alternate;
        }
        @keyframes edgeShift { from { background-position: 0% 0; } to { background-position: 100% 0; } }

        .lp-right-inner {
          opacity: 0;
          transform: translateY(20px);
          transition: all 0.8s cubic-bezier(0.16,1,0.3,1) 0.35s;
        }
        .lp-right-inner.in { opacity: 1; transform: translateY(0); }

        .lp-form-eyebrow {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: var(--gold);
          opacity: 0.75;
          margin-bottom: 8px;
        }
        .lp-form-title {
          font-family: 'Playfair Display', serif;
          font-size: 30px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 6px;
          letter-spacing: -0.5px;
        }
        .lp-form-sub {
          font-size: 13px;
          color: rgba(255,255,255,0.4);
          margin-bottom: 32px;
          font-weight: 300;
        }

        /* Error */
        .lp-error {
          background: rgba(220,50,50,0.1);
          border: 1px solid rgba(220,50,50,0.25);
          border-left: 3px solid #e05555;
          color: #ff9a9a;
          padding: 11px 14px;
          border-radius: 10px;
          font-size: 12.5px;
          margin-bottom: 20px;
          display: flex; align-items: center; gap: 8px;
          animation: shake 0.45s ease;
        }
        @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }

        /* Fields */
        .lp-field { margin-bottom: 18px; }
        .lp-label {
          display: block;
          font-size: 11px; font-weight: 600;
          letter-spacing: 1px; text-transform: uppercase;
          color: rgba(255,255,255,0.45);
          margin-bottom: 8px;
        }
        .lp-label .req { color: #e07070; margin-left: 2px; }

        .lp-input-wrap { position: relative; display: flex; align-items: center; }
        .lp-input-icon {
          position: absolute; left: 14px;
          color: rgba(255,255,255,0.2);
          display: flex; align-items: center;
          pointer-events: none; z-index: 1;
          transition: color 0.25s;
        }
        .lp-input-wrap.focused .lp-input-icon { color: var(--gold); }

        .lp-input {
          width: 100%;
          padding: 13px 14px 13px 42px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 12px;
          font-size: 13.5px; font-family: 'Inter', sans-serif; font-weight: 400;
          color: rgba(255,255,255,0.9);
          outline: none;
          transition: border-color 0.25s, background 0.25s, box-shadow 0.25s;
        }
        .lp-input::placeholder { color: rgba(255,255,255,0.2); }
        .lp-input:focus {
          background: rgba(255,255,255,0.08);
          border-color: rgba(201,168,76,0.5);
          box-shadow: 0 0 0 3px rgba(201,168,76,0.08), 0 0 24px rgba(201,168,76,0.05);
        }
        .lp-input.has-r { padding-right: 46px; }

        .lp-pw-toggle {
          position: absolute; right: 13px;
          background: rgba(201,168,76,0.15); border: 1px solid rgba(201,168,76,0.3); cursor: pointer;
          color: var(--gold);
          display: flex; align-items: center; padding: 5px;
          border-radius: 8px; transition: all 0.2s;
        }
        .lp-pw-toggle:hover { background: rgba(201,168,76,0.25); color: var(--gold-light); }

        /* Meta */
        .lp-meta { display: flex; align-items: center; justify-content: space-between; margin: 2px 0 24px; }
        .lp-remember { display: flex; align-items: center; gap: 7px; font-size: 12px; color: rgba(255,255,255,0.4); cursor: pointer; user-select: none; }
        .lp-remember input { accent-color: var(--gold); }
        .lp-forgot {
          font-size: 12px; font-weight: 600; color: var(--gold); text-decoration: none; opacity: 0.8; transition: opacity 0.2s; position: relative;
        }
        .lp-forgot::after { content: ''; position: absolute; bottom: -1px; left: 0; width: 0; height: 1px; background: var(--gold-light); transition: width 0.25s; }
        .lp-forgot:hover { opacity: 1; }
        .lp-forgot:hover::after { width: 100%; }

        /* Submit button */
        .lp-submit {
          width: 100%; padding: 15px; border: none; border-radius: 12px;
          font-size: 13px; font-weight: 700; font-family: 'Inter', sans-serif;
          letter-spacing: 1.5px; text-transform: uppercase;
          cursor: pointer; color: #06100f;
          background: linear-gradient(135deg, #a87a20 0%, #c9a84c 45%, #e8cc7a 100%);
          position: relative; overflow: hidden;
          transition: box-shadow 0.3s, transform 0.15s;
          box-shadow: 0 4px 24px rgba(201,168,76,0.2);
        }
        .lp-submit::before {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%);
          transform: translateX(-100%);
          transition: transform 0.55s;
        }
        .lp-submit:hover:not(:disabled)::before { transform: translateX(150%); }
        .lp-submit:hover:not(:disabled) { box-shadow: 0 8px 36px rgba(201,168,76,0.5); transform: translateY(-1px); }
        .lp-submit:active:not(:disabled) { transform: translateY(0); }
        .lp-submit:disabled { opacity: 0.5; cursor: not-allowed; }

        .lp-spinner {
          display: inline-block; width: 15px; height: 15px;
          border: 2px solid rgba(6,16,15,0.3); border-top-color: #06100f;
          border-radius: 50%; animation: spin 0.65s linear infinite;
          vertical-align: middle; margin-right: 8px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Register link */
        .lp-register-link {
          text-align: center;
          margin-top: 24px;
          font-size: 13px;
          color: rgba(255,255,255,0.4);
        }
        .lp-register-link a {
          color: var(--teal);
          font-weight: 600;
          text-decoration: none;
          position: relative;
          transition: opacity 0.2s;
        }
        .lp-register-link a::after {
          content: '';
          position: absolute;
          bottom: -1px; left: 0;
          width: 0; height: 1px;
          background: var(--teal-light);
          transition: width 0.25s;
        }
        .lp-register-link a:hover { opacity: 0.85; }
        .lp-register-link a:hover::after { width: 100%; }

        /* Footer */
        .lp-right-footer {
          margin-top: 28px;
          font-size: 11px;
          color: rgba(255,255,255,0.16);
          letter-spacing: 0.3px;
          text-align: center;
        }
        .lp-right-footer .t { color: rgba(58,184,204,0.4); }
        .lp-right-footer .g { color: rgba(201,168,76,0.4); }

        /* ── Responsive ── */
        @media (max-width: 900px) {
          .lp-shell { grid-template-columns: 1fr; }
          .lp-left { display: none; }
          .lp-divider { display: none; }
          .lp-right {
            border-left: none;
            border-top: 1px solid rgba(255,255,255,0.07);
            padding: 48px 28px 36px;
            justify-content: flex-start;
            padding-top: 52px;
          }
        }
        @media (max-width: 480px) {
          .lp-right { padding: 40px 20px 28px; }
        }
      `}</style>

      <ConstellationBg />

      <div className="lp-shell">
        <div className="lp-divider" />

        {/* ── Left: Branding ── */}
        <div className="lp-left">
          <div className={`lp-left-badge ${mounted ? 'in' : ''}`}>
            <div className="lp-badge-line" />
            <span className="lp-badge-text">Academic Portal</span>
          </div>

            {/* ── Logo pair ── */}
          <div className={`lp-logo-pair ${mounted ? 'in' : ''}`}>
            <div className="lp-logo-ring lp-logo-ring--ssu">
              <div className="lp-logo-ring-disc">
                <img src="/assets/logos/ssu-logo.png" alt="SSU" />
              </div>
            </div>

            <div className="lp-logo-pair-sep" />

            <div className="lp-logo-ring lp-logo-ring--cas">
              <div className="lp-logo-ring-disc">
                <img src="/assets/logos/cas-logo.png" alt="CAS" />
              </div>
            </div>
          </div>

          <div className={`lp-left-heading ${mounted ? 'in' : ''}`}>
            <h1>
              College of Arts<br />
              and<br />
              <em>Sciences</em>
            </h1>
            <p className="lp-left-desc">
              Academic Grade Management System for the College of Arts and Sciences — Main Campus.
            </p>
          </div>

          <div className={`lp-left-tags ${mounted ? 'in' : ''}`}>
            <span className="lp-tag gold">College of Arts &amp; Sciences</span>
            <span className="lp-tag teal">Samar State University - Main Campus</span>
            <span className="lp-tag">Grade Management</span>
            {currentSemester && (
              <span className="lp-tag">{currentSemester.term || currentSemester.name} · A.Y. {currentSemester.academic_year}</span>
            )}
          </div>
        </div>

        {/* ── Right: Form ── */}
        <div className="lp-right">
          <div className={`lp-right-inner ${mounted ? 'in' : ''}`}>
            <p className="lp-form-eyebrow">Portal Access</p>
            <h2 className="lp-form-title">Welcome back</h2>
            <p className="lp-form-sub">Sign in to continue to your dashboard</p>

            {error && (
              <div className="lp-error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="lp-field">
                <label className="lp-label">Username / Student ID Number <span className="req">*</span></label>
                <div className={`lp-input-wrap ${focusedField === 'identifier' ? 'focused' : ''}`}>
                  <span className="lp-input-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                  </span>
                  <input className="lp-input" type="text" placeholder="Username or Student ID Number"
                    value={identifier} onChange={e => setIdentifier(e.target.value)}
                    onFocus={() => setFocusedField('identifier')} onBlur={() => setFocusedField(null)} required />
                </div>
              </div>

              <div className="lp-field">
                <label className="lp-label">Password <span className="req">*</span></label>
                <div className={`lp-input-wrap ${focusedField === 'password' ? 'focused' : ''}`}>
                  <span className="lp-input-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </span>
                  <input className="lp-input has-r" type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password" value={password}
                    onChange={e => setPassword(e.target.value)}
                    onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)} required />
                  <button type="button" className="lp-pw-toggle" onClick={() => setShowPassword(s => !s)}>
                    {showPassword ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="lp-meta">
                <label className="lp-remember">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} /> Remember me
                </label>
                <Link to="/forgot-password" className="lp-forgot">Forgot password?</Link>
              </div>

              <button type="submit" className="lp-submit" disabled={loading}>
                {loading && <span className="lp-spinner" />}
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <p className="lp-register-link">
              New student? <Link to="/register">Create an account</Link>
            </p>

            <p className="lp-right-footer" style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 6 }}>
              <Link to="/privacy-policy" style={{ color: 'rgba(255,255,255,0.35)' }}>Privacy Policy</Link>
              <span>·</span>
              <Link to="/terms" style={{ color: 'rgba(255,255,255,0.35)' }}>Terms and Conditions</Link>
              <span>·</span>
              <Link to="/contact" style={{ color: 'rgba(255,255,255,0.35)' }}>Contact Us</Link>
            </p>
            <p className="lp-right-footer">
              © 2025 <span className="t">Samar State University</span> · <span className="g">CAS</span> · All Rights Reserved
            </p>
          </div>
        </div>
      </div>
    </>
  );
}