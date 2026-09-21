import { useState, useEffect, useRef } from 'react';
import API from '../../services/api';
import { agoLabel } from '../../hooks/usePresence';

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
  MapPin: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  Phone: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
  Mail: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>,
  Globe: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Sun: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  Moon: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  Archive: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><line x1="10" y1="13" x2="14" y2="13"/></svg>,
  RotateCcw: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>,
  Forward: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>,
};

// ============ ROLE DISPLAY LABEL ============
// The stored `role` value is 'Faculty' natively now (DB, routes, authorize()
// checks all use it directly) — this is kept as a passthrough so existing call
// sites don't need to change, in case a future role ever needs a display alias.
export const roleLabel = (role) => role;

// ============ PERSON NAME SHARED FORMATTER ============
// Single system-wide convention for every human-facing name label:
// "Last name, First name Middle name(s)" — exactly the way the stored
// name was entered, with the surname alphabetically leading the sort and
// the middle token left intact as `G.` instead of being reduced to one
// guessed letter or removed altogether.
export function formatPersonName(name = '') {
  const parts = String(name || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (parts.length === 0) return '';

  const first = parts[0];
  const last = parts[parts.length - 1];
  const middle = parts.slice(1, -1);

  if (middle.length === 0) {
    return `${last}, ${first}`;
  }

  return `${last}, ${first} ${middle.join(' ')}`;
}

// Same "Last, First Middle" order as formatPersonName, but the surname
// itself is capitalized (e.g. "ARAZA, Axl Rose G.") — the convention the
// Grading Sheet's printed roster follows, distinguishing the surname from
// the given/middle names at a glance the way an all-lowercase-vs-mixed-case
// distinction alone doesn't.
export function formatPersonNameCapsSurname(name = '') {
  const formatted = formatPersonName(name);
  const commaIdx = formatted.indexOf(',');
  if (commaIdx === -1) return formatted.toUpperCase();
  return formatted.slice(0, commaIdx).toUpperCase() + formatted.slice(commaIdx);
}

export function comparePeopleNames(a, b) {
  const left = formatPersonName(a?.name || a || '');
  const right = formatPersonName(b?.name || b || '');
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

export const formatStudentName = formatPersonName;
export const compareStudentNames = comparePeopleNames;

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

// ============ PRESENCE (Online/Offline) ============
// A small colored dot + label — "Online" or "Offline · 3h ago" — driven by
// usePresence's live { online, last_seen_at } state. `presence` undefined
// (still loading, or this user's ID was never passed to usePresence) reads
// as an unlit gray dot with no label, not a false "Offline".
export function PresenceDot({ presence, className = '' }) {
  const online = presence?.online;
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${online ? 'bg-green-500' : 'bg-gray-300'} ${className}`}
      title={online ? 'Online' : presence?.last_seen_at ? `Offline · last seen ${agoLabel(presence.last_seen_at)}` : 'Offline'}
    />
  );
}

export function PresenceLabel({ presence, className = '' }) {
  if (!presence) return null;
  if (presence.online) {
    return <span className={`text-xs font-medium text-green-600 ${className}`}>Online</span>;
  }
  const ago = presence.last_seen_at ? agoLabel(presence.last_seen_at) : null;
  return <span className={`text-xs text-gray-400 ${className}`}>{ago ? `Offline · ${ago}` : 'Offline'}</span>;
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
  if (v.includes('psychology')) return 'BS Psych';
  if (v.includes('information systems')) return 'BSIS';
  if (v.includes('statistics')) return 'BSS';
  if (v.includes('general education')) return 'GE';
  return value;
};

// Always-prefixed "BS <Major>" label — distinct from programShortLabel above
// (which abbreviates IT/IS all the way down to "BSIT"/"BSIS" for the tightest
// spaces, and inconsistently skips the "BS" prefix for Psych/Statistics).
// Callers that want the fuller, consistently-prefixed form (a person's own
// "BS Psychology" / "BS Information Technology" identity label) use this one.
export const programBSLabel = (value) => {
  if (!value) return '';
  const v = value.toLowerCase();
  if (v.includes('information technology')) return 'BS Information Technology';
  if (v.includes('psychology')) return 'BS Psychology';
  if (v.includes('information systems')) return 'BS Information Systems';
  if (v.includes('statistics')) return 'BS Statistics';
  return value;
};

export function ProgramBadge({ program, short = false, bs = false, size = 'sm', className = '' }) {
  if (!program) return <span className="text-gray-400">—</span>;
  const sizeClass = size === 'lg' ? 'text-base px-4 py-1.5 font-bold' : '';
  const label = bs ? programBSLabel(program) : (short ? programShortLabel(program) : program);
  // BSIT/BSIS/BSPsych/BSS need to read as a program identity at a glance, not
  // blend in with the rest of a row's text — bold (not just the badge's own
  // default font-semibold) everywhere this renders, not just the `lg` size.
  return <Badge variant={programColorVariant(program)} className={`font-bold ${sizeClass} ${className}`}>{label}</Badge>;
}

// A part-time faculty account is tagged with every program (so every
// Chairperson can find them), not because they actually belong to all of
// them — listing all four program badges next to their name overstates that
// and just reads as noise. Anywhere an instructor/faculty's program tags
// would normally be shown, this collapses to a single plain "Part Timer"
// label instead once employment_type is Part Time.
export function FacultyProgramTags({ user, short = true }) {
  if (!user) return null;
  if (user.employment_type === 'Part Time') {
    return <Badge variant="yellow">Part Timer</Badge>;
  }
  const programs = user.programs?.length ? user.programs : (user.program ? [user.program] : []);
  if (programs.length === 0) return null;
  return (
    <>
      {programs.map((p) => <ProgramBadge key={p} program={p} short={short} />)}
    </>
  );
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

// Two deliberately separate fields, both self-declared once at registration
// (RegisterPage) — kept apart because only one of them has any functional
// effect elsewhere in the app:
//
// - student_status: Regular vs Irregular. Functional — decides whether a
//   student is on the normal year/section track or has a custom mix of
//   subjects across years (see irregular_sections on the User model), and
//   promotionController can flip it automatically during evaluation.
// - student_type: New/Shifter/Transferee/Old Student/Quitter. Purely
//   descriptive — nothing branches on it — and locked to what the student
//   picked at registration (Admin/Chairperson can't edit it afterward, see
//   UserManagement.js).
//
// Shared here so both display consistently wherever a student shows up —
// Admin, Chairperson, Faculty, and the student's own account alike.
export const STUDENT_TYPES = ['New', 'Shifter', 'Transferee', 'Old', 'Quitter'];
const STUDENT_TYPE_LABELS = { New: 'New Student', Old: 'Old Student' };
export const studentTypeLabel = (t) => STUDENT_TYPE_LABELS[t] || t;
const STUDENT_TYPE_BADGE_VARIANT = { New: 'blue', Shifter: 'purple', Transferee: 'yellow', Old: 'gray', Quitter: 'red' };
export function StudentTypeBadge({ status, className = '' }) {
  if (!status) return null;
  return <Badge variant={STUDENT_TYPE_BADGE_VARIANT[status] || 'gray'} className={className}>{studentTypeLabel(status)}</Badge>;
}

export const REGULARITY_OPTIONS = ['Regular', 'Irregular'];
export function RegularityBadge({ status, className = '' }) {
  return <Badge variant={status === 'Irregular' ? 'red' : 'green'} className={className}>{status === 'Irregular' ? 'Irregular' : 'Regular'}</Badge>;
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

// An Irregular student's `irregular_sections` can span more than one Year
// Level (e.g. retaking a Year 2 subject while also taking Year 3 classes) —
// showing only the primary pair's `year_level` (the first pair, kept in sync
// for code that reads the singular field) understates that. This collapses
// every distinct year they're actually enrolled across into one label
// ("Year 2, Year 3") instead, falling back to the plain singular year for a
// Regular student.
export function studentYearLevelsLabel(user) {
  if (user?.student_status === 'Irregular' && user?.irregular_sections?.length) {
    const years = [...new Set(user.irregular_sections.map((p) => p.year_level))].sort((a, b) => a - b);
    return years.map((y) => `Year ${y}`).join(', ');
  }
  return user?.year_level ? `Year ${user.year_level}` : '—';
}

// Same idea as studentYearLevelsLabel above, but pairs each year with its OWN
// section too ("Year 1 · Sec C, Year 2 · Sec D, Year 4 · Sec D") — an
// Irregular student's self-declared per-year mix (irregular_sections, set at
// registration) often has a genuinely DIFFERENT section for each year
// they're actually taking classes in, so showing just the single primary
// year_level/section pair silently drops the rest of what they entered.
export function studentYearSectionsLabel(user) {
  if (user?.student_status === 'Irregular' && user?.irregular_sections?.length) {
    return user.irregular_sections
      .slice()
      .sort((a, b) => (a.year_level || 0) - (b.year_level || 0))
      .map((p) => `Year ${p.year_level}${p.section ? ` · Sec ${p.section}` : ''}${p.is_current ? ' (Current)' : ''}`)
      .join(', ');
  }
  return `Year ${user?.year_level ?? '—'}${user?.section ? ` · Sec ${user.section}` : ''}`;
}

// Just the ONE pair the student should see as "where I am right now" — the
// `is_current`-marked pair for an Irregular student (registration requires
// marking exactly one), or their plain year_level/section for a Regular
// student. Older Irregular accounts with no `is_current` on any pair (from
// before that distinction existed) fall back to their first pair, same as
// the singular year_level/section field already mirrors.
export function studentCurrentYearSectionLabel(user) {
  if (user?.student_status === 'Irregular' && user?.irregular_sections?.length) {
    const current = user.irregular_sections.find((p) => p.is_current) || user.irregular_sections[0];
    return `Year ${current.year_level}${current.section ? ` · Sec ${current.section}` : ''}`;
  }
  return `Year ${user?.year_level ?? '—'}${user?.section ? ` · Sec ${user.section}` : ''}`;
}

// ============ CURRENT SEMESTER TAG ============
// A small "1st Semester · A.Y. 2025-2026" pill next to a page's own "Welcome
// back" heading — same current-semester record Admin's Semester Settings
// manages (Semester.is_current), just surfaced everywhere someone might
// otherwise wonder which term the numbers on screen belong to. Fetches for
// itself so any dashboard can drop it in without wiring up its own semester
// call.
export function CurrentSemesterTag({ className = '' }) {
  const [semester, setSemester] = useState(null);
  useEffect(() => {
    API.get('/semesters/public/current')
      .then(({ data }) => setSemester(data.semester))
      .catch(() => {});
  }, []);
  if (!semester) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full ${className}`}>
      <Icons.Clock className="w-3 h-3" />
      {semester.term || semester.name} · A.Y. {semester.academic_year}
    </span>
  );
}

// ============ STAT CARD ============
// `accent` (a `border-*` class) and `progress` (0-100) are optional, additive —
// every existing call site that doesn't pass them renders exactly as before.
// `progress`, when given, draws a thin fill bar under the value so a percentage
// metric (pass rate, completion, etc.) reads as "how full" at a glance, not just
// a number.
export function StatCard({ label, value, sub, icon, iconBg = 'bg-blue-50 text-blue-500', valueClass = '', accent = '', progress = null }) {
  return (
    <div className={`stat-card ${accent ? `border-l-4 ${accent}` : ''}`}>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        {progress !== null && (
          <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${progress >= 75 ? 'bg-green-500' : progress >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        )}
      </div>
      {icon && <div className={`stat-icon ${iconBg} flex-shrink-0`}>{icon}</div>}
    </div>
  );
}

// ============ MODAL ============
// Every open Modal (ConfirmDialog included — it's a Modal) registers here, so
// Escape closes only the TOPMOST one: a confirm dialog stacked on top of a
// details modal closes the confirm first, and a second Esc closes the one
// underneath, instead of one keypress dismissing the whole pile at once.
const modalStack = [];
function handleModalEscape(e) {
  if (e.key !== 'Escape' || modalStack.length === 0) return;
  const top = modalStack[modalStack.length - 1].current;
  // A modal that opted out of backdrop-click dismissal (an in-progress form
  // that must never be discarded by a stray click) is just as easy to
  // dismiss by a stray Esc — it ignores it too, and blocks the ones below.
  if (top.dismissible) top.close();
}

export function Modal({ title, onClose, children, footer, size = 'max-w-lg', closeOnBackdropClick = true }) {
  // Always the latest onClose/dismissible without re-registering on every
  // render (parents pass a fresh inline onClose each time).
  const handle = useRef({ close: onClose, dismissible: closeOnBackdropClick });
  handle.current.close = onClose;
  handle.current.dismissible = closeOnBackdropClick;

  useEffect(() => {
    if (modalStack.length === 0) document.addEventListener('keydown', handleModalEscape);
    modalStack.push(handle);
    return () => {
      const i = modalStack.indexOf(handle);
      if (i !== -1) modalStack.splice(i, 1);
      if (modalStack.length === 0) document.removeEventListener('keydown', handleModalEscape);
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-5 animate-fadeIn" onClick={closeOnBackdropClick ? onClose : undefined}>
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

// ============ CONFIDENTIALITY BANNER (Data Privacy Act / RA 10173) ============
// Reusable notice for any page displaying grades or other confidential academic
// records — currently used on the student's My Grades page.
export function ConfidentialityBanner({ className = '' }) {
  return (
    <div className={`flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5 ${className}`}>
      <Icons.Lock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
      <p className="text-[12.5px] text-amber-800 leading-relaxed">
        This academic record contains confidential information protected under the Data Privacy Act of 2012
        (RA 10173). Unauthorized access, copying, disclosure, or distribution is prohibited.
      </p>
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
export function ConfirmDialog({ title, message, onConfirm, onCancel, confirmText = 'Confirm', variant = 'red', confirmDisabled = false }) {
  return (
    <Modal title={title} onClose={onCancel} footer={
      <>
        <button className="btn btn-outline" onClick={onCancel}>Cancel</button>
        <button className={`btn btn-${variant}`} onClick={onConfirm} disabled={confirmDisabled}>{confirmText}</button>
      </>
    }>
      <p className="text-sm text-gray-600">{message}</p>
    </Modal>
  );
}