import { useState, useEffect } from 'react';
import { Icons, Avatar, Badge, SearchBar, LoadingSpinner, EmptyState, StatCard, ProgramBadge, RegularityBadge, StudentTypeBadge, ConfirmDialog, formatStudentName, compareStudentNames, programShortLabel } from '../../components/common';
import StudentGradeRecordModal from '../../components/common/StudentGradeRecordModal';
import StudentWordImportModal from '../../components/admin/StudentWordImportModal';
import PromoteSectionModal from '../../components/common/PromoteSectionModal';
import EditSectionStudentsModal from '../../components/instructor/EditSectionStudentsModal';
import { userService } from '../../services';
import { usePageState } from '../../hooks/usePageState';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import toast from 'react-hot-toast';

const sectionKey = (a) => `${a.program}|${a.year_level}|${a.section}`;
const sectionLabel = (a) => `${programShortLabel(a.program)} ${a.year_level}-${a.section}`;

const RETAKE_STYLE = { Failed: 'bg-red-100 text-red-700', INC: 'bg-amber-100 text-amber-800', DRP: 'bg-gray-200 text-gray-700' };
const RETAKE_LABEL = { Failed: 'Failed', INC: 'INC', DRP: 'Dropped' };

// The overview's numbers from the live student list (current semester) —
// same shape the server saves when a semester ends (utils/advisoryOverview.js).
const overviewOf = (students) => {
  const graded = students.filter((st) => st.graded_count > 0);
  const withRetakes = graded.filter((st) => st.retakes.length > 0).sort(compareStudentNames);
  const all = withRetakes.flatMap((st) => st.retakes);
  return {
    students: students.length,
    passed_all: graded.length - withRetakes.length,
    with_retakes: withRetakes.length,
    failed: all.filter((r) => r.status === 'Failed').length,
    inc: all.filter((r) => r.status === 'INC').length,
    dropped: all.filter((r) => r.status === 'DRP').length,
    promoted: students.filter((st) => st.promoted).length,
    no_grades: students.length - graded.length,
    retake_students: withRetakes.map((st) => ({ id: st.id, name: st.name, student_no: st.student_no, retakes: st.retakes })),
  };
};

// One section's results for a semester, from its released grades: who passed
// everything and moves on, who has a subject to take again (Failed / INC /
// Dropped), and who was promoted. `archived` = a finished semester's saved
// copy (read-only wording, no card of its own).
function SemesterOverview({ data, semester, label = '', archived = false }) {
  const [open, setOpen] = useState(false);
  const hasGrades = data.students - data.no_grades > 0;

  const Tile = ({ value, label: text, sub, tone }) => (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <p className="text-2xl font-bold leading-none">{value}</p>
      <p className="text-[12px] font-semibold mt-1.5">{text}</p>
      {sub && <p className="text-[11px] opacity-75 mt-0.5">{sub}</p>}
    </div>
  );

  return (
    <div className={archived ? 'px-5 py-4 border-t border-gray-100' : 'px-5 py-3.5 border-b border-gray-100 bg-gray-50/40'}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2.5 flex flex-wrap items-center gap-2">
        {archived
          ? <><Icons.Archive className="w-3.5 h-3.5" /> {semester}{label ? ` · ${label}` : ''}</>
          : <>Semester overview{label ? ` · ${label}` : ''}{semester ? ` — ${semester}` : ''}</>}
      </p>
      {!hasGrades ? (
        <p className="text-[13px] text-gray-400">No grades have been released to this section yet — the overview fills in once they are.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile value={data.passed_all} label="Passed all subjects" sub={archived ? 'Moved on to the next semester as Regular' : 'Moving on to the next semester as Regular'} tone="bg-green-50 border-green-200 text-green-800" />
            <Tile value={data.with_retakes} label="With a subject to retake" sub={`${data.failed} failed · ${data.inc} INC · ${data.dropped} dropped`} tone="bg-red-50 border-red-200 text-red-800" />
            <Tile value={`${data.promoted}/${data.students}`} label={archived ? 'Promoted' : 'Promoted so far'} sub={data.promoted === data.students ? 'Everyone is promoted' : archived ? 'When the semester ended' : 'Use Promotion to promote the rest'} tone="bg-blue-50 border-blue-200 text-blue-800" />
            <Tile value={data.no_grades} label={archived ? 'No released grades' : 'No released grades yet'} sub="Not counted above" tone="bg-white border-gray-200 text-gray-600" />
          </div>

          {data.retake_students.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                className="text-[12px] font-semibold text-navy bg-transparent border-none cursor-pointer font-sans flex items-center gap-1 p-0"
                onClick={() => setOpen((o) => !o)}
              >
                <Icons.ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
                {open ? 'Hide' : 'Show'} the {data.retake_students.length} student{data.retake_students.length !== 1 ? 's' : ''} with a subject to retake
              </button>
              {open && (
                <div className="mt-2 rounded-lg border border-gray-200 bg-white overflow-hidden max-h-64 overflow-y-auto">
                  <table className="w-full text-[13px]">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="text-[11px] uppercase text-gray-500">
                        <th className="px-4 py-2 text-left w-[38%]">Student</th>
                        <th className="px-4 py-2 text-left">Subject(s) to take again</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.retake_students.map((st) => (
                        <tr key={st.id} className="border-t border-gray-100">
                          <td className="px-4 py-2">
                            <p className="font-medium">{formatStudentName(st.name)}</p>
                            <p className="text-[11px] text-gray-400">{st.student_no}</p>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap gap-1.5">
                              {st.retakes.map((r) => (
                                <span key={r.code} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${RETAKE_STYLE[r.status] || 'bg-gray-100 text-gray-700'}`} title={r.name}>
                                  {r.code} · {RETAKE_LABEL[r.status] || r.status}{r.status === 'Failed' && r.grade != null ? ` ${Number(r.grade).toFixed(2)}` : ''}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Faculty's own advisory sections (set by the Admin from User Management) — every current student of each Program / Year / Section, with
// their full grade record one click away (same read-only record Admin/
// Chairperson open from User Management).
export default function MyAdvisory() {
  const [advisories, setAdvisories] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [semester, setSemester] = useState(null);
  // Overviews of semesters that already ended (saved per section).
  const [archivedOverviews, setArchivedOverviews] = useState([]);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [search, setSearch] = useState('');
  // '' = all sections, else one section's key.
  const [activeSection, setActiveSection] = useState('');
  const [gradesTarget, setGradesTarget] = useState(null);
  // The section whose imported students are open for double-checking / editing.
  const [editSection, setEditSection] = useState(null);
  // Deactivate / activate an advisee's account (confirmed first).
  const [statusTarget, setStatusTarget] = useState(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const toggleStatus = async () => {
    const s = statusTarget;
    setSavingStatus(true);
    try {
      const next = s.status === 'Deactivated' ? 'Active' : 'Deactivated';
      await userService.updateAdvisee(s.id, { status: next });
      toast.success(next === 'Active' ? `${formatStudentName(s.name)}'s account is active again.` : `${formatStudentName(s.name)}'s account was deactivated.`);
      setStatusTarget(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change the account status');
    } finally {
      setSavingStatus(false);
    }
  };
  // Per-section history ({ sectionKey: [entries] }), import / promote dialogs.
  const [activity, setActivity] = useState({});
  const [historyOpen, setHistoryOpen] = useState({});
  // Which sections' student lists are open (only used with 2+ sections).
  // Remembered while navigating within the session.
  const [expanded, setExpanded] = usePageState('MyAdvisory.expanded', {});
  const [importTarget, setImportTarget] = useState(null);
  const [promoteTarget, setPromoteTarget] = useState(null);

  const load = async () => {
    try {
      const { data } = await userService.getMyAdvisory();
      setAdvisories(data.advisories || []);
      setStudents((data.students || []).map((s) => ({ ...s, retakes: s.retakes || [] })));
      setSemester(data.current_semester || null);
      setArchivedOverviews(data.archived_overviews || []);
      setActivity(data.activity || {});
    } catch (err) {
      toast.error('Failed to load your advisory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useAutoRefresh(() => load());

  // Where each advisee is: still on first-login setup, not in any class yet
  // this semester (no faculty has listed them), or in N classes.
  const statusBadge = (s) => {
    if (s.status === 'Deactivated') return <Badge variant="red">Deactivated</Badge>;
    if (!s.account_setup_at) return <Badge variant="gray">Account not set up</Badge>;
    if (!s.class_count) return <Badge variant="yellow">Not in a class yet</Badge>;
    return <Badge variant="green">In {s.class_count} class{s.class_count !== 1 ? 'es' : ''}</Badge>;
  };

  if (loading) return <LoadingSpinner />;

  const sorted = advisories.slice().sort((a, b) => sectionLabel(a).localeCompare(sectionLabel(b)));
  const studentsOf = (a) => students.filter((s) => s.program === a.program && Number(s.year_level) === Number(a.year_level) && s.section === a.section);
  const shownSections = activeSection ? sorted.filter((a) => sectionKey(a) === activeSection) : sorted;
  const q = search.trim().toLowerCase();
  const matches = (s) => !q || s.name?.toLowerCase().includes(q) || s.student_no?.includes(q);

  const regularCount = students.filter((s) => !!s.account_setup_at && s.student_status === 'Regular').length;
  const irregularCount = students.filter((s) => !!s.account_setup_at && s.student_status === 'Irregular').length;
  const noClassCount = students.filter((s) => !s.class_count).length;

  return (
    <>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-navy">My Advisory</h2>
        <p className="text-[13px] text-gray-500">
          {advisories.length
            ? `You are the adviser of ${sorted.map(sectionLabel).join(', ')}. View your advisees and their grade records.`
            : 'Your advisory sections and their students.'}
        </p>
      </div>

      {!advisories.length ? (
        <div className="card">
          <EmptyState
            icon={<Icons.User className="w-8 h-8 opacity-30" />}
            title="No advisory assigned yet"
            description="The Admin assigns your advisory sections from User Management."
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              label={advisories.length === 1 ? 'Advisory' : 'Advisory Sections'}
              value={advisories.length === 1 ? sectionLabel(advisories[0]) : advisories.length}
              icon={<Icons.Award />}
              iconBg="bg-blue-50 text-blue-600"
            />
            <StatCard label="Advisees" value={students.length} icon={<Icons.Users />} iconBg="bg-blue-50 text-blue-500" />
            <StatCard label="Regular" value={regularCount} icon={<Icons.Check />} iconBg="bg-green-50 text-green-600" />
            <StatCard label="Irregular" value={irregularCount} sub={`${noClassCount} not in a class yet`} icon={<Icons.AlertTriangle />} iconBg="bg-red-50 text-red-500" />
          </div>

          {/* ARCHIVED — a semester's overview is saved when it ends, and the
              one above starts over for the new semester. */}
          {archivedOverviews.length > 0 && (
            <div className="card overflow-hidden mb-3">
              <button
                type="button"
                onClick={() => setArchivedOpen((o) => !o)}
                className="w-full px-5 py-3 flex items-center justify-between bg-gray-50 border-none cursor-pointer font-sans text-left"
              >
                <span className="flex items-center gap-2 text-sm font-bold text-gray-700">
                  <Icons.Archive className="w-4 h-4" /> Archived overviews
                  <span className="text-[11px] font-semibold bg-gray-200 text-gray-700 rounded-full px-2 py-0.5">{archivedOverviews.length}</span>
                  <span className="text-[11px] font-normal text-gray-400 hidden sm:inline">Semesters that have ended</span>
                </span>
                {archivedOpen ? <Icons.ChevronUp className="w-4 h-4 text-gray-500" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-500" />}
              </button>
              {archivedOpen && archivedOverviews.map((o) => (
                <SemesterOverview key={o.id} archived data={o.data} semester={o.semester} label={sectionLabel(o)} />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 mt-4">
            {advisories.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                <button
                  className={`px-3 py-1.5 rounded-full text-[13px] font-semibold border cursor-pointer font-sans ${!activeSection ? 'bg-navy text-white border-navy' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                  onClick={() => setActiveSection('')}
                >
                  All Sections ({students.length})
                </button>
                {sorted.map((a) => (
                  <button
                    key={sectionKey(a)}
                    className={`px-3 py-1.5 rounded-full text-[13px] font-semibold border cursor-pointer font-sans ${activeSection === sectionKey(a) ? 'bg-navy text-white border-navy' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    onClick={() => setActiveSection(sectionKey(a))}
                  >
                    {sectionLabel(a)} ({studentsOf(a).length})
                  </button>
                ))}
              </div>
            ) : <div />}
            <div className="w-full sm:w-72 flex">
              <SearchBar value={search} onChange={setSearch} placeholder="Search name or student no..." />
            </div>
          </div>

          {shownSections.map((a) => {
            const all = studentsOf(a);
            const visible = all.filter(matches).sort(compareStudentNames);
            // More than one section: each is a dropdown, collapsed until
            // opened (or while a search finds students in it). Picking one
            // section from the chips above shows it open.
            const collapsible = advisories.length > 1 && !activeSection;
            const open = !collapsible || !!expanded[sectionKey(a)] || (!!q && visible.length > 0);
            const toggle = () => setExpanded((o) => ({ ...o, [sectionKey(a)]: !o[sectionKey(a)] }));
            return (
              <div key={sectionKey(a)}>
              <div className="card overflow-hidden mb-5">
                <div
                  className={`flex flex-wrap items-center gap-2.5 px-5 py-3 ${open ? 'border-b border-gray-100' : ''} ${collapsible ? 'cursor-pointer hover:bg-gray-50/60' : ''}`}
                  onClick={collapsible ? toggle : undefined}
                  role={collapsible ? 'button' : undefined}
                  aria-expanded={collapsible ? open : undefined}
                >
                  {collapsible && (
                    <Icons.ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? '' : '-rotate-90'}`} />
                  )}
                  <ProgramBadge program={a.program} bs />
                  <span className="text-sm font-semibold text-navy">Year {a.year_level} · Section {a.section}</span>
                  <span className="text-xs text-gray-400">{all.length} student{all.length !== 1 ? 's' : ''}</span>
                  {/* Buttons act on the section without toggling it. */}
                  <div className="ml-auto flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-outline btn-sm flex items-center gap-1.5" onClick={() => setHistoryOpen((o) => ({ ...o, [sectionKey(a)]: !o[sectionKey(a)] }))}>
                      <Icons.Clock className="w-3.5 h-3.5" /> History{(activity[sectionKey(a)] || []).length ? ` (${activity[sectionKey(a)].length})` : ''}
                    </button>
                    <button className="btn btn-outline btn-sm flex items-center gap-1.5" onClick={() => setImportTarget(a)}>
                      <Icons.Upload className="w-3.5 h-3.5" /> Import Class List
                    </button>
                    <button
                      className="btn btn-outline btn-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => setEditSection(a)}
                      disabled={!all.length}
                      title={all.length ? 'Double-check and correct the imported students' : 'Import the class list first'}
                    >
                      <Icons.Edit className="w-3.5 h-3.5" /> Edit Students
                    </button>
                    <button className="btn btn-primary btn-sm flex items-center gap-1.5" onClick={() => setPromoteTarget(a)} disabled={!all.length}>
                      <Icons.Award className="w-3.5 h-3.5" /> Promotion
                    </button>
                  </div>
                </div>

                {/* Everything done to this section — by this adviser or earlier ones. */}
                {historyOpen[sectionKey(a)] && (
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60 max-h-48 overflow-y-auto">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Section history</p>
                    {(activity[sectionKey(a)] || []).length === 0 ? (
                      <p className="text-[13px] text-gray-400">Nothing recorded for this section yet.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {activity[sectionKey(a)].map((h) => (
                          <li key={h.id} className="text-[13px] flex flex-wrap gap-x-2">
                            <span className="text-gray-400 whitespace-nowrap">{new Date(h.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                            <span><b className="text-navy">{h.user_name || 'System'}</b> <span className="text-gray-600">{h.action}</span></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Section's Semester Overview (grades, retakes, promotion status) — inside the section container, above the student table */}
                {open && all.length > 0 && (
                  <SemesterOverview data={overviewOf(all)} semester={semester} />
                )}

                {!open ? null : visible.length === 0 ? (
                  <EmptyState
                    icon={<Icons.Users className="w-8 h-8 opacity-30" />}
                    title={all.length === 0 ? 'No students in this section yet' : 'No matching students'}
                    description={all.length === 0 ? 'Use "Import Class List" above to bring in this section\'s students from its class list.' : 'Try a different search.'}
                  />
                ) : (
                  <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                    <table className="w-full table-fixed min-w-[820px]">
                      <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-100">
                        <tr className="text-gray-500 text-[11px] font-semibold uppercase tracking-wider">
                          <th className="pl-5 pr-1 py-2 text-right w-12">#</th>
                          <th className="px-2 py-2 text-left">Student</th>
                          <th className="px-2 py-2 text-center w-[130px]">Student No.</th>
                          <th className="px-2 py-2 text-center w-[190px]">Student Status</th>
                          <th className="px-2 py-2 pr-5 text-center w-[160px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((s, idx) => (
                          <tr key={s.id} className={`border-t border-gray-50 first:border-0 hover:bg-gray-50/50 ${s.status === 'Deactivated' ? 'opacity-60' : ''}`}>
                            <td className="pl-5 pr-1 py-2.5 w-8 text-xs text-gray-400 text-right">{idx + 1}.</td>
                            <td className="px-2 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <Avatar letter={s.avatar || s.name?.[0]} className="bg-blue-500 text-white" size="w-7 h-7 text-xs" />
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-[13px] font-medium">{formatStudentName(s.name)}</p>
                                  {!!s.account_setup_at && (
                                    <>
                                      <RegularityBadge status={s.student_status} />
                                      <StudentTypeBadge status={s.student_type} />
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-2.5 text-[13px] text-gray-500 text-center font-mono">{s.student_no || '—'}</td>
                            <td className="px-2 py-2.5 text-center">
                              {statusBadge(s)}
                              {!!s.account_setup_at && s.student_status === 'Irregular' && s.irregular_sections?.length > 0 && (
                                <p className="text-[11px] text-gray-400 mt-0.5">Taking: {s.irregular_sections.map((p) => `Y${p.year_level}-${p.section}`).join(', ')}</p>
                              )}
                            </td>
                            <td className="px-2 py-2.5 pr-5 whitespace-nowrap">
                              <div className="flex justify-center gap-1.5">
                                <button
                                  className={`btn-icon ${s.status === 'Deactivated' ? 'hover:!bg-green-50 hover:!text-green-600' : 'hover:!bg-red-50 hover:!text-red-500'}`}
                                  onClick={() => setStatusTarget(s)}
                                  title={s.status === 'Deactivated' ? 'Activate account' : 'Deactivate account'}
                                >
                                  {s.status === 'Deactivated' ? <Icons.Check /> : <Icons.X />}
                                </button>
                                <button className="btn-icon" onClick={() => setGradesTarget(s)} title="View Grades (1st-4th Year + GWA)">
                                  <Icons.FileText />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              </div>
            );
          })}
        </>
      )}

      {statusTarget && (
        <ConfirmDialog
          title={statusTarget.status === 'Deactivated' ? 'Activate account?' : 'Deactivate account?'}
          message={statusTarget.status === 'Deactivated'
            ? `${formatStudentName(statusTarget.name)} will be able to sign in again.`
            : `${formatStudentName(statusTarget.name)} won't be able to sign in until the account is activated again. Their grades and records are kept.`}
          confirmText={savingStatus ? 'Saving…' : statusTarget.status === 'Deactivated' ? 'Activate' : 'Deactivate'}
          variant={statusTarget.status === 'Deactivated' ? 'green' : 'red'}
          onConfirm={toggleStatus}
          onCancel={() => setStatusTarget(null)}
        />
      )}
      {editSection && (
        <EditSectionStudentsModal
          section={editSection}
          sectionLabel={`${sectionLabel(editSection)}`}
          students={studentsOf(editSection)}
          advisories={advisories}
          onClose={() => setEditSection(null)}
          onSaved={load}
        />
      )}
      {gradesTarget && <StudentGradeRecordModal studentId={gradesTarget.id} onClose={() => setGradesTarget(null)} />}
      {importTarget && (
        <StudentWordImportModal
          isOpen
          advisoryContext={importTarget}
          onClose={() => { setImportTarget(null); load(); }}
          onSuccess={load}
        />
      )}
      {promoteTarget && <PromoteSectionModal section={promoteTarget} onClose={() => setPromoteTarget(null)} onDone={load} />}
    </>
  );
}
