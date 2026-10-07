// Per-semester "Academic Year" vs "School Year" label (Semester.year_label,
// picked in Semester Management). One shared, live copy of the semester list
// backs every place a year is shown — dashboards, the current-term pill, the
// Class Record, Grade Sheet and every export — so Admin switching a
// semester's label shows up for every signed-in user instantly (the backend
// broadcasts 'semestersUpdated'; this re-reads the list and re-renders).
import { useEffect, useState } from 'react';
import API, { clearApiCache } from '../services/api';
import { getToken } from '../services/authStorage';
import socket from '../services/socket';
import toast from 'react-hot-toast';

const DEFAULT_LABEL = 'Academic Year';

// "Academic Year" → A.Y. / AY; "School Year" → S.Y. / SY.
export const yearLabelOf = (semester) => semester?.year_label || DEFAULT_LABEL;
export const yearAbbrOf = (semester) => (yearLabelOf(semester) === 'School Year' ? 'S.Y.' : 'A.Y.');
export const yearShortOf = (semester) => (yearLabelOf(semester) === 'School Year' ? 'SY' : 'AY');

let semesters = null;
let inflight = null;
const listeners = new Set();

// Which semesters exist and which one is running. When this changes while
// the app is open — a new semester created, another set as current, one
// ended — every signed-in user's screen reloads so all pages start fresh on
// the new semester. Past semesters' classes and grades are never deleted:
// they stay as archives (Archived sections, My Grades history, prospectus).
// A label or date edit alone doesn't trigger this.
const lineupOf = (list) => (list || []).map((s) => `${s.id}:${s.is_current ? 1 : 0}:${s.status}`).sort().join('|');
let reloadTimer = null;
const refreshForNewSemester = (list) => {
  if (reloadTimer) return;
  const current = list.find((s) => s.is_current);
  toast(current ? `${current.name} is now the current semester — refreshing…` : 'The semesters were updated — refreshing…', { icon: '🔄', duration: 2500 });
  reloadTimer = setTimeout(() => window.location.reload(), 2500);
};

const load = () => {
  if (!inflight) {
    clearApiCache('/semesters'); // never compare against a cached copy
    inflight = API.get('/semesters')
      .then(({ data }) => {
        const prevLineup = semesters ? lineupOf(semesters) : null;
        semesters = data.semesters || [];
        if (prevLineup !== null && prevLineup !== lineupOf(semesters)) refreshForNewSemester(semesters);
        listeners.forEach((fn) => fn(semesters));
        return semesters;
      })
      .catch(() => semesters || [])
      .finally(() => { inflight = null; });
  }
  return inflight;
};

socket.on('semestersUpdated', () => { load(); });
// Know the line-up from the start, so a change is noticed on any page.
if (getToken()) load();

// Semester record for a class's `semester` string (Class.semester is the
// semester's own `name`, e.g. "First Semester 2026-2027"), or an existing
// semester object passed straight through — refreshed from the live list
// when possible, so a record fetched earlier still picks up a label change.
const resolve = (list, semesterOrName) => {
  if (!semesterOrName) return null;
  const name = typeof semesterOrName === 'string' ? semesterOrName : semesterOrName.name;
  const live = (list || []).find((s) => s.name === name);
  return live || (typeof semesterOrName === 'string' ? null : semesterOrName);
};

// For non-React code (Excel/.docx exports) — waits for the list once.
export const getSemesterFor = async (semesterOrName) => resolve(semesters || await load(), semesterOrName);

// React hook: { labelFor, abbrFor, shortFor, currentLabel } — the first three
// take a semester object or a class's semester name; currentLabel is the
// current semester's own label. Re-renders on any live label change.
export function useSemesterLabels() {
  const [list, setList] = useState(semesters);
  useEffect(() => {
    listeners.add(setList);
    if (!semesters) load();
    return () => { listeners.delete(setList); };
  }, []);
  return {
    labelFor: (s) => yearLabelOf(resolve(list, s)),
    abbrFor: (s) => yearAbbrOf(resolve(list, s)),
    shortFor: (s) => yearShortOf(resolve(list, s)),
    currentLabel: yearLabelOf((list || []).find((s) => s.is_current)),
  };
}

// Subscribe to live semester changes (e.g. to re-fetch a current-semester
// record from an endpoint this module doesn't own). Returns unsubscribe.
export const onSemestersUpdated = (fn) => {
  socket.on('semestersUpdated', fn);
  return () => { socket.off('semestersUpdated', fn); };
};
