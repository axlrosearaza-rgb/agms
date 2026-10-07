import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icons, Avatar, Badge, Modal, formatPersonName } from './index';

const DOC = {
  record: { label: 'Class Record', path: '/class-record' },
  sheet: { label: 'Grade Sheet', path: '/grading-sheet' },
};

// "Sep 30 · 2:15 PM"
const shortDateTime = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  return `${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

// Compact encoding progress for a class row (Grade Approval tables):
// "1/44 encoded" + bar + last save. Expects graded_count / student_count /
// encoding_progress / last_saved_at from GET /api/classes.
export function EncodingProgress({ c }) {
  const pct = c.encoding_progress || 0;
  return (
    <div className="min-w-[120px]" title={c.last_saved_at ? `Last saved ${shortDateTime(c.last_saved_at)}` : 'Not saved yet'}>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[11px] font-semibold text-gray-600 w-8 text-right">{pct}%</span>
      </div>
      <p className="text-[10px] text-gray-400 mt-0.5 whitespace-nowrap">
        Midterm {c.midterm_encoded ?? 0}/{c.student_count ?? 0} · Finals {c.finals_encoded ?? 0}/{c.student_count ?? 0}
      </p>
      {c.last_saved_at && <p className="text-[10px] text-gray-400 whitespace-nowrap">Saved {shortDateTime(c.last_saved_at)}</p>}
    </div>
  );
}

// Where a class is in the pipeline, as one short badge.
const stageBadge = (c) => {
  if (c.admin_approved) return <Badge variant="green"><Icons.Check className="w-3 h-3" /> Approved</Badge>;
  if (c.chairperson_verified) return <Badge variant="blue">Verified</Badge>;
  if (c.sent) return <Badge variant="blue">Submitted</Badge>;
  if (c.progress > 0) return <Badge variant="yellow">Encoding</Badge>;
  return <Badge variant="gray">Not started</Badge>;
};

// One instructor in Faculty Submission Progress (Chairperson + Admin
// dashboards): their sections fully submitted out of how many they teach.
// Opens to show each class's live encoding progress (updated every time the
// Class Record is saved) with read-only previews of the Class Record and
// Grade Sheet.
export default function FacultyProgressRow({ f, gradeApprovalPath = null }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null); // { cls, type }
  const done = f.classes.filter((c) => c.sent).length;
  const total = f.classes.length;
  const complete = total > 0 && done === total;
  const avgProgress = total ? Math.round(f.classes.reduce((s, c) => s + (c.progress || 0), 0) / total) : 0;

  return (
    <div className={`rounded-lg transition-colors ${open ? 'bg-gray-50/80 border border-gray-100' : ''}`}>
      <button
        type="button"
        className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 cursor-pointer border-none bg-transparent font-sans text-left"
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Hide classes' : 'Show classes, progress and previews'}
      >
        <Avatar letter={f.instructor.avatar || f.instructor.name?.[0]} className="bg-purple-500 text-white flex-shrink-0" size="w-8 h-8 text-xs" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium truncate">{formatPersonName(f.instructor.name)}</p>
            <span className="text-[11px] text-gray-400 flex-shrink-0">{avgProgress}% encoded</span>
          </div>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
            <div className={`h-full rounded-full ${complete ? 'bg-green-500' : 'bg-amber-400'}`} style={{ width: `${complete ? 100 : avgProgress}%` }} />
          </div>
        </div>
        <Badge variant={complete ? 'green' : 'gray'} className="flex-shrink-0" title="Sections fully submitted">
          {complete && <Icons.Check className="w-3 h-3" />} {done}/{total}
        </Badge>
        {open ? <Icons.ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {f.classes.map((c) => (
            <div key={c.class_id} className="bg-white border border-gray-100 rounded-lg p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-navy truncate">
                    {c.subject_code}{c.year_level ? ` · Year ${c.year_level}` : ''}{c.section ? ` · Sec ${c.section}` : ''}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    Midterm {c.midterm_encoded ?? 0}/{c.total_students} · Finals {c.finals_encoded ?? 0}/{c.total_students}
                    {c.last_saved_at ? ` · last saved ${shortDateTime(c.last_saved_at)}` : ' · not saved yet'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {stageBadge(c)}
                  <button type="button" className="btn btn-outline btn-sm flex items-center gap-1" onClick={() => setPreview({ cls: c, type: 'record' })} title="Preview the Class Record (read-only)">
                    <Icons.Book className="w-3.5 h-3.5" /> Class Record
                  </button>
                  <button type="button" className="btn btn-outline btn-sm flex items-center gap-1" onClick={() => setPreview({ cls: c, type: 'sheet' })} title="Preview the Grade Sheet (read-only)">
                    <Icons.FileText className="w-3.5 h-3.5" /> Grade Sheet
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${c.progress === 100 ? 'bg-green-500' : 'bg-amber-400'}`} style={{ width: `${c.progress || 0}%` }} />
                </div>
                <span className="text-[11px] font-semibold text-gray-500 w-9 text-right">{c.progress || 0}%</span>
              </div>
            </div>
          ))}
          {gradeApprovalPath && (
            <button
              type="button"
              className="text-xs text-gold font-semibold bg-transparent border-none cursor-pointer font-sans hover:underline px-1"
              onClick={() => navigate(`${gradeApprovalPath}?instructor=${encodeURIComponent(f.instructor.name || '')}`)}
            >
              Open {formatPersonName(f.instructor.name)}'s classes in Grade Approval →
            </button>
          )}
        </div>
      )}

      {preview && (
        <Modal
          title={`${DOC[preview.type].label} — ${preview.cls.subject_code}${preview.cls.section ? ` Sec ${preview.cls.section}` : ''} · Preview`}
          onClose={() => setPreview(null)}
          size="max-w-[98vw]"
        >
          <iframe
            key={`${preview.cls.class_id}-${preview.type}`}
            src={`${DOC[preview.type].path}/${preview.cls.class_id}?preview=1`}
            title="Document preview"
            style={{ width: '100%', height: 'calc(90vh - 130px)', minHeight: 360, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
          />
        </Modal>
      )}
    </div>
  );
}
