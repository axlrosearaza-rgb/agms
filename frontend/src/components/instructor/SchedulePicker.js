import { Icons } from '../common';

// The same schedule picker as Create Class: pick the day(s), and each day gets
// one or more Start → End time slots (whole hours). `times` is
// { M: [{ start: '08:00', end: '09:00' }, ...], ... }; scheduleToString turns it
// into the text stored on the class ("MWF 8:00 AM - 9:00 AM"), and
// scheduleFromString reads that text back for editing.
export const SCHEDULE_DAYS = ['M', 'T', 'W', 'Th', 'F', 'S'];
const DEFAULT_SLOT = { start: '08:00', end: '09:00' };

const formatTime12h = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

export const scheduleToString = (times) => {
  const groups = [];
  const byKey = {};
  SCHEDULE_DAYS.forEach((day) => {
    (times[day] || []).forEach((slot) => {
      if (!slot.start || !slot.end) return;
      const key = `${slot.start}|${slot.end}`;
      if (!byKey[key]) { byKey[key] = { start: slot.start, end: slot.end, days: [] }; groups.push(byKey[key]); }
      if (!byKey[key].days.includes(day)) byKey[key].days.push(day);
    });
  });
  return groups.map((g) => `${g.days.join('')} ${formatTime12h(g.start)} - ${formatTime12h(g.end)}`).join(', ');
};

// "1:00 PM" → "13:00"; a missing AM/PM borrows the other end's.
const to24h = (text, fallbackPeriod) => {
  const m = String(text).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const period = (m[3] || fallbackPeriod || '').toUpperCase();
  if (period === 'PM' && h < 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
};

// "MWF 8:00 AM - 9:00 AM, TTh 1:00-2:00 PM" → times. Anything it can't read is skipped.
export const scheduleFromString = (text) => {
  const times = {};
  String(text || '').split(',').forEach((part) => {
    const m = part.trim().match(/^([A-Za-z]+)\s+(.+?)\s*[-–]\s*(.+)$/);
    if (!m) return;
    const days = m[1].match(/Th|[MTWFS]/g) || [];
    const endPeriod = (m[3].match(/AM|PM/i) || [])[0];
    const startPeriod = (m[2].match(/AM|PM/i) || [])[0];
    const start = to24h(m[2], endPeriod);
    const end = to24h(m[3], startPeriod);
    if (!start || !end) return;
    days.forEach((d) => { (times[d] = times[d] || []).push({ start, end }); });
  });
  return times;
};

export default function SchedulePicker({ times, onChange }) {
  const set = (next) => onChange(next);
  const toggleDay = (day) => {
    const next = { ...times };
    if (next[day]) delete next[day]; else next[day] = [{ ...DEFAULT_SLOT }];
    set(next);
  };
  const addSlot = (day) => set({ ...times, [day]: [...(times[day] || []), { ...DEFAULT_SLOT }] });
  const removeSlot = (day, i) => set({ ...times, [day]: times[day].filter((_, k) => k !== i) });
  const updateTime = (day, i, field, value) => {
    const hourOnly = value ? `${value.slice(0, 2)}:00` : value; // whole hours only
    set({ ...times, [day]: times[day].map((slot, k) => (k === i ? { ...slot, [field]: hourOnly } : slot)) });
  };
  const activeDays = SCHEDULE_DAYS.filter((day) => times[day]);
  const summary = scheduleToString(times);

  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {SCHEDULE_DAYS.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => toggleDay(day)}
            className={`w-9 h-9 rounded-lg text-sm font-semibold border cursor-pointer transition-colors font-sans
              ${times[day] ? 'bg-navy text-white border-navy' : 'bg-white text-gray-600 border-gray-200 hover:border-navy/40'}`}
          >
            {day}
          </button>
        ))}
      </div>
      {activeDays.length > 0 && (
        <div className="space-y-3 mb-2">
          {activeDays.map((day) => (
            <div key={day} className="space-y-1.5">
              {times[day].map((slot, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-7 flex-shrink-0 text-sm font-semibold text-navy text-center">{i === 0 ? day : ''}</span>
                  <input type="time" step="3600" className="form-input flex-1" value={slot.start} onChange={(e) => updateTime(day, i, 'start', e.target.value)} />
                  <span className="text-gray-400 text-xs flex-shrink-0">to</span>
                  <input type="time" step="3600" className="form-input flex-1" value={slot.end} onChange={(e) => updateTime(day, i, 'end', e.target.value)} />
                  {i === 0 ? (
                    <button type="button" className="btn-icon flex-shrink-0" title={`Add another time slot for ${day}`} onClick={() => addSlot(day)}>
                      <Icons.Plus className="w-4 h-4" />
                    </button>
                  ) : (
                    <button type="button" className="btn-icon flex-shrink-0 hover:!bg-red-50 hover:!text-red-500" title="Remove this time slot" onClick={() => removeSlot(day, i)}>
                      <Icons.Trash className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {summary && (
        <p className="text-[11px] text-gray-500 mt-2 flex items-center gap-1.5">
          <Icons.Clock className="w-3 h-3 flex-shrink-0" /> {summary}
        </p>
      )}
      <p className="text-[11px] text-gray-400 mt-1">Optional — shows on the exported Class Record's own "Schedule:" line.</p>
    </div>
  );
}
