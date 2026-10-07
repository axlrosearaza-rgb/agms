import { useState } from 'react';
import {
  Icons,
  Badge,
  Modal,
  SearchBar,
  ProgramDot,
  programShortLabel,
  programCascadeGradient,
  groupByProgramYearSection,
} from '../common';

const DOC = {
  record: { label: 'Class Record', path: '/class-record' },
  sheet: { label: 'Grading Sheet', path: '/grading-sheet' },
};

const SUBJECT_COLORS = [
  { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-800', dot: 'bg-blue-500' },
  { bg: 'bg-green-100', border: 'border-green-300', text: 'text-green-800', dot: 'bg-green-500' },
  { bg: 'bg-purple-100', border: 'border-purple-300', text: 'text-purple-800', dot: 'bg-purple-500' },
  { bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-800', dot: 'bg-amber-500' },
  { bg: 'bg-pink-100', border: 'border-pink-300', text: 'text-pink-800', dot: 'bg-pink-500' },
  { bg: 'bg-teal-100', border: 'border-teal-300', text: 'text-teal-800', dot: 'bg-teal-500' },
  { bg: 'bg-orange-100', border: 'border-orange-300', text: 'text-orange-800', dot: 'bg-orange-500' },
  { bg: 'bg-indigo-100', border: 'border-indigo-300', text: 'text-indigo-800', dot: 'bg-indigo-500' },
];

function GroupedClassTree({ items, idPrefix, openGroups, toggleGroup, headerRow, colGroup, renderRow, emptyMessage }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-10">{emptyMessage}</p>;
  }
  const groups = groupByProgramYearSection(items);
  const programs = Object.keys(groups).sort();
  return (
    <div>
      {programs.map((program) => {
        const years = groups[program];
        const programTotal = Object.values(years).reduce(
          (s, secs) => s + Object.values(secs).reduce((s2, arr) => s2 + arr.length, 0),
          0
        );
        const programKey = `${idPrefix}|${program}`;
        const programOpen = openGroups[programKey] ?? false;
        return (
          <div key={program} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
            <button
              onClick={() => toggleGroup(programKey, !programOpen)}
              className="w-full px-5 py-2.5 flex items-center justify-between text-white border-none cursor-pointer font-sans transition-opacity hover:opacity-95"
              style={{ background: programCascadeGradient(program) }}
            >
              <div className="flex items-center gap-2.5">
                <ProgramDot program={program} />
                <span className="text-sm font-bold">{programShortLabel(program)}</span>
                <span className="text-xs opacity-80">
                  {programTotal} class{programTotal !== 1 ? 'es' : ''}
                </span>
              </div>
              {programOpen ? <Icons.ChevronUp className="w-3.5 h-3.5" /> : <Icons.ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {programOpen &&
              Object.keys(years)
                .sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : a - b))
                .map((year) => {
                  const sections = years[year];
                  const yearTotal = Object.values(sections).reduce((s, arr) => s + arr.length, 0);
                  const yearKey = `${programKey}|${year}`;
                  const yearOpen = openGroups[yearKey] ?? false;
                  return (
                    <div key={year} className="border-t border-gray-50 dark:border-gray-800">
                      <button
                        onClick={() => toggleGroup(yearKey, !yearOpen)}
                        className="w-full pl-9 pr-5 py-2 flex items-center justify-between border-none cursor-pointer font-sans bg-blue-50/30 dark:bg-blue-950/20 hover:bg-blue-50/60 transition-colors"
                      >
                        <span className="text-[12px] font-semibold text-blue-700 dark:text-blue-300">
                          {year === '—' ? 'No Year Level' : `Year ${year}`}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-gray-400">{yearTotal}</span>
                          {yearOpen ? (
                            <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                          ) : (
                            <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                          )}
                        </div>
                      </button>

                      {yearOpen &&
                        Object.keys(sections)
                          .sort()
                          .map((section) => {
                            const secClasses = sections[section];
                            const secKey = `${yearKey}|${section}`;
                            const secOpen = openGroups[secKey] ?? false;
                            return (
                              <div key={section} className="border-t border-gray-50 dark:border-gray-800">
                                <button
                                  onClick={() => toggleGroup(secKey, !secOpen)}
                                  className="w-full pl-14 pr-5 py-2 flex items-center justify-between border-none cursor-pointer font-sans bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-[inset_3px_0_0_#3b82f6]"
                                >
                                  <span className="flex items-center gap-2 text-[13px] font-semibold text-gray-800 dark:text-gray-200">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                                    {section === 'No Section' ? section : `Section ${section}`}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span className="min-w-[22px] px-2 py-0.5 rounded-full bg-blue-600 text-white text-[11px] font-bold text-center leading-4">
                                      {secClasses.length}
                                    </span>
                                    {secOpen ? (
                                      <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                                    ) : (
                                      <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                    )}
                                  </div>
                                </button>
                                {secOpen && (
                                  <div className="overflow-x-auto">
                                    <table className="w-full table-fixed border-separate border-spacing-0 min-w-[760px]">
                                      {colGroup && <colgroup>{colGroup}</colgroup>}
                                      {headerRow && <thead>{headerRow}</thead>}
                                      <tbody>{secClasses.map(renderRow)}</tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                    </div>
                  );
                })}
          </div>
        );
      })}
    </div>
  );
}

export default function ReleaseStatusCard({ classes, onOpenClass }) {
  const [filter, setFilter] = useState('all'); // 'all' | 'in_review' | 'revision' | 'approved' | 'unsubmitted'
  const [search, setSearch] = useState('');
  const [openGroups, setOpenGroups] = useState({});
  const [preview, setPreview] = useState(null); // { cls, type: 'record' | 'sheet' }

  const toggleGroup = (key, next) => setOpenGroups((prev) => ({ ...prev, [key]: next }));

  // Every active class — including one just created that has no students
  // yet, so a new class shows up here right away.
  const active = (classes || []).filter((c) => !c.is_archived && (c.status || 'Active') === 'Active');
  if (active.length === 0) return null;

  // Build subject color map
  const colorMap = {};
  let ci = 0;
  active.forEach((cls) => {
    const code = cls.subject?.code || `cls-${cls.id}`;
    if (!colorMap[code]) {
      colorMap[code] = SUBJECT_COLORS[ci % SUBJECT_COLORS.length];
      ci++;
    }
  });

  const getDocStatus = (c, type) => {
    if ((c.student_count || 0) === 0) {
      return { label: 'Not Submitted', variant: 'gray', icon: <Icons.Clock className="w-3 h-3" /> };
    }
    const isRecord = type === 'record';
    const isApproved = isRecord ? c.admin_class_record_approved : c.admin_grade_sheet_approved;
    const isVerified = isRecord ? c.class_record_verified : c.grade_sheet_verified;
    const isSubmitted = !!c.sent_to_chairperson || ((c.student_count || 0) > 0 && (c.submitted_count || 0) >= c.student_count);

    if (c.awaiting_faculty_revision) {
      return { label: 'Needs Revision', variant: 'red', icon: <Icons.AlertTriangle className="w-3 h-3" /> };
    }
    if (c.all_released) {
      return { label: 'Released', variant: 'green', icon: <Icons.Check className="w-3 h-3" /> };
    }
    if (isApproved) {
      return { label: 'Admin Approved', variant: 'green', icon: <Icons.Check className="w-3 h-3" /> };
    }
    if (isVerified || c.chairperson_verified) {
      return { label: 'Chairperson Verified', variant: 'blue', icon: <Icons.Check className="w-3 h-3" /> };
    }
    if (isSubmitted) {
      return { label: 'Sent to Chairperson', variant: 'yellow', icon: <Icons.Clock className="w-3 h-3" /> };
    }
    return { label: 'Not Submitted', variant: 'gray', icon: <Icons.Clock className="w-3 h-3" /> };
  };

  const getStageInfo = (c) => {
    if ((c.student_count || 0) === 0) {
      return {
        status: 'unsubmitted',
        badge: <Badge variant="gray">No students yet</Badge>,
      };
    }
    const isFullySubmitted = !!c.sent_to_chairperson || ((c.student_count || 0) > 0 && (c.submitted_count || 0) >= c.student_count);

    if (c.awaiting_faculty_revision) {
      return {
        status: 'returned',
        badge: <Badge variant="red"><Icons.AlertTriangle className="w-3 h-3" /> Needs Revision</Badge>,
      };
    }
    if (c.all_released) {
      return {
        status: 'released',
        badge: <Badge variant="green"><Icons.Check className="w-3 h-3" /> Released</Badge>,
      };
    }
    if (c.can_release || (c.admin_class_record_approved && c.admin_grade_sheet_approved && (c.pending_admin_approval || 0) === 0)) {
      return {
        status: 'ready_release',
        badge: <Badge variant="green"><Icons.Check className="w-3 h-3" /> Ready to Release</Badge>,
      };
    }
    if (c.chairperson_verified || (c.class_record_verified && c.grade_sheet_verified)) {
      return {
        status: 'admin_review',
        badge: <Badge variant="blue"><Icons.Clock className="w-3 h-3" /> Under Admin Review</Badge>,
      };
    }
    if (isFullySubmitted) {
      return {
        status: 'chairperson_review',
        badge: <Badge variant="yellow"><Icons.Clock className="w-3 h-3" /> Chairperson Review</Badge>,
      };
    }
    if ((c.submitted_count || 0) > 0) {
      return {
        status: 'encoding',
        badge: <Badge variant="blue"><Icons.Clock className="w-3 h-3" /> Encoding ({c.submitted_count}/{c.student_count || 0})</Badge>,
      };
    }
    return {
      status: 'unsubmitted',
      badge: <Badge variant="gray">Not Submitted</Badge>,
    };
  };

  const rows = active.map((c) => ({
    c,
    stage: getStageInfo(c),
    recordStatus: getDocStatus(c, 'record'),
    sheetStatus: getDocStatus(c, 'sheet'),
  }));

  const inReviewCount = rows.filter((r) => ['chairperson_review', 'admin_review'].includes(r.stage.status)).length;
  const revisionCount = rows.filter((r) => r.stage.status === 'returned').length;
  const approvedCount = rows.filter((r) => ['ready_release', 'released'].includes(r.stage.status)).length;
  const unsubmittedCount = rows.filter((r) => ['unsubmitted', 'encoding'].includes(r.stage.status)).length;

  const filteredItems = rows
    .filter((r) => {
      if (filter === 'in_review') return ['chairperson_review', 'admin_review'].includes(r.stage.status);
      if (filter === 'revision') return r.stage.status === 'returned';
      if (filter === 'approved') return ['ready_release', 'released'].includes(r.stage.status);
      if (filter === 'unsubmitted') return ['unsubmitted', 'encoding'].includes(r.stage.status);
      return true;
    })
    .map((r) => r.c)
    .filter((c) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        c.subject?.code?.toLowerCase().includes(q) ||
        c.subject?.name?.toLowerCase().includes(q) ||
        (c.section && `sec ${c.section}`.toLowerCase().includes(q))
      );
    });

  return (
    <div className="card mb-6 overflow-hidden border border-gray-100 dark:border-gray-800 shadow-xs">
      {/* Header Banner */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-navy/95 to-navy-light text-white flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Icons.FileText className="w-5 h-5 text-blue-300" />
            <h3 className="text-base sm:text-lg font-bold">Document Submission & Verification Progress</h3>
          </div>
          <p className="text-xs text-white/80 mt-1 max-w-2xl">
            Track your encoded <strong>Grade Sheet</strong> and <strong>Class Record</strong> from submission to Chairperson verification, Admin approval, and release.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/15 text-white backdrop-blur-xs">
            {approvedCount}/{rows.length} Approved & Released
          </span>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="p-3 bg-gray-50/80 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors cursor-pointer border-none font-sans ${
              filter === 'all'
                ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
            }`}
          >
            All Classes ({rows.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('in_review')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors cursor-pointer border-none font-sans ${
              filter === 'in_review'
                ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
            }`}
          >
            In Review ({inReviewCount})
          </button>
          {revisionCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter('revision')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-colors cursor-pointer border-none font-sans ${
                filter === 'revision'
                  ? 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300 shadow-xs font-bold'
                  : 'text-red-500 hover:text-red-700'
              }`}
            >
              Needs Revision ({revisionCount})
            </button>
          )}
          <button
            type="button"
            onClick={() => setFilter('approved')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors cursor-pointer border-none font-sans ${
              filter === 'approved'
                ? 'bg-white dark:bg-gray-800 text-green-600 dark:text-green-400 shadow-xs'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
            }`}
          >
            Approved / Released ({approvedCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('unsubmitted')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors cursor-pointer border-none font-sans ${
              filter === 'unsubmitted'
                ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 shadow-xs'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
            }`}
          >
            Not Submitted ({unsubmittedCount})
          </button>
        </div>

        <div className="w-full sm:w-64">
          <SearchBar value={search} onChange={setSearch} placeholder="Search subject or section..." />
        </div>
      </div>

      {/* Grouped Tree Table (Like My Classes) */}
      <GroupedClassTree
        items={filteredItems}
        idPrefix="dash-progress"
        openGroups={openGroups}
        toggleGroup={toggleGroup}
        emptyMessage="No classes match the selected filter."
        headerRow={
          <tr className="bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[28%]">Subject</th>
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[12%]">Students</th>
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[18%]">Grade Sheet</th>
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[18%]">Class Record</th>
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[14%]">Stage</th>
            <th className="text-right px-4 py-2.5 pr-5 text-[10px] font-semibold uppercase tracking-wide w-[10%]">Actions</th>
          </tr>
        }
        renderRow={(c) => {
          const code = c.subject?.code || `cls-${c.id}`;
          const color = colorMap[code] || SUBJECT_COLORS[0];
          const stage = getStageInfo(c);
          const sheet = getDocStatus(c, 'sheet');
          const record = getDocStatus(c, 'record');
          const isSubmitted =
            c.all_released ||
            c.can_release ||
            c.chairperson_verified ||
            c.sent_to_chairperson ||
            ((c.student_count || 0) > 0 && (c.submitted_count || 0) >= c.student_count);
          const isReturned = c.awaiting_faculty_revision;

          return (
            <tr
              key={c.id}
              className={`border-t border-gray-50 dark:border-gray-800/80 hover:bg-gray-50/60 dark:hover:bg-gray-800/40 transition-colors ${
                isReturned ? 'bg-red-50/30 dark:bg-red-950/20' : ''
              }`}
            >
              {/* Subject */}
              <td className="px-4 py-3.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color.dot}`} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold truncate text-navy dark:text-white">{c.subject?.name}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {c.subject?.code} · {c.subject?.units} Units
                    </p>
                    {isReturned && c.chairperson_return_reason && (
                      <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 font-medium truncate">
                        Reason: {c.chairperson_return_reason}
                      </p>
                    )}
                  </div>
                </div>
              </td>

              {/* Students */}
              <td className="px-4 py-3.5">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800 shadow-xs">
                  <Icons.Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  {c.student_count || 0}
                </span>
              </td>

              {/* Grade Sheet Status */}
              <td className="px-4 py-3.5">
                <Badge variant={sheet.variant} className="text-xs">
                  {sheet.icon} {sheet.label}
                </Badge>
              </td>

              {/* Class Record Status */}
              <td className="px-4 py-3.5">
                <Badge variant={record.variant} className="text-xs">
                  {record.icon} {record.label}
                </Badge>
              </td>

              {/* Pipeline Stage */}
              <td className="px-4 py-3.5">{stage.badge}</td>

              {/* Actions */}
              <td className="px-4 py-3.5 text-right pr-5">
                <div className="flex items-center justify-end gap-1.5 flex-wrap">
                  {(isReturned || !isSubmitted) && (
                    <button
                      className={`btn-icon ${isReturned ? '!border-red-300 !text-red-600 hover:!bg-red-50' : ''}`}
                      onClick={() => onOpenClass && onOpenClass(c.id)}
                      title={isReturned ? 'Revise Grades' : 'Encode Grades'}
                    >
                      <Icons.Edit />
                    </button>
                  )}
                  <button
                    className="btn-icon"
                    onClick={() => setPreview({ cls: c, type: 'record' })}
                    title="Preview Class Record"
                  >
                    <Icons.Book />
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => setPreview({ cls: c, type: 'sheet' })}
                    title="Preview Grade Sheet"
                  >
                    <Icons.FileText />
                  </button>
                </div>
              </td>
            </tr>
          );
        }}
      />

      {/* Preview Modal (Same iframe preview pattern as My Classes) */}
      {preview && (
        <Modal
          title={`${DOC[preview.type].label} — ${preview.cls.subject?.code}${
            preview.cls.section ? ` Sec ${preview.cls.section}` : ''
          }`}
          onClose={() => setPreview(null)}
          size="max-w-[98vw]"
        >
          <iframe
            key={`${preview.cls.id}-${preview.type}`}
            src={`${DOC[preview.type].path}/${preview.cls.id}?preview=1`}
            title="Document preview"
            style={{
              width: '100%',
              height: 'calc(90vh - 130px)',
              minHeight: 360,
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              background: '#fff',
            }}
          />
        </Modal>
      )}
    </div>
  );
}
