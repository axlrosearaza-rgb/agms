import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import API from '../../services/api';

const CAS_PROGRAMS = [
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];

const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const SEMESTERS = ['1st Semester', '2nd Semester'];

/* ── Constellation background (shared with LoginPage) ── */
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

export default function RegisterPage() {
  const [form, setForm] = useState({
    name: '', password: '', confirmPassword: '',
    student_no: '', program: '', year_level: '', section: '', student_status: 'Regular',
    irregular_sections: [],
  });
  const [error, setError]               = useState('');
  const [success, setSuccess]           = useState('');
  const [loading, setLoading]           = useState(false);
  const [mounted, setMounted]           = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);

  const navigate = useNavigate();

  useEffect(() => { const id = setTimeout(() => setMounted(true), 80); return () => clearTimeout(id); }, []);

  const updateField = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setError('');
  };

  // Irregular students get at most one Section + Semester choice per Year level
  // (they can't be in two sections of the same year at once) — checking a Year
  // adds a blank entry for it; unchecking removes it.
  const toggleIrregularYear = (yr) => {
    setForm(prev => {
      const exists = prev.irregular_sections.some(p => p.year_level === yr);
      const next = exists
        ? prev.irregular_sections.filter(p => p.year_level !== yr)
        : [...prev.irregular_sections, { year_level: yr, section: '', semester: '' }];
      return { ...prev, irregular_sections: next };
    });
    setError('');
  };

  const updateIrregularYearField = (yr, field, value) => {
    setForm(prev => ({
      ...prev,
      irregular_sections: prev.irregular_sections.map(p => p.year_level === yr ? { ...p, [field]: value } : p),
    }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);

    if (!form.name || !form.password || !form.confirmPassword || !form.student_no || !form.program) {
      setError('Please fill out all required fields.');
      setLoading(false);
      return;
    }

    if (form.student_status === 'Irregular') {
      if (!form.irregular_sections || form.irregular_sections.length === 0) {
        setError('Please check at least one Year level you\'re taking.');
        setLoading(false);
        return;
      }
      if (form.irregular_sections.some(p => !p.section || !p.semester)) {
        setError('Please select a Section and Semester for every Year you checked.');
        setLoading(false);
        return;
      }
    } else if (!form.year_level) {
      setError('Please select your year level.');
      setLoading(false);
      return;
    }

    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      setLoading(false);
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    try {
      const res = await API.post('/auth/register', form);
      setSuccess(res.data.message);
      setForm({ name: '', password: '', confirmPassword: '', student_no: '', program: '', year_level: '', section: '', student_status: 'Regular', irregular_sections: [] });
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
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

        .rp-shell {
          min-height: 100vh;
          display: grid;
          grid-template-columns: 1fr 520px;
          position: relative;
          overflow: hidden;
        }

        .rp-left {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: flex-start;
          padding: 60px 64px;
          pointer-events: none;
        }

        .rp-left-badge {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 40px;
          opacity: 0;
          transform: translateX(-24px);
          transition: all 0.8s cubic-bezier(0.16,1,0.3,1) 0.1s;
        }
        .rp-left-badge.in { opacity: 1; transform: translateX(0); }

        .rp-badge-line {
          width: 36px; height: 2px;
          background: linear-gradient(90deg, var(--teal), var(--gold));
          border-radius: 2px;
        }
        .rp-badge-text {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--teal);
        }

        .rp-logo-pair {
          display: flex;
          align-items: center;
          margin-bottom: 40px;
          opacity: 0;
          transform: translateX(-24px);
          transition: all 0.8s cubic-bezier(0.16,1,0.3,1) 0.2s;
        }
        .rp-logo-pair.in { opacity: 1; transform: translateX(0); }

        .rp-logo-ring {
          position: relative;
          width: 108px;
          height: 108px;
          flex-shrink: 0;
        }

        .rp-logo-ring::before {
          content: '';
          position: absolute;
          inset: -7px;
          border-radius: 50%;
          border: 1.5px solid var(--halo-color);
          opacity: 0.6;
          pointer-events: none;
        }

        .rp-logo-ring--ssu { --halo-color: rgba(58,184,204,0.6); --ring-color: #3ab8cc; }
        .rp-logo-ring--cas { --halo-color: rgba(201,168,76,0.6); --ring-color: #c9a84c; }

        .rp-logo-ring-disc {
          width: 108px; height: 108px;
          border-radius: 50%;
          background: rgba(255,255,255,0.97);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 0 3px var(--ring-color), 0 14px 40px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.3);
        }
        .rp-logo-ring-disc img { width: 84%; height: 84%; object-fit: contain; border-radius: 50%; }

        .rp-logo-pair-sep {
          width: 1px; height: 56px; margin: 0 24px; flex-shrink: 0;
          background: linear-gradient(to bottom, transparent, rgba(201,168,76,0.45) 30%, rgba(201,168,76,0.45) 70%, transparent);
          position: relative;
        }
        .rp-logo-pair-sep::after {
          content: ''; position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 5px; height: 5px; border-radius: 50%;
          background: rgba(201,168,76,0.65); box-shadow: 0 0 8px rgba(201,168,76,0.45);
        }

        .rp-left-heading { opacity: 0; transform: translateX(-24px); transition: all 0.85s cubic-bezier(0.16,1,0.3,1) 0.3s; }
        .rp-left-heading.in { opacity: 1; transform: translateX(0); }
        .rp-left-heading h1 {
          font-family: 'Playfair Display', serif;
          font-size: clamp(36px, 3.5vw, 52px); font-weight: 800;
          line-height: 1.08; color: #fff; letter-spacing: -1px;
        }
        .rp-left-heading h1 em {
          font-style: italic;
          background: linear-gradient(135deg, var(--gold-light), var(--gold));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .rp-left-desc { margin-top: 20px; font-size: 15px; line-height: 1.65; color: rgba(255,255,255,0.45); font-weight: 300; max-width: 380px; }

        .rp-left-tags { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 32px; opacity: 0; transform: translateX(-24px); transition: all 0.85s cubic-bezier(0.16,1,0.3,1) 0.45s; }
        .rp-left-tags.in { opacity: 1; transform: translateX(0); }
        .rp-tag { padding: 7px 14px; border: 1px solid rgba(255,255,255,0.1); border-radius: 100px; font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.5); background: rgba(255,255,255,0.04); backdrop-filter: blur(8px); letter-spacing: 0.2px; }
        .rp-tag.gold { border-color: rgba(201,168,76,0.3); color: var(--gold); background: rgba(201,168,76,0.06); }
        .rp-tag.teal { border-color: rgba(58,184,204,0.3); color: var(--teal); background: rgba(58,184,204,0.06); }

        .rp-divider { position: absolute; top: 0; bottom: 0; right: 520px; width: 1px; background: linear-gradient(to bottom, transparent 0%, rgba(201,168,76,0.25) 30%, rgba(201,168,76,0.25) 70%, transparent 100%); z-index: 2; }

        .rp-right {
          position: relative; z-index: 1;
          background: rgba(8,15,30,0.75);
          backdrop-filter: blur(40px) saturate(150%);
          -webkit-backdrop-filter: blur(40px) saturate(150%);
          border-left: 1px solid rgba(255,255,255,0.07);
          display: flex; flex-direction: column; justify-content: center;
          padding: 36px 40px; min-height: 100vh; overflow-y: auto;
        }

        .rp-right::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
          background: linear-gradient(90deg, transparent, var(--teal) 30%, var(--gold) 70%, transparent);
          background-size: 200% 100%;
          animation: edgeShift 6s ease-in-out infinite alternate;
        }
        @keyframes edgeShift { from { background-position: 0% 0; } to { background-position: 100% 0; } }

        .rp-right-inner { opacity: 0; transform: translateY(20px); transition: all 0.8s cubic-bezier(0.16,1,0.3,1) 0.35s; }
        .rp-right-inner.in { opacity: 1; transform: translateY(0); }

        .rp-form-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 2.5px; text-transform: uppercase; color: var(--teal); opacity: 0.75; margin-bottom: 8px; }
        .rp-form-title { font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: #fff; margin-bottom: 6px; letter-spacing: -0.5px; }
        .rp-form-sub { font-size: 13px; color: rgba(255,255,255,0.4); margin-bottom: 28px; font-weight: 300; line-height: 1.5; }

        .rp-error {
          background: rgba(220,50,50,0.1); border: 1px solid rgba(220,50,50,0.25); border-left: 3px solid #e05555;
          color: #ff9a9a; padding: 11px 14px; border-radius: 10px; font-size: 12.5px; margin-bottom: 18px;
          display: flex; align-items: center; gap: 8px; animation: shake 0.45s ease;
        }
        @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }

        .rp-success {
          background: rgba(40,180,100,0.1); border: 1px solid rgba(40,180,100,0.25); border-left: 3px solid #28b464;
          color: #6eeaa7; padding: 14px 16px; border-radius: 10px; font-size: 13px; margin-bottom: 18px;
          line-height: 1.5; animation: fadeIn 0.5s ease;
        }
        .rp-success-icon { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: rgba(40,180,100,0.15); margin-bottom: 10px; }
        .rp-success a { color: var(--gold-light); font-weight: 600; text-decoration: none; transition: opacity 0.2s; }
        .rp-success a:hover { opacity: 0.8; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

        .rp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

        .rp-field { margin-bottom: 14px; }
        .rp-label { display: block; font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: rgba(255,255,255,0.45); margin-bottom: 6px; }
        .rp-label .req { color: #e07070; margin-left: 2px; }

        .rp-input-wrap { position: relative; display: flex; align-items: center; }
        .rp-input-icon { position: absolute; left: 12px; color: rgba(255,255,255,0.2); display: flex; align-items: center; pointer-events: none; z-index: 1; transition: color 0.25s; }
        .rp-input-wrap.focused .rp-input-icon { color: var(--gold); }

        .rp-input {
          width: 100%; padding: 12px 12px 12px 38px;
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09);
          border-radius: 10px; font-size: 13px; font-family: 'Inter', sans-serif; font-weight: 400;
          color: rgba(255,255,255,0.9); outline: none;
          transition: border-color 0.25s, background 0.25s, box-shadow 0.25s;
        }
        .rp-input::placeholder { color: rgba(255,255,255,0.2); }
        .rp-input:focus { background: rgba(255,255,255,0.08); border-color: rgba(201,168,76,0.5); box-shadow: 0 0 0 3px rgba(201,168,76,0.08), 0 0 24px rgba(201,168,76,0.05); }
        .rp-input.has-r { padding-right: 42px; }

        .rp-select {
          width: 100%; padding: 12px 32px 12px 12px;
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09);
          border-radius: 10px; font-size: 13px; font-family: 'Inter', sans-serif; font-weight: 400;
          color: rgba(255,255,255,0.9); outline: none;
          appearance: none; -webkit-appearance: none; cursor: pointer;
          transition: border-color 0.25s, background 0.25s, box-shadow 0.25s;
          background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='rgba(255,255,255,0.3)' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 12px center;
        }
        .rp-select:focus {
          background-color: rgba(255,255,255,0.08); border-color: rgba(201,168,76,0.5);
          box-shadow: 0 0 0 3px rgba(201,168,76,0.08), 0 0 24px rgba(201,168,76,0.05);
          background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='rgba(201,168,76,0.6)' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
        }
        .rp-select option { background: #0f1a2e; color: #fff; }

        .rp-pw-toggle {
          position: absolute; right: 11px; background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.25); display: flex; align-items: center; padding: 4px;
          border-radius: 6px; transition: color 0.2s;
        }
        .rp-pw-toggle:hover { color: rgba(255,255,255,0.6); }

        .rp-section-divider {
          display: flex; align-items: center; gap: 10px;
          font-size: 10px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase;
          color: rgba(255,255,255,0.22); margin: 22px 0 16px;
        }
        .rp-section-divider::before, .rp-section-divider::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.07); }

        .rp-submit {
          width: 100%; padding: 14px; border: none; border-radius: 12px;
          font-size: 13px; font-weight: 700; font-family: 'Inter', sans-serif;
          letter-spacing: 1.5px; text-transform: uppercase; cursor: pointer; color: #06100f;
          background: linear-gradient(135deg, #a87a20 0%, #c9a84c 45%, #e8cc7a 100%);
          position: relative; overflow: hidden;
          transition: box-shadow 0.3s, transform 0.15s;
          box-shadow: 0 4px 24px rgba(201,168,76,0.2); margin-top: 6px;
        }
        .rp-submit::before {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%);
          transform: translateX(-100%); transition: transform 0.55s;
        }
        .rp-submit:hover:not(:disabled)::before { transform: translateX(150%); }
        .rp-submit:hover:not(:disabled) { box-shadow: 0 8px 36px rgba(201,168,76,0.5); transform: translateY(-1px); }
        .rp-submit:active:not(:disabled) { transform: translateY(0); }
        .rp-submit:disabled { opacity: 0.5; cursor: not-allowed; }

        .rp-spinner { display: inline-block; width: 15px; height: 15px; border: 2px solid rgba(6,16,15,0.3); border-top-color: #06100f; border-radius: 50%; animation: spin 0.65s linear infinite; vertical-align: middle; margin-right: 8px; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .rp-login-link { text-align: center; margin-top: 22px; font-size: 13px; color: rgba(255,255,255,0.4); }
        .rp-login-link a { color: var(--gold); font-weight: 600; text-decoration: none; position: relative; transition: opacity 0.2s; }
        .rp-login-link a::after { content: ''; position: absolute; bottom: -1px; left: 0; width: 0; height: 1px; background: var(--gold-light); transition: width 0.25s; }
        .rp-login-link a:hover { opacity: 0.85; }
        .rp-login-link a:hover::after { width: 100%; }

        .rp-right-footer { margin-top: 22px; font-size: 11px; color: rgba(255,255,255,0.16); letter-spacing: 0.3px; text-align: center; }
        .rp-right-footer .t { color: rgba(58,184,204,0.4); }
        .rp-right-footer .g { color: rgba(201,168,76,0.4); }

        @media (max-width: 960px) {
          .rp-shell { grid-template-columns: 1fr; }
          .rp-left { display: none; }
          .rp-divider { display: none; }
          .rp-right { border-left: none; border-top: 1px solid rgba(255,255,255,0.07); padding: 36px 28px; justify-content: flex-start; padding-top: 48px; }
        }
        @media (max-width: 520px) {
          .rp-row { grid-template-columns: 1fr; gap: 0; }
          .rp-right { padding: 32px 18px; }
        }
      `}</style>

      <ConstellationBg />

      <div className="rp-shell">
        <div className="rp-divider" />

        {/* ── Left: Branding ── */}
        <div className="rp-left">
          <div className={`rp-left-badge ${mounted ? 'in' : ''}`}>
            <div className="rp-badge-line" />
            <span className="rp-badge-text">Student Registration</span>
          </div>

          <div className={`rp-logo-pair ${mounted ? 'in' : ''}`}>
            <div className="rp-logo-ring rp-logo-ring--ssu">
              <div className="rp-logo-ring-disc">
                <img src="/assets/logos/ssu-logo.png" alt="SSU" />
              </div>
            </div>
            <div className="rp-logo-pair-sep" />
            <div className="rp-logo-ring rp-logo-ring--cas">
              <div className="rp-logo-ring-disc">
                <img src="/assets/logos/cas-logo.png" alt="CAS" />
              </div>
            </div>
          </div>

          <div className={`rp-left-heading ${mounted ? 'in' : ''}`}>
            <h1>Join the<br />Academic<br /><em>Community</em></h1>
            <p className="rp-left-desc">
              Register your student account for the Academic Grade Management System — College of Arts and Sciences, Main Campus.
            </p>
          </div>

          <div className={`rp-left-tags ${mounted ? 'in' : ''}`}>
            <span className="rp-tag teal">New Student</span>
            <span className="rp-tag gold">CAS Programs</span>
          </div>
        </div>

        {/* ── Right: Registration Form ── */}
        <div className="rp-right">
          <div className={`rp-right-inner ${mounted ? 'in' : ''}`}>
            <p className="rp-form-eyebrow">New Account</p>
            <h2 className="rp-form-title">Student Registration</h2>
            <p className="rp-form-sub">Create your account below. Your registration will be reviewed by your program's faculty before activation.</p>

            {error && (
              <div className="rp-error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            {success ? (
              <div className="rp-success">
                <div className="rp-success-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#28b464" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div>{success}</div>
                <div style={{ marginTop: '12px' }}>
                  <Link to="/login">← Back to Sign In</Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {/* Personal Info */}
                <div className="rp-field">
                  <label className="rp-label">Full Name <span className="req">*</span></label>
                  <div className={`rp-input-wrap ${focusedField === 'name' ? 'focused' : ''}`}>
                    <span className="rp-input-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                    </span>
                    <input className="rp-input" type="text" placeholder="Juan Dela Cruz"
                      value={form.name} onChange={e => updateField('name', e.target.value)}
                      onFocus={() => setFocusedField('name')} onBlur={() => setFocusedField(null)} required />
                  </div>
                </div>

                <div className="rp-row">
                  <div className="rp-field">
                    <label className="rp-label">Password <span className="req">*</span></label>
                    <div className={`rp-input-wrap ${focusedField === 'password' ? 'focused' : ''}`}>
                      <span className="rp-input-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      </span>
                      <input className="rp-input has-r" type={showPassword ? 'text' : 'password'}
                        placeholder="Min. 6 characters" value={form.password}
                        onChange={e => updateField('password', e.target.value)}
                        onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)} required />
                      <button type="button" className="rp-pw-toggle" onClick={() => setShowPassword(s => !s)}>
                        {showPassword ? (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                            <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        ) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="rp-field">
                    <label className="rp-label">Confirm Password <span className="req">*</span></label>
                    <div className={`rp-input-wrap ${focusedField === 'confirmPassword' ? 'focused' : ''}`}>
                      <span className="rp-input-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      </span>
                      <input className="rp-input has-r" type={showConfirm ? 'text' : 'password'}
                        placeholder="Re-enter password" value={form.confirmPassword}
                        onChange={e => updateField('confirmPassword', e.target.value)}
                        onFocus={() => setFocusedField('confirmPassword')} onBlur={() => setFocusedField(null)} required />
                      <button type="button" className="rp-pw-toggle" onClick={() => setShowConfirm(s => !s)}>
                        {showConfirm ? (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                            <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        ) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Academic Info */}
                <div className="rp-section-divider">Academic Information</div>

                <div className="rp-row">
                  <div className="rp-field">
                    <label className="rp-label">Student Number <span className="req">*</span></label>
                    <div className={`rp-input-wrap ${focusedField === 'student_no' ? 'focused' : ''}`}>
                      <span className="rp-input-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
                        </svg>
                      </span>
                      <input className="rp-input" type="text" placeholder="e.g. 2021-00123"
                        value={form.student_no} onChange={e => updateField('student_no', e.target.value)}
                        onFocus={() => setFocusedField('student_no')} onBlur={() => setFocusedField(null)} required />
                    </div>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}>
                      You'll use this to sign in — make sure it's correct.
                    </p>
                  </div>

                  <div className="rp-field">
                    <label className="rp-label">Program <span className="req">*</span></label>
                    <select className="rp-select" value={form.program}
                      onChange={e => updateField('program', e.target.value)}
                      onFocus={() => setFocusedField('program')} onBlur={() => setFocusedField(null)} required>
                      <option value="" disabled>Select your program</option>
                      {CAS_PROGRAMS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>

                <div className="rp-field">
                  <label className="rp-label">Student Type <span className="req">*</span></label>
                  <select className="rp-select" value={form.student_status}
                    onChange={e => updateField('student_status', e.target.value)}
                    onFocus={() => setFocusedField('student_status')} onBlur={() => setFocusedField(null)}>
                    <option value="Regular">Regular</option>
                    <option value="Irregular">Irregular</option>
                  </select>
                  {form.student_status === 'Irregular' && (
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}>
                      As an irregular student, check off every Year level you're taking classes in, then pick the Section and Semester for each — one of each per Year.
                    </p>
                  )}
                </div>

                {form.student_status === 'Irregular' ? (
                  <div className="rp-field">
                    <label className="rp-label">Year, Semester &amp; Section <span className="req">*</span></label>
                    <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '12px', background: 'rgba(255,255,255,0.03)' }}>
                      {[1, 2, 3, 4].map(yr => {
                        const entry = form.irregular_sections.find(p => p.year_level === yr);
                        const checked = !!entry;
                        return (
                          <div key={yr} style={{ padding: '8px 0', borderBottom: yr !== 4 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleIrregularYear(yr)}
                                style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#c9a84c' }}
                              />
                              Year {yr}
                            </label>
                            {checked && (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8, marginLeft: 22 }}>
                                <select
                                  className="rp-select"
                                  style={{ padding: '8px 28px 8px 10px', fontSize: 12 }}
                                  value={entry.semester}
                                  onChange={e => updateIrregularYearField(yr, 'semester', e.target.value)}
                                >
                                  <option value="" disabled>Select semester</option>
                                  {SEMESTERS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <select
                                  className="rp-select"
                                  style={{ padding: '8px 28px 8px 10px', fontSize: 12 }}
                                  value={entry.section}
                                  onChange={e => updateIrregularYearField(yr, 'section', e.target.value)}
                                >
                                  <option value="" disabled>Select section</option>
                                  {SECTIONS.map(s => <option key={s} value={s}>Section {s}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rp-row">
                    <div className="rp-field">
                      <label className="rp-label">Year Level <span className="req">*</span></label>
                      <select className="rp-select" value={form.year_level}
                        onChange={e => updateField('year_level', e.target.value)}
                        onFocus={() => setFocusedField('year_level')} onBlur={() => setFocusedField(null)} required>
                        <option value="" disabled>Select year</option>
                        <option value="1">1st Year</option>
                        <option value="2">2nd Year</option>
                        <option value="3">3rd Year</option>
                        <option value="4">4th Year</option>
                      </select>
                    </div>

                    {/* ── Section Dropdown ── */}
                    <div className="rp-field">
                      <label className="rp-label">Section</label>
                      <select className="rp-select" value={form.section}
                        onChange={e => updateField('section', e.target.value)}
                        onFocus={() => setFocusedField('section')} onBlur={() => setFocusedField(null)}>
                        <option value="">— No Section —</option>
                        {SECTIONS.map(s => <option key={s} value={s}>Section {s}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                <button type="submit" className="rp-submit" disabled={loading}>
                  {loading && <span className="rp-spinner" />}
                  {loading ? 'Creating Account…' : 'Create Account'}
                </button>
              </form>
            )}

            <p className="rp-login-link">
              Already have an account? <Link to="/login">Sign in</Link>
            </p>

            <p className="rp-right-footer">
              © 2025 <span className="t">Samar State University</span> · <span className="g">CAS</span> · All Rights Reserved
            </p>
          </div>
        </div>
      </div>
    </>
  );
}