import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Icons, formatPersonNameFirstLast } from '../common';
import { accountSetupService } from '../../services';
import toast from 'react-hot-toast';
import { checkPassword } from '../../utils/passwordRules';

// First-login account setup for students (accountSetupController on the
// backend). Shown by AppLayout INSTEAD of the app until account_setup_at is
// set: 1) confirm the imported identity, 2) replace the default password,
// 3) add an email (Gmail or SSU university email) and verify it with an emailed code. Closing the browser
// mid-way resumes at the right step (password_changed_at tells us where).
const STEPS = ['Your details', 'New password', 'Verify email'];
const RESEND_SECONDS = 60;
const DEFAULT_PASSWORD = '12345678';

export default function AccountSetupWizard() {
  const { user, updateUser, logout } = useAuth();
  // Names are stored "SURNAME, First M." — greet by the first name (the part
  // after the comma), never "LAGARTO,".
  const firstName = (() => {
    const n = String(user.name || '').trim();
    const given = n.includes(',') ? n.slice(n.indexOf(',') + 1).trim() : n;
    return given.split(/\s+/)[0] || n.replace(/,/g, '');
  })();
  const [step, setStep] = useState(user.password_changed_at ? 2 : 0);
  // Who to tell if the details shown are wrong — named, when known.
  const [contacts, setContacts] = useState(null);
  useEffect(() => {
    accountSetupService.getContacts().then(({ data }) => setContacts(data)).catch(() => {});
  }, []);
  const adviserName = contacts?.adviser?.name ? formatPersonNameFirstLast(contacts.adviser.name) : null;
  const addedByName = contacts?.added_by?.name ? formatPersonNameFirstLast(contacts.added_by.name) : null;
  const whoToTell = adviserName && addedByName && contacts.adviser.id === contacts.added_by.id
    ? <>your adviser, <b>{adviserName}</b>,</>
    : (
      <>
        your adviser{adviserName ? <> (<b>{adviserName}</b>)</> : null} or the faculty who added you{addedByName ? <> (<b>{addedByName}</b>)</> : null}
      </>
    );
  const [busy, setBusy] = useState(false);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);

  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fail = (err, fallback) => toast.error(err.response?.data?.message || fallback);

  const savePassword = async (e) => {
    e.preventDefault();
    if (!passwordValid) return toast.error(passwordError || 'Enter a new password.');
    if (!confirmMatches) return toast.error('Passwords do not match.');
    setBusy(true);
    try {
      const { data } = await accountSetupService.setPassword(password, confirm);
      updateUser(data.user);
      setStep(2);
    } catch (err) {
      fail(err, 'Could not save your password.');
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const { data } = await accountSetupService.requestEmailCode(email.trim());
      // Offline mode: no code can be e-mailed — the server saves the address
      // and finishes the setup right away.
      if (data.verified && data.user) {
        toast.success('Your account is all set!');
        updateUser(data.user);
        return;
      }
      setSentTo(data.email);
      setCode('');
      setCooldown(RESEND_SECONDS);
      toast.success(data.message);
    } catch (err) {
      fail(err, 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  };

  // Finish setup without an e-mail — it can be added later in Settings.
  const skipEmail = async () => {
    setBusy(true);
    try {
      const { data } = await accountSetupService.skipEmail();
      toast.success('Your account is all set!');
      updateUser(data.user);
    } catch (err) {
      fail(err, 'Could not finish the setup.');
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await accountSetupService.confirmEmailCode(code.trim());
      toast.success('Your account is all set!');
      updateUser(data.user);
    } catch (err) {
      fail(err, 'Could not verify the code.');
    } finally {
      setBusy(false);
    }
  };

  // Live checks — the student sees what's wrong while typing, and Save
  // stays disabled until both fields are right (the backend re-checks).
  const passwordError = !password ? null
    : password === DEFAULT_PASSWORD ? 'That is the default password. Choose a different one.'
      : null;
  // A strong password: every rule in the checklist below must pass.
  const rules = checkPassword(password);
  const passedCount = rules.filter((r) => r.ok).length;
  const passwordValid = !!password && !passwordError && passedCount === rules.length;
  const strength = !password ? null : passedCount === rules.length ? 'Strong' : passedCount >= 3 ? 'Medium' : 'Weak';
  const strengthColor = { Strong: 'bg-green-500', Medium: 'bg-amber-500', Weak: 'bg-red-500' }[strength];
  const strengthText = { Strong: 'text-green-600', Medium: 'text-amber-600', Weak: 'text-red-500' }[strength];
  const confirmMatches = !!confirm && confirm === password;
  const confirmError = confirm && !confirmMatches ? 'Passwords do not match.' : null;

  return (
    // Blocking pop-up over the student's own dashboard (AppLayout renders it
    // on top of the page) — no close button, no backdrop dismiss.
    <div className="fixed inset-0 z-[2100] bg-[#060d1c]/60 backdrop-blur-[3px] overflow-y-auto animate-fadeIn">
      <div className="min-h-full flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden animate-slideUp">
        {/* Same navy gradient as the dashboard's own hero banner behind it. */}
        <div className="bg-gradient-to-r from-navy-dark via-navy to-navy-light text-white px-6 pt-6 pb-5">
          <div className="flex items-center gap-3 mb-5">
            <img src="/assets/logos/cas-seal-real.png" alt="College of Arts and Sciences" className="w-11 h-11 rounded-full object-contain bg-white p-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold leading-tight">Welcome, {firstName}!</h1>
              <p className="text-xs opacity-75 mt-0.5">Set up your account.</p>
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex items-center justify-between">
            {STEPS.map((label, i) => (
              <div key={label} className={`flex items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${i < step ? 'bg-green-500 text-white' : i === step ? 'bg-gold text-white ring-4 ring-white/20' : 'bg-white/15 text-white/60'}`}>
                    {i < step ? <Icons.Check className="w-4 h-4" /> : i + 1}
                  </span>
                  <span className={`text-[11px] font-medium ${i === step ? 'text-white' : 'text-white/60'}`}>{label}</span>
                </div>
                {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-2 mb-4 rounded ${i < step ? 'bg-green-400' : 'bg-white/20'}`} />}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="p-6">
            {step === 0 && (
              <>
                <h2 className="text-lg font-bold text-navy dark:text-sky-300 mb-4">Is this you?</h2>
                <dl className="rounded-xl border border-gray-200 bg-gray-50/90 dark:bg-gray-800/50 dark:border-gray-700 divide-y divide-gray-200/70 dark:divide-gray-700/60 mb-5 shadow-xs">
                  {[
                    ['Name', user.name],
                    ['Student ID No.', user.student_no],
                    ['Program', user.program],
                    ['Year & Section', `Year ${user.year_level}${user.section ? ` · Section ${user.section}` : ''}`],
                  ].map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[140px_1fr] items-center gap-4 px-5 py-3.5">
                      <dt className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</dt>
                      <dd className="font-bold text-gray-900 dark:text-gray-100 text-[15px] m-0 leading-snug">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
                  Something wrong? Continue for now and tell {whoToTell} so they can correct it.
                </p>
                <button className="btn btn-primary w-full justify-center py-3.5 text-base font-semibold shadow-md" onClick={() => setStep(1)}>
                  <Icons.Check className="w-5 h-5" /> Yes, this is me
                </button>
              </>
            )}

            {step === 1 && (
              <form onSubmit={savePassword}>
                <h2 className="text-base font-semibold text-navy mb-1">Create your own password</h2>
                <p className="text-[13px] text-gray-500 mb-4">You signed in with the default password. Replace it so only you can access your account.</p>
                <label className="form-label">New password</label>
                <div className="relative mb-1">
                  <input
                    className={`form-input pr-10 ${passwordError || (password && !passwordValid) ? '!border-red-400' : passwordValid ? '!border-green-400' : ''}`}
                    type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password"
                  />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon" onClick={() => setShowPw((v) => !v)} title={showPw ? 'Hide' : 'Show'}>
                    {showPw ? <Icons.EyeOff /> : <Icons.Eye />}
                  </button>
                </div>
                {/* Strength meter + what a strong password needs, ticked off live. */}
                <div className="mb-3">
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex gap-1 flex-1">
                      {rules.map((r, i) => (
                        <span key={r.key} className={`h-1.5 flex-1 rounded-full ${password && i < passedCount ? strengthColor : 'bg-gray-200'}`} />
                      ))}
                    </div>
                    <span className={`text-xs font-semibold min-w-[52px] text-right ${strength ? strengthText : 'text-gray-400'}`}>{strength || 'Strength'}</span>
                  </div>
                  {passwordError && (
                    <p className="text-xs mt-1.5 flex items-center gap-1 text-red-500"><Icons.X className="w-3.5 h-3.5 flex-shrink-0" />{passwordError}</p>
                  )}
                  {/* Only what's still missing — a rule disappears once it's met. */}
                  {rules.some((r) => !r.ok) && (
                    <ul className="mt-2 space-y-0.5">
                      {rules.filter((r) => !r.ok).map((r) => (
                        <li key={r.key} className="text-xs flex items-center gap-1.5 text-gray-500">
                          <span className="w-3.5 h-3.5 flex-shrink-0 inline-flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-gray-300" /></span>
                          {r.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <label className="form-label">Confirm new password</label>
                <input
                  className={`form-input mb-1 ${confirmError ? '!border-red-400' : confirmMatches && passwordValid ? '!border-green-400' : ''}`}
                  type={showPw ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password"
                  placeholder="Type your new password again"
                />
                <p className={`text-xs mb-5 flex items-center gap-1 min-h-[16px] ${confirmError ? 'text-red-500' : 'text-green-600'}`}>
                  {confirmError && <><Icons.X className="w-3.5 h-3.5 flex-shrink-0" />{confirmError}</>}
                  {confirmMatches && passwordValid && <><Icons.Check className="w-3.5 h-3.5 flex-shrink-0" />Passwords match.</>}
                </p>
                <button type="submit" className="btn btn-primary w-full justify-center py-3" disabled={busy || !passwordValid || !confirmMatches}>{busy ? 'Saving...' : 'Save password'}</button>
              </form>
            )}

            {step === 2 && !sentTo && (
              <form onSubmit={sendCode}>
                <h2 className="text-base font-semibold text-navy mb-1">Add your email</h2>
                <p className="text-[13px] text-gray-500 mb-4">Your Gmail or your SSU university email — we'll use it if you forget your password. You can also add it later.</p>
                <label className="form-label">Gmail or university email <span className="text-gray-400 font-normal normal-case">(optional)</span></label>
                <input className="form-input mb-5" type="email" placeholder="juandelacruz@gmail.com or jdelacruz@ssu.edu.ph" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
                <button type="submit" className="btn btn-primary w-full justify-center" disabled={busy || !email.trim()}>{busy ? 'Sending...' : 'Send verification code'}</button>
                {/* The e-mail is optional — the account works without it. */}
                <button type="button" className="btn btn-outline w-full justify-center mt-2.5" onClick={skipEmail} disabled={busy}>
                  Skip for now — I'll add it later
                </button>
                <p className="text-[11px] text-gray-400 mt-2 text-center">Without an email you can't use "Forgot password". Add one any time in Settings.</p>
              </form>
            )}

            {step === 2 && sentTo && (
              <form onSubmit={confirmCode}>
                <h2 className="text-base font-semibold text-navy mb-1">Check your email</h2>
                <p className="text-[13px] text-gray-500 mb-4">
                  We sent a 6-digit code to <b className="text-gray-700">{sentTo}</b>. It expires in 10 minutes.
                </p>
                <input
                  className="form-input text-center text-2xl tracking-[0.5em] font-bold mb-4"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                  placeholder="••••••"
                />
                <button type="submit" className="btn btn-primary w-full justify-center mb-3" disabled={busy || code.length !== 6}>{busy ? 'Verifying...' : 'Verify & finish'}</button>
                <div className="flex items-center justify-between text-xs">
                  <button type="button" className="text-navy font-medium bg-transparent border-none cursor-pointer disabled:text-gray-400 disabled:cursor-default" onClick={() => sendCode()} disabled={busy || cooldown > 0}>
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                  </button>
                  <button type="button" className="text-gray-500 bg-transparent border-none cursor-pointer" onClick={() => { setSentTo(null); setCode(''); }}>
                    Change email
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
          <span>Signed in as <b className="text-gray-600">{user.student_no}</b></span>
          <button className="text-gray-500 hover:text-red-600 bg-transparent border-none cursor-pointer flex items-center gap-1" onClick={logout}>
            <Icons.LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
