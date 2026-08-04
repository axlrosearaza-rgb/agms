import { useState } from 'react';

// ============ ICONS (SVG components) ============
export const Icons = {
  Dashboard: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  Users: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Book: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  FileText: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  BarChart: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  Settings: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  Bell: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  ChevronDown: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>,
  ChevronUp: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15"/></svg>,
  ChevronRight: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>,
  ArrowLeft: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  Edit: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Trash: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  Eye: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  EyeOff: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>,
  Lock: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  Search: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Plus: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Check: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>,
  X: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Flag: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>,
  Send: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  LogOut: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  Menu: (p) => <svg {...p} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  Save: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>,
  User: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Shield: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Award: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>,
  AlertTriangle: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  // ✅ Added missing icons
  AlertCircle: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  Clock: (p) => <svg {...p} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Loader: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>,
  MessageSquare: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>,
  VolumeX: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>,
  Volume2: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>,
};

// ============ ROLE DISPLAY LABEL ============
// The stored `role` value stays 'Instructor' everywhere (DB, routes, authorize()
// checks) — this only controls what users see. Instructor accounts are shown as
// "Faculty" throughout the UI.
const ROLE_LABELS = { Instructor: 'Faculty' };
export const roleLabel = (role) => ROLE_LABELS[role] || role;

// ============ AVATAR ============
export function Avatar({ letter, className = '', size = 'w-9 h-9 text-sm' }) {
  return (
    <div className={`${size} rounded-full flex items-center justify-center font-semibold ${className}`}>
      {letter}
    </div>
  );
}

// ============ BADGE ============
export function Badge({ children, variant = 'green', className = '' }) {
  return <span className={`badge badge-${variant} ${className}`}>{children}</span>;
}

// ============ PROGRAM COLOR CODING ============
// System-wide reference palette: BSIT = Light Blue (#90D5FF), Psychology = Lavender
// (#B57EDC), BSIS = Light Red (#FF7F7F), Statistics = Golden Yellow (#FFDF00).
// Matches on program (e.g. "Bachelor of Science in Information Technology") or
// department (e.g. "Information Technology") strings alike — check the more specific
// "Information Technology"/"Information Systems" phrases before any looser match,
// since both share the word "Information".
// Note: each program gets its own dedicated variant name ("it", "is-red",
// "golden-yellow", "lavender") rather than reusing generic Badge variants like
// "blue"/"red"/"yellow" — those are already used all over the app for unrelated
// things (section badges, status badges, unit counts), so reusing them here would
// mean any future restyle of the *program* color accidentally restyles those too.
export const programColorVariant = (value) => {
  if (!value) return 'gray';
  const v = value.toLowerCase();
  if (v.includes('information technology')) return 'it';
  if (v.includes('psychology')) return 'lavender';
  if (v.includes('information systems')) return 'is-red';
  if (v.includes('statistics')) return 'golden-yellow';
  return 'gray';
};

// Abbreviated label for tight spaces (sidebar, chips) where the full program name
// ("Bachelor of Science in Information Technology") would overflow.
export const programShortLabel = (value) => {
  if (!value) return '';
  const v = value.toLowerCase();
  if (v.includes('information technology')) return 'BSIT';
  if (v.includes('psychology')) return 'Psychology';
  if (v.includes('information systems')) return 'BSIS';
  if (v.includes('statistics')) return 'Statistics';
  return value;
};

export function ProgramBadge({ program, short = false, size = 'sm' }) {
  if (!program) return <span className="text-gray-400">—</span>;
  const sizeClass = size === 'lg' ? 'text-base px-4 py-1.5 font-bold' : '';
  return <Badge variant={programColorVariant(program)} className={sizeClass}>{short ? programShortLabel(program) : program}</Badge>;
}

// Solid-dot version of the same palette, for use as a small color accent inside
// dark/colored headers where a light-background Badge pill wouldn't read well.
const PROGRAM_DOT_CLASS = {
  it: 'bg-[#90D5FF]',
  lavender: 'bg-[#B57EDC]',
  'is-red': 'bg-[#FF7F7F]',
  'golden-yellow': 'bg-[#FFDF00]',
  gray: 'bg-gray-400',
};
export function ProgramDot({ program, className = '' }) {
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 inline-block ${PROGRAM_DOT_CLASS[programColorVariant(program)]} ${className}`} />;
}

// Border-color equivalent of the same palette, for accent stripes (e.g. a sidebar edge).
export const PROGRAM_BORDER_CLASS = {
  it: 'border-[#90D5FF]',
  lavender: 'border-[#B57EDC]',
  'is-red': 'border-[#FF7F7F]',
  'golden-yellow': 'border-[#FFDF00]',
  gray: 'border-gray-200',
};

// Soft header-bar treatment (bg/text/border) in the same palette, for section
// headers like the Class Record's Midterm/Finals bars. `text` is always white here
// because these bars are actually painted with PROGRAM_CASCADE below — a gradient
// that's dark at the left (where the title sits) for every variant — not this `bg`,
// which is unused for the cascade but kept for any other flat-background consumer.
const PROGRAM_HEADER_CLASS = {
  it: { bg: 'bg-blue-600', text: 'text-white', border: 'border-blue-700' },
  lavender: { bg: 'bg-pink-50', text: 'text-white', border: 'border-pink-100' },
  'is-red': { bg: 'bg-red-50', text: 'text-white', border: 'border-red-100' },
  'golden-yellow': { bg: 'bg-yellow-50', text: 'text-white', border: 'border-yellow-200' },
  gray: { bg: 'bg-gray-50', text: 'text-white', border: 'border-gray-200' },
};
export const programHeaderClass = (program) => PROGRAM_HEADER_CLASS[programColorVariant(program)];

// Dark-to-dusty cascading gradient (same hue family, deep → muted) for section
// headers that want a smoother color scheme than the flat PROGRAM_HEADER_CLASS bg —
// e.g. the Class Record's Midterm/Finals bars. Dark end comes first so it sits behind
// the left-aligned title text, giving it more contrast/emphasis; it cascades lighter
// toward the right. "it" fades from the app's darkest brand navy (#0f2a4a) into a
// specified vivid blue (#429CEE / rgb(66,156,238)) rather than a muted/gray tone.
const PROGRAM_CASCADE = {
  it: 'linear-gradient(135deg, #0F2A4A, #429CEE)',
  lavender: 'linear-gradient(135deg, #5C1F31, #D8A0B0)',
  'is-red': 'linear-gradient(135deg, #5C1414, #C98A82)',
  'golden-yellow': 'linear-gradient(135deg, #5C4415, #D9C08A)',
  gray: 'linear-gradient(135deg, #262B35, #B0B7C0)',
};
export const programCascadeGradient = (program) => PROGRAM_CASCADE[programColorVariant(program)];

// ============ STAT CARD ============
export function StatCard({ label, value, sub, icon, iconBg = 'bg-blue-50 text-blue-500', valueClass = '' }) {
  return (
    <div className="stat-card">
      <div>
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
        {sub && <p className="text-xs text-green-500 mt-0.5">{sub}</p>}
      </div>
      {icon && <div className={`stat-icon ${iconBg}`}>{icon}</div>}
    </div>
  );
}

// ============ MODAL ============
export function Modal({ title, onClose, children, footer, size = 'max-w-lg' }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-5 animate-fadeIn" onClick={onClose}>
      <div className={`bg-white rounded-xl w-full ${size} max-h-[90vh] overflow-y-auto shadow-2xl animate-slideUp`} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="btn-icon" onClick={onClose}><Icons.X /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// ============ SEARCH BAR ============
export function SearchBar({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="flex items-center gap-2 px-4 border border-gray-200 rounded-lg bg-white flex-1 min-w-[200px]">
      <Icons.Search className="text-gray-400 flex-shrink-0" />
      <input
        type="text"
        className="border-none outline-none py-2.5 text-sm font-sans flex-1 bg-transparent"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ============ LOADING SPINNER ============
export function LoadingSpinner({ text = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-400">
      <Icons.Loader className="w-8 h-8 mb-3" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

// ============ EMPTY STATE ============
export function EmptyState({ icon, title, description }) {
  return (
    <div className="text-center py-16 text-gray-400">
      {icon && <div className="mb-3 flex justify-center">{icon}</div>}
      <p className="font-medium text-gray-600">{title}</p>
      {description && <p className="text-sm mt-1">{description}</p>}
    </div>
  );
}

// ============ CONFIRM DIALOG ============
export function ConfirmDialog({ title, message, onConfirm, onCancel, confirmText = 'Confirm', variant = 'red' }) {
  return (
    <Modal title={title} onClose={onCancel} footer={
      <>
        <button className="btn btn-outline" onClick={onCancel}>Cancel</button>
        <button className={`btn btn-${variant}`} onClick={onConfirm}>{confirmText}</button>
      </>
    }>
      <p className="text-sm text-gray-600">{message}</p>
    </Modal>
  );
}