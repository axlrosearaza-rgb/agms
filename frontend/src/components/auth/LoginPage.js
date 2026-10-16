import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import ConstellationBg from './ConstellationBg';
import { yearAbbrOf } from '../../utils/semesterLabels';

const ROLE_ROUTES = {
  Admin: '/admin',
  Chairperson: '/chairperson',
  Faculty: '/faculty',
  Student: '/student',
};


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

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --gold:        #c9a84c;
          --gold-light:  #f3df95;
          --gold-dim:    rgba(201,168,76,0.18);
          --teal:        #3ab8cc;
          --teal-light:  #62d4e6;
          --navy:        #060d1c;
        }

        body {
          background: var(--navy);
          font-family: 'Inter', sans-serif;
          min-height: 100vh;
          overflow-x: hidden;
        }

        /* ── Centered Full Page ── */
        .lp-page {
          min-height: 100vh;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: clamp(24px, 3.5vh, 44px) 20px clamp(32px, 5vh, 60px);
          position: relative;
          z-index: 1;
        }

        /* Ambient soft illumination */
        .lp-page::before {
          content: '';
          position: absolute;
          width: clamp(480px, 60vw, 800px);
          height: clamp(480px, 60vw, 800px);
          border-radius: 50%;
          background: radial-gradient(circle, rgba(58, 184, 204, 0.1) 0%, rgba(201, 168, 76, 0.05) 45%, transparent 70%);
          top: 32%;
          left: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
          z-index: 0;
        }

        .lp-container {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 780px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        /* ── Top Branding (Majestic, Symmetrical & Grand) ── */
        .lp-branding {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          width: 100%;
        }

        .lp-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: clamp(14px, 2vh, 22px);
          opacity: 0;
          transform: translateY(-10px);
          transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s;
        }
        .lp-badge.in { opacity: 1; transform: translateY(0); }

        .lp-badge-line-left {
          width: 46px; height: 1.2px;
          background: linear-gradient(90deg, transparent, var(--teal));
          border-radius: 2px;
        }
        .lp-badge-line-right {
          width: 46px; height: 1.2px;
          background: linear-gradient(90deg, var(--teal), transparent);
          border-radius: 2px;
        }
        .lp-badge-text {
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 4px;
          text-transform: uppercase;
          color: var(--teal-light);
          text-shadow: 0 0 12px rgba(58, 184, 204, 0.5);
        }

        /* Logo pair - cohesive together, with generous space from below */
        .lp-logo-pair {
          display: flex;
          justify-content: center;
          align-items: center;
          margin-bottom: clamp(24px, 3.6vh, 40px);
          opacity: 0;
          transform: translateY(10px);
          transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s;
        }
        .lp-logo-pair.in { opacity: 1; transform: translateY(0); }

        .lp-logo-ring {
          position: relative;
          width: clamp(66px, 6.2vw, 78px);
          height: clamp(66px, 6.2vw, 78px);
          flex-shrink: 0;
        }
        .lp-logo-ring::before {
          content: '';
          position: absolute;
          inset: -4.5px;
          border-radius: 50%;
          border: 1.4px solid var(--halo-color);
          opacity: 0.7;
          pointer-events: none;
        }
        .lp-logo-ring--ssu {
          --halo-color: rgba(58,184,204,0.55);
          --ring-color: #3ab8cc;
        }
        .lp-logo-ring--cas {
          --halo-color: rgba(201,168,76,0.55);
          --ring-color: #c9a84c;
        }
        .lp-logo-ring-disc {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          box-shadow:
            0 0 0 2.5px var(--ring-color),
            0 10px 26px rgba(0, 0, 0, 0.65),
            0 0 18px var(--halo-color);
        }
        .lp-logo-ring-disc img {
          width: 90%;
          height: 90%;
          object-fit: contain;
          border-radius: 50%;
        }

        .lp-logo-pair-sep {
          width: 1.5px;
          height: clamp(36px, 4vh, 44px);
          margin: 0 clamp(14px, 1.8vw, 18px);
          flex-shrink: 0;
          background: linear-gradient(
            to bottom,
            transparent,
            rgba(201, 168, 76, 0.65) 30%,
            rgba(201, 168, 76, 0.65) 70%,
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
          background: var(--gold);
          box-shadow: 0 0 8px var(--gold);
        }

        /* Heading - bigger & bolder */
        .lp-heading {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          opacity: 0;
          transform: translateY(10px);
          transition: all 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.3s;
        }
        .lp-heading.in { opacity: 1; transform: translateY(0); }

        .lp-title {
          font-family: 'Playfair Display', serif;
          font-size: clamp(36px, 4.1vw, 52px);
          font-weight: 800;
          line-height: 1.18;
          color: #ffffff;
          letter-spacing: -0.5px;
          text-align: center;
          text-shadow: 0 4px 28px rgba(0, 0, 0, 0.6);
        }
        .lp-title em {
          font-style: italic;
          font-weight: 700;
          background: linear-gradient(135deg, #fceda7 0%, #c9a84c 50%, #e8cc7a 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .lp-desc {
          margin-top: clamp(16px, 2.2vh, 24px);
          font-size: clamp(16px, 1.45vw, 18.5px);
          line-height: 1.5;
          color: rgba(255, 255, 255, 0.84);
          font-weight: 400;
          letter-spacing: 0.5px;
          max-width: 600px;
          text-align: center;
        }

        /* ── Bottom Corner Tags (Left & Right Side Below) ── */
        .lp-bottom-tags {
          position: fixed;
          bottom: clamp(16px, 2.5vh, 26px);
          left: clamp(20px, 3vw, 36px);
          right: clamp(20px, 3vw, 36px);
          display: flex;
          justify-content: space-between;
          align-items: center;
          pointer-events: none;
          z-index: 10;
          opacity: 0;
          transform: translateY(8px);
          transition: all 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.5s;
        }
        .lp-bottom-tags.in {
          opacity: 1;
          transform: translateY(0);
        }
        .lp-bottom-tags .lp-tag {
          pointer-events: auto;
        }

        .lp-tag {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          height: 38px;
          padding: 0 20px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 550;
          letter-spacing: 0.25px;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          white-space: nowrap;
          box-sizing: border-box;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .lp-tag:hover { transform: translateY(-1px); }
        .lp-tag--sem {
          background: rgba(201, 168, 76, 0.08);
          border: 1px solid rgba(201, 168, 76, 0.35);
          color: var(--gold-light);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        }
        .lp-tag--ssu {
          background: rgba(58, 184, 204, 0.08);
          border: 1px solid rgba(58, 184, 204, 0.35);
          color: var(--teal-light);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        }
        .lp-tag-dot {
          width: 7.5px;
          height: 7.5px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .sem-dot {
          background: var(--gold);
          box-shadow: 0 0 10px var(--gold);
        }
        .ssu-dot {
          background: var(--teal);
          box-shadow: 0 0 10px var(--teal);
        }

        /* ── Compact Login Form (Vertical: Username, Password, Sign In) ── */
        .lp-auth-section {
          width: 100%;
          max-width: 360px;
          margin-top: clamp(26px, 3.8vh, 40px);
          display: flex;
          flex-direction: column;
          align-items: center;
          opacity: 0;
          transform: translateY(12px);
          transition: all 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.45s;
        }
        .lp-auth-section.in {
          opacity: 1;
          transform: translateY(0);
        }

        .lp-compact-error {
          width: 100%;
          background: rgba(220, 50, 50, 0.14);
          border: 1px solid rgba(220, 50, 50, 0.35);
          border-left: 3px solid #f87171;
          color: #fca5a5;
          padding: 8px 14px;
          border-radius: 9px;
          font-size: 12px;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          text-align: left;
          animation: shake 0.45s ease;
        }

        .lp-compact-fields {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 13px;
          margin-bottom: 6px;
        }

        .lp-compact-input-wrap {
          position: relative;
          width: 100%;
          height: 46px;
          display: flex;
          align-items: center;
          box-sizing: border-box;
          border-radius: 999px;
          transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .lp-compact-input-wrap:hover {
          transform: translateY(-1px);
        }
        .lp-compact-input-wrap.focused {
          transform: translateY(-1.5px);
        }

        .lp-compact-icon {
          position: absolute;
          left: 16px;
          color: rgba(98, 212, 230, 0.75);
          filter: drop-shadow(0 0 5px rgba(58, 184, 204, 0.45));
          display: flex;
          align-items: center;
          pointer-events: none;
          z-index: 2;
          transition: color 0.25s ease, filter 0.25s ease, transform 0.25s ease;
        }
        .lp-compact-input-wrap:hover .lp-compact-icon {
          color: #62d4e6;
          filter: drop-shadow(0 0 8px rgba(58, 184, 204, 0.8));
          transform: scale(1.08);
        }
        .lp-compact-input-wrap.focused .lp-compact-icon {
          color: #fceda7;
          filter: drop-shadow(0 0 10px rgba(201, 168, 76, 0.95)) drop-shadow(0 0 3px rgba(255, 255, 255, 0.5));
          transform: scale(1.15);
        }

        .lp-compact-input {
          width: 100%;
          height: 100%;
          padding: 0 18px 0 46px;
          background: linear-gradient(135deg, rgba(14, 28, 56, 0.8) 0%, rgba(8, 18, 38, 0.88) 100%);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1.2px solid rgba(58, 184, 204, 0.32);
          border-radius: 999px;
          font-size: 13.5px;
          font-family: 'Inter', sans-serif;
          font-weight: 500;
          color: #ffffff;
          outline: none;
          box-sizing: border-box;
          box-shadow:
            0 4px 18px rgba(0, 0, 0, 0.45),
            0 0 16px rgba(58, 184, 204, 0.14),
            inset 0 1px 1.5px rgba(255, 255, 255, 0.18),
            inset 0 0 12px rgba(58, 184, 204, 0.05);
          transition: border-color 0.28s ease, background 0.28s ease, box-shadow 0.28s ease, text-shadow 0.28s ease;
        }
        .lp-compact-input::placeholder {
          color: rgba(200, 222, 255, 0.46);
          font-size: 13px;
          font-weight: 400;
          letter-spacing: 0.2px;
          transition: color 0.25s ease;
        }
        .lp-compact-input:hover {
          border-color: rgba(58, 184, 204, 0.68);
          background: linear-gradient(135deg, rgba(18, 36, 70, 0.86) 0%, rgba(10, 22, 46, 0.92) 100%);
          box-shadow:
            0 6px 26px rgba(0, 0, 0, 0.55),
            0 0 24px rgba(58, 184, 204, 0.32),
            0 0 4px rgba(58, 184, 204, 0.5),
            inset 0 1px 2px rgba(255, 255, 255, 0.25),
            inset 0 0 14px rgba(58, 184, 204, 0.08);
        }
        .lp-compact-input:hover::placeholder {
          color: rgba(200, 222, 255, 0.62);
        }
        .lp-compact-input:focus {
          border-color: #f3df95;
          background: linear-gradient(135deg, rgba(20, 42, 80, 0.94) 0%, rgba(10, 22, 48, 0.98) 100%);
          box-shadow:
            0 0 0 3.5px rgba(201, 168, 76, 0.3),
            0 0 32px rgba(201, 168, 76, 0.48),
            0 0 8px rgba(201, 168, 76, 0.75),
            0 10px 36px rgba(0, 0, 0, 0.65),
            inset 0 1px 2px rgba(255, 255, 255, 0.35),
            inset 0 0 18px rgba(201, 168, 76, 0.12);
          color: #ffffff;
          text-shadow: 0 0 8px rgba(255, 255, 255, 0.3);
        }
        .lp-compact-input.has-r {
          padding-right: 46px;
        }

        .lp-compact-pw-toggle {
          position: absolute;
          right: 14px;
          background: transparent;
          border: none;
          cursor: pointer;
          color: rgba(200, 225, 255, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px;
          border-radius: 50%;
          z-index: 2;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .lp-compact-pw-toggle:hover {
          color: #fceda7;
          background: rgba(201, 168, 76, 0.16);
          filter: drop-shadow(0 0 8px rgba(201, 168, 76, 0.85));
          transform: scale(1.12);
        }

        .lp-compact-meta {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px;
          margin-top: 8px;
          margin-bottom: 18px;
          font-size: 12px;
          box-sizing: border-box;
        }
        .lp-compact-remember {
          display: flex;
          align-items: center;
          gap: 8px;
          color: rgba(215, 230, 255, 0.78);
          cursor: pointer;
          user-select: none;
          font-weight: 500;
          font-size: 12px;
          transition: color 0.2s ease, text-shadow 0.2s ease;
        }
        .lp-compact-remember:hover {
          color: #ffffff;
          text-shadow: 0 0 8px rgba(255, 255, 255, 0.45);
        }
        .lp-compact-remember input[type="checkbox"] {
          accent-color: #d4af37;
          width: 14px;
          height: 14px;
          cursor: pointer;
          filter: drop-shadow(0 0 6px rgba(201, 168, 76, 0.6));
          transition: transform 0.2s ease;
        }
        .lp-compact-remember input[type="checkbox"]:hover {
          transform: scale(1.1);
        }
        .lp-compact-forgot {
          color: #f3df95;
          text-decoration: none;
          font-weight: 600;
          font-size: 12px;
          letter-spacing: 0.25px;
          text-shadow: 0 0 10px rgba(201, 168, 76, 0.45);
          position: relative;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .lp-compact-forgot:hover {
          color: #ffffff;
          text-shadow: 0 0 16px rgba(201, 168, 76, 0.95), 0 0 4px #ffffff;
          transform: translateX(1px);
        }

        /* ── Keyframe Animations ── */
        @keyframes pulseGlow {
          0%, 100% {
            box-shadow:
              0 6px 26px rgba(201, 168, 76, 0.42),
              0 0 0 0 rgba(201, 168, 76, 0.35);
          }
          50% {
            box-shadow:
              0 10px 38px rgba(201, 168, 76, 0.65),
              0 0 0 10px rgba(201, 168, 76, 0);
          }
        }

        @keyframes shimmerSlide {
          0% {
            transform: translateX(-140%) skewX(-22deg);
          }
          32%, 100% {
            transform: translateX(240%) skewX(-22deg);
          }
        }

        @keyframes floatBob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-6px); }
          75% { transform: translateX(6px); }
        }

        /* ── Sign In Button ── */
        .lp-portal-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 12.5px 44px;
          border-radius: 999px;
          border: none;
          cursor: pointer;
          background: linear-gradient(135deg, #d4af37 0%, #faeab2 46%, #c59b27 100%);
          background-size: 200% auto;
          color: #06101e;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 750;
          letter-spacing: 2px;
          text-transform: uppercase;
          overflow: hidden;
          box-shadow:
            0 6px 26px rgba(201, 168, 76, 0.42),
            0 1px 3px rgba(0, 0, 0, 0.4);
          animation: pulseGlow 3s ease-in-out infinite, floatBob 4.2s ease-in-out infinite;
          transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .lp-portal-btn:hover:not(:disabled) {
          transform: translateY(-2px) scale(1.03);
          box-shadow: 0 10px 38px rgba(201, 168, 76, 0.65);
          color: #02060e;
        }
        .lp-portal-btn:active:not(:disabled) {
          transform: translateY(0) scale(0.98);
          box-shadow: 0 4px 16px rgba(201, 168, 76, 0.3);
        }
        .lp-portal-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          animation: none;
        }

        .lp-portal-btn-label { position: relative; z-index: 1; }
        .lp-portal-btn-icon {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.28s ease;
        }
        .lp-portal-btn:hover:not(:disabled) .lp-portal-btn-icon { transform: translateX(4px); }
        .lp-btn-shimmer {
          position: absolute;
          top: 0; left: 0; width: 55%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.65), transparent);
          animation: shimmerSlide 3.4s ease-in-out infinite;
          pointer-events: none;
        }

        .lp-spinner {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid rgba(6, 16, 15, 0.3);
          border-top-color: #06100f;
          border-radius: 50%;
          animation: spin 0.65s linear infinite;
          vertical-align: middle;
          margin-right: 8px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Footer */
        .lp-footer {
          margin-top: 22px;
          text-align: center;
        }
        .lp-footer-links {
          display: flex;
          gap: 12px;
          justify-content: center;
          align-items: center;
          margin-bottom: 6px;
        }
        .lp-footer-links a {
          color: rgba(255, 255, 255, 0.4);
          font-size: 11px;
          text-decoration: none;
          transition: color 0.2s;
        }
        .lp-footer-links a:hover {
          color: rgba(255, 255, 255, 0.85);
        }
        .lp-footer-sep {
          color: rgba(255, 255, 255, 0.2);
          font-size: 11px;
        }
        .lp-footer-copy {
          font-size: 10.5px;
          color: rgba(255, 255, 255, 0.28);
          letter-spacing: 0.25px;
        }
        .lp-footer-copy .t { color: rgba(58, 184, 204, 0.7); }
        .lp-footer-copy .g { color: rgba(201, 168, 76, 0.7); }

        /* ── Responsive ── */
        @media (max-width: 860px), (max-height: 740px) {
          .lp-bottom-tags {
            position: static;
            width: 100%;
            max-width: 640px;
            margin-top: 24px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            pointer-events: auto;
          }
        }
        @media (max-width: 620px) {
          .lp-bottom-tags {
            flex-direction: column;
            align-items: center;
            gap: 10px;
          }
          .lp-tag {
            width: 100%;
            max-width: 325px;
          }
        }

        @media (max-width: 520px) {
          .lp-page {
            padding: 20px 14px 16px;
          }
          .lp-badge {
            gap: 10px;
            margin-bottom: 14px;
          }
          .lp-badge-line-left,
          .lp-badge-line-right {
            width: 32px;
          }
          .lp-badge-text {
            font-size: 10px;
            letter-spacing: 3px;
          }
          .lp-logo-ring {
            width: 56px;
            height: 56px;
          }
          .lp-logo-ring-disc {
            width: 100%;
            height: 100%;
          }
          .lp-logo-pair {
            margin-bottom: 16px;
          }
          .lp-logo-pair-sep {
            height: 28px;
            margin: 0 8px;
          }
          .lp-title { font-size: 32px; }
          .lp-desc { font-size: 13.5px; }
          .lp-portal-btn {
            padding: 12px 36px;
            font-size: 13px;
          }
        }
      `}</style>

      <ConstellationBg />

      <div className="lp-page">
        <div className="lp-container">
          {/* ── Top: Institutional Branding ── */}
          <div className="lp-branding">
            <div className={`lp-badge ${mounted ? 'in' : ''}`}>
              <div className="lp-badge-line-left" />
              <span className="lp-badge-text">Portal</span>
              <div className="lp-badge-line-right" />
            </div>

            {/* ── Logo pair ── */}
            <div className={`lp-logo-pair ${mounted ? 'in' : ''}`}>
              <div className="lp-logo-ring lp-logo-ring--ssu">
                <div className="lp-logo-ring-disc">
                  <img src="/assets/logos/ssu-logo.png" alt="Samar State University" />
                </div>
              </div>

              <div className="lp-logo-pair-sep" />

              <div className="lp-logo-ring lp-logo-ring--cas">
                <div className="lp-logo-ring-disc">
                  <img src="/assets/logos/cas-logo.png" alt="College of Arts & Sciences" />
                </div>
              </div>
            </div>

            <div className={`lp-heading ${mounted ? 'in' : ''}`}>
              <h1 className="lp-title">
                Academic Grade<br />
                <em>Management System</em>
              </h1>
              <p className="lp-desc">
                College of Arts &amp; Sciences
              </p>
            </div>
          </div>

          {/* ── Compact Integrated Login Form + Sign In Button ── */}
          <div className={`lp-auth-section ${mounted ? 'in' : ''}`}>
            <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {error && (
                <div className="lp-compact-error">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              <div className="lp-compact-fields">
                <div className={`lp-compact-input-wrap ${focusedField === 'identifier' ? 'focused' : ''}`}>
                  <span className="lp-compact-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                  </span>
                  <input
                    className="lp-compact-input"
                    type="text"
                    placeholder="Username or Student ID Number"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    onFocus={() => setFocusedField('identifier')}
                    onBlur={() => setFocusedField(null)}
                    required
                  />
                </div>

                <div className={`lp-compact-input-wrap ${focusedField === 'password' ? 'focused' : ''}`}>
                  <span className="lp-compact-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </span>
                  <input
                    className="lp-compact-input has-r"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    required
                  />
                  <button
                    type="button"
                    className="lp-compact-pw-toggle"
                    onClick={() => setShowPassword(s => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="lp-compact-meta">
                <label className="lp-compact-remember">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                  <span>Remember me</span>
                </label>
                <Link to="/forgot-password" className="lp-compact-forgot">Forgot password?</Link>
              </div>

              <button
                type="submit"
                className="lp-portal-btn"
                id="portal-signin-btn"
                disabled={loading}
                aria-label="Proceed to Sign In"
              >
                {loading && <span className="lp-spinner" />}
                <span className="lp-portal-btn-label">{loading ? 'Signing In…' : 'Sign In'}</span>
                {!loading && (
                  <span className="lp-portal-btn-icon">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </span>
                )}
                <div className="lp-btn-shimmer" />
              </button>
            </form>

            <div className="lp-footer">
              <div className="lp-footer-links">
                <Link to="/privacy-policy">Privacy Policy</Link>
                <span className="lp-footer-sep">·</span>
                <Link to="/terms">Terms and Conditions</Link>
                <span className="lp-footer-sep">·</span>
                <Link to="/contact">Contact Us</Link>
              </div>
              <p className="lp-footer-copy">
                © 2026 <span className="t">Samar State University</span> · <span className="g">CAS</span> · All Rights Reserved
              </p>
            </div>
          </div>
        </div>

        {/* ── Left and Right Side Below Tags ── */}
        <div className={`lp-bottom-tags ${mounted ? 'in' : ''}`}>
          <span className="lp-tag lp-tag--sem">
            <span className="lp-tag-dot sem-dot" />
            {currentSemester ? `${currentSemester.term || currentSemester.name} · ${yearAbbrOf(currentSemester)} ${currentSemester.academic_year}` : 'First Semester · S.Y. 2026-2027'}
          </span>
          <span className="lp-tag lp-tag--ssu">
            <span className="lp-tag-dot ssu-dot" />
            Samar State University — Main Campus
          </span>
        </div>
      </div>
    </>
  );
}