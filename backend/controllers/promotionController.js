const { USER_SECRET_FIELDS } = require('../utils/userFields');
const { User, Grade, Class, Subject, Enrollment, Semester } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
// Shared "notify every Admin" helper — emits the real-time
// `notification:${userId}` Socket.IO event the frontend bell (and its
// notification sound) listens for, unlike a bare Notification.create which
// would leave it silently sitting there until the recipient's next page
// load/manual refresh.
const { notifyAdmins, createNotification } = require('./notificationController');
const { followsCurriculum } = require('../utils/studentCurriculum');

const { logSectionActivity } = require('../utils/sectionActivity');

// ── Advisers: promotion is done by each section's adviser ────────────────────
const advisoriesOf = async (userId) => {
  const me = await User.findByPk(userId, { attributes: ['advisories'] });
  return Array.isArray(me?.advisories) ? me.advisories : [];
};
const sameSection = (a, b) => a.program === b.program && Number(a.year_level) === Number(b.year_level) && a.section === b.section;
const advisesSection = async (userId, sec) => (await advisoriesOf(userId)).some((a) => sameSection(a, sec));

// ── Helper: detect semester order from name ───────────────────────────────────
const getSemesterOrder = (semesterName = '') => {
  const lower = semesterName.toLowerCase();
  if (lower.includes('2nd') || lower.includes('second')) return '2nd';
  if (lower.includes('1st') || lower.includes('first')) return '1st';
  return null;
};

// Subject.semester is stored as the short curriculum label ('1st Semester' /
// '2nd Semester'), not the full Semester record name ('First Semester
// 2026-2027') evaluateStudents/promoteStudents are called with — this maps
// between the two. Summer has no curriculum "full load" concept, so there's
// nothing to map it to; callers skip the completeness check when this is null.
const SEMESTER_ORDER_TO_SUBJECT_LABEL = { '1st': '1st Semester', '2nd': '2nd Semester' };

// A student's grades for the semester are only "fully verified" once every
// class they were graded in has been Chairperson-verified AND every Passed
// grade among them has been Admin-approved — the same two-sign-off gate
// gradeController.releaseClassGrades already enforces per class, just
// checked here across all of a student's classes at once. Failed/INC/DRP
// grades don't go through Admin approval at all (only Passed ones do), so
// they only need the Chairperson-verified half.
const isFullyVerified = (grades) =>
  grades.length > 0 && grades.every((g) => g.class?.chairperson_verified && (g.status !== 'Passed' || g.admin_approved));

// A Failed subject never blocks promotion — the student advances on schedule
// regardless of what they failed, flagged Irregular with the retake(s)
// riding along on top of next term's normal load (see promoteStudents).
// What a subject's own prerequisite/co-requisite chain still gates is
// RE-ENROLLING in that specific failed subject: same as any first-time
// enrollment, it can't be retaken until whatever it requires has itself been
// passed. classController.createClass checks this per candidate before
// auto-enrolling a retake. This just computes, given a subject and a
// student's own passed-subject set, which of its prerequisites/
// co-requisites are still unmet.
const unmetPrereqsFor = (subject, passedSet) =>
  [...(subject?.prerequisites || []), ...(subject?.co_requisites || [])].filter((p) => !passedSet.has(p.id));

// A student is only "done" with a subject once they have a Passed grade for
// it — Failed/INC/DRP/never-graded all count as not completed.
const passedSubjectIdsByStudent = (gradesByStudent) => {
  const map = {};
  Object.entries(gradesByStudent).forEach(([studentId, grades]) => {
    map[studentId] = new Set(grades.filter((g) => g.status === 'Passed').map((g) => g.class?.subject_id).filter(Boolean));
  });
  return map;
};

// Fetches every curriculum-required subject for the (program, year_level)
// pairs actually present among the given students, for the given semester
// label — one query instead of one per student — then groups them back per
// pair for O(1) lookup. Returns null (skip the completeness check entirely)
// when semOrder doesn't map to a real curriculum semester (e.g. Summer).
const getRequiredSubjectsByProgramYear = async (students, semOrder) => {
  const subjectSemester = SEMESTER_ORDER_TO_SUBJECT_LABEL[semOrder];
  if (!subjectSemester) return null;

  const pairs = [...new Set(students.map((s) => `${s.program}|${s.year_level}`))]
    .map((pair) => {
      const [program, yearLevel] = pair.split('|');
      return { program, year_level: parseInt(yearLevel) };
    })
    .filter((p) => p.program && p.year_level);
  if (pairs.length === 0) return {};

  const subjects = await Subject.findAll({
    where: { [Op.or]: pairs, semester: subjectSemester },
    attributes: ['id', 'code', 'name', 'program', 'year_level', 'curriculum_year'],
    // Needed to tell "just hasn't taken it yet" apart from "can't even
    // enroll — the prerequisite/co-requisite isn't satisfied" (see
    // missingSubjectsBlockedByPrereqs below).
    include: [
      { model: Subject, as: 'prerequisites', through: { attributes: [] }, attributes: ['id', 'code', 'name'] },
      { model: Subject, as: 'co_requisites', through: { attributes: [] }, attributes: ['id', 'code', 'name'] },
    ],
  });

  const byPair = {};
  subjects.forEach((s) => {
    const key = `${s.program}|${s.year_level}`;
    if (!byPair[key]) byPair[key] = [];
    byPair[key].push(s);
  });
  return byPair;
};

// ================= GET /api/promotions/evaluate =================
// Fetches ALL students and ALL their grades in just 2 queries total.
// No more 1 query per student — much faster regardless of student count.
const evaluateStudents = asyncHandler(async (req, res) => {
  const { semester, program, year_level, section } = req.query;

  if (!semester) {
    return res.status(400).json({ message: 'Semester is required.' });
  }

  // Promotion is the adviser's job, one advisory section at a time.
  if (!(await advisesSection(req.user.id, { program, year_level, section }))) {
    return res.status(403).json({ message: 'You can only evaluate your own advisory section.' });
  }

  const semOrder = getSemesterOrder(semester);

  // ── Query 1: Get all matching students ───────────────────────────────
  // Graduated students are archived — never re-evaluated for promotion.
  const studentWhere = { role: 'Student', status: 'Active', graduated_at: null, program, year_level: parseInt(year_level, 10), section };

  const students = await User.findAll({
    where: studentWhere,
    attributes: { exclude: USER_SECRET_FIELDS },
    order: [
      ['program', 'ASC'],
      ['year_level', 'ASC'],
      ['section', 'ASC'],
      ['name', 'ASC'],
    ],
  });

  if (students.length === 0) {
    return res.json({
      semester,
      semester_order: semOrder,
      students: [],
      summary: { total: 0, eligible: 0, retake_required: 0, retake_blocked_by_prereq: 0, missing_prerequisites: 0, incomplete: 0, pending_verification: 0, graduating: 0, no_grades: 0, already_promoted: 0 },
    });
  }

  const studentIds = students.map(s => s.id);

  // ── Query 2: Get ALL submitted grades for ALL students in one shot ───
  // Instead of 1 query per student, we fetch everything at once and
  // group them in JavaScript — much faster.
  const allGrades = await Grade.findAll({
    where: {
      student_id: { [Op.in]: studentIds },
      submitted: true,
    },
    include: [{
      model: Class,
      as: 'class',
      where: { semester },
      required: true,
      include: [{
        model: Subject,
        as: 'subject',
        attributes: ['id', 'code', 'name'],
        // Needed to compute which of a Failed subject's own prerequisites/
        // co-requisites are still unmet — see unmetPrereqsFor above.
        include: [
          { model: Subject, as: 'prerequisites', through: { attributes: [] }, attributes: ['id', 'code'] },
          { model: Subject, as: 'co_requisites', through: { attributes: [] }, attributes: ['id', 'code'] },
        ],
      }],
    }],
  });

  // ── Group grades by student_id in JavaScript ─────────────────────────
  const gradesByStudent = {};
  allGrades.forEach(g => {
    const sid = g.student_id;
    if (!gradesByStudent[sid]) gradesByStudent[sid] = [];
    gradesByStudent[sid].push(g);
  });
  const passedSubjectIds = passedSubjectIdsByStudent(gradesByStudent);

  // Curriculum-required subjects per (program, year_level), for this semester
  // — null when semOrder doesn't map to a real curriculum semester (Summer),
  // in which case the "completed everything" rule is simply skipped below.
  const requiredByProgramYear = await getRequiredSubjectsByProgramYear(students, semOrder);

  // ── Build student data using the pre-grouped grades ──────────────────
  const studentData = students.map(student => {
    const grades = gradesByStudent[student.id] || [];

    const passedSet = passedSubjectIds[student.id] || new Set();

    const passedCount = grades.filter(g => g.status === 'Passed').length;
    const failedGrades = grades.filter(g => g.status === 'Failed');
    const failedCount = failedGrades.length;
    // Every Failed subject is retake-required now — none of them block
    // promotion (see unmetPrereqsFor above). They ride along as an extra
    // retake on top of next term's normal load, flagged per subject with
    // whichever of ITS OWN prerequisites/co-requisites are still unmet —
    // that's what actually gates re-enrolling in it, checked again at
    // auto-enroll time in classController.createClass.
    const retakableFailedGrades = failedGrades;
    const retakableFailedSubjectIds = new Set(retakableFailedGrades.map((g) => g.class?.subject_id).filter(Boolean));

    // This system is going live starting in a 2nd Semester — a continuing
    // (Year 2-4) student's own 1st Semester of that same year happened
    // before the system existed, so there's no way their 1st-Sem subjects
    // could ever show as Passed in here. Requiring full 1st-Sem curriculum
    // completeness for them would permanently flag every continuing student
    // "Incomplete" over data that predates the system entirely — so the
    // completeness check is skipped for them specifically, the same way it
    // already skips for Summer (semOrder not mapping to a real curriculum
    // semester). Real enforcement starts at their own 2nd Semester onward.
    // Year 1 students are unaffected — 1st Semester genuinely IS where their
    // own record with this system starts, so the normal full check applies.
    const skipCompletenessCheck = semOrder === '1st' && student.year_level > 1;
    const requiredSubjects = (requiredByProgramYear && !skipCompletenessCheck)
      ? (requiredByProgramYear[`${student.program}|${student.year_level}`] || []).filter((subj) => followsCurriculum(subj, student))
      : null;
    // A retakable Failed subject was actually attempted, not skipped —
    // excluded here so it doesn't double as "missing" on top of already
    // being accounted for by retakableFailedGrades/"Eligible (Retake
    // Required)" below.
    const missingSubjects = requiredSubjects
      ? requiredSubjects.filter((s) => !(passedSubjectIds[student.id] || new Set()).has(s.id) && !retakableFailedSubjectIds.has(s.id))
      : [];
    // Prerequisites start checking at the 2nd Semester of system deployment.
    // In the 1st Semester, students' prior history predates system records, so
    // prerequisite checks are skipped until 2nd Semester onward.
    const missingSubjectsBlockedByPrereqs = semOrder === '2nd'
      ? missingSubjects.filter((s) =>
          (s.prerequisites || []).some((p) => !passedSet.has(p.id)) ||
          (s.co_requisites || []).some((p) => !passedSet.has(p.id))
        )
      : [];

    const isSetup = !!student.account_setup_at;
    const gwa = isSetup && grades.length > 0
      ? (grades.reduce((sum, g) => sum + parseFloat(g.average || 0), 0) / grades.length).toFixed(3)
      : null;

    const fullyVerified = isFullyVerified(grades);
    const alreadyReleased = grades.length > 0 && grades.every((g) => g.released);
    const unverifiedClasses = [...new Map(
      grades
        .filter((g) => !(g.class?.chairperson_verified && (g.status !== 'Passed' || g.admin_approved)))
        .map((g) => [g.class?.subject?.code, { code: g.class?.subject?.code, name: g.class?.subject?.name }])
    ).values()];

    // Determine promotion status — a student isn't Eligible just because
    // nothing they were graded on was Failed; they also have to have
    // actually completed (Passed) every subject the curriculum requires for
    // their year+semester, AND every one of those grades has to have cleared
    // both sign-offs (Chairperson verification + Admin approval) — the same
    // gate individual classes already enforce before releasing to students,
    // checked here across the whole semester before anyone gets promoted. A
    // subject with no grade at all (never enrolled, or enrolled but never
    // submitted) still blocks promotion the same way it always did — it's
    // just a distinct, more specific status so a Chairperson can tell
    // "still missing work" apart from "done, just not signed off yet". A
    // Failed grade never blocks on its own anymore — see retakableFailedGrades.
    // Not passing a subject (or having no grade for one) no longer holds a
    // student back — it's a retake, and they're still promoted (marked
    // Irregular). Only unfinished paperwork (verification/approval) waits.
    const hasRetakes = retakableFailedGrades.length > 0 || missingSubjects.length > 0
      || grades.some((g) => g.status === 'INC' || g.status === 'DRP');
    let promotionStatus;
    if (grades.length === 0) {
      promotionStatus = 'No Grades';
    } else if (!fullyVerified) {
      promotionStatus = 'Pending Verification';
    } else if (!alreadyReleased) {
      // Approved, but the Admin hasn't released the grades to the students
      // yet — the adviser can't promote until they're released.
      promotionStatus = 'Pending Release';
    } else if (student.last_promoted_semester === semester) {
      // Already processed by a previous Promote run for this exact semester
      // — 1st-semester clearing doesn't change year_level, so without this
      // flag they'd otherwise keep showing up as freshly "Eligible" forever,
      // with no way to tell they were already handled.
      promotionStatus = 'Already Promoted';
    } else if (hasRetakes) {
      // Otherwise fully on track, but still owes a retake or two on
      // standalone (no prerequisite/co-requisite) subjects — promotable, but
      // still flagged Irregular once actually promoted (see promoteStudents)
      // since they genuinely have a non-standard subject mix now.
      promotionStatus = 'Eligible (Retake Required)';
    } else if (student.year_level >= 4 && semOrder === '2nd') {
      promotionStatus = 'For Graduation';
    } else {
      promotionStatus = 'Eligible';
    }

    // Determine next step label
    const nextStep = (() => {
      if (promotionStatus === 'For Graduation') return 'Graduation';
      if (promotionStatus !== 'Eligible' && promotionStatus !== 'Eligible (Retake Required)') return null;
      if (semOrder === '1st') return `Year ${student.year_level} — 2nd Semester`;
      if (semOrder === '2nd') return `Year ${student.year_level + 1} — 1st Semester`;
      return null;
    })();

    return {
      id: student.id,
      name: student.name,
      student_no: student.student_no,
      email: student.email,
      avatar: student.avatar,
      program: student.program,
      year_level: student.year_level,
      section: student.section,
      account_setup_at: student.account_setup_at,
      gwa,
      passed_count: passedCount,
      failed_count: failedCount,
      // Every Failed subject, surfaced separately from `grades` below so the
      // UI can call out "still owes a retake" without re-deriving it. Each
      // one flags whether its own prerequisite/co-requisite chain is still
      // unmet — that's what actually blocks re-enrolling in it (see
      // unmetPrereqsFor above), not whether the student can advance.
      // Starts gating at 2nd Semester onward.
      retakable_failed_subjects: retakableFailedGrades.map((g) => {
        const unmet = semOrder === '2nd' ? unmetPrereqsFor(g.class?.subject, passedSet) : [];
        return {
          code: g.class?.subject?.code,
          name: g.class?.subject?.name,
          blocked_by_prereq: unmet.length > 0,
          unmet_prerequisites: unmet.map((p) => p.code),
        };
      }),
      required_count: requiredSubjects ? requiredSubjects.length : null,
      missing_subjects: missingSubjects.map((s) => ({ code: s.code, name: s.name })),
      missing_prerequisites: missingSubjectsBlockedByPrereqs.map((s) => ({
        code: s.code,
        name: s.name,
        // Which of ITS prerequisites/co-requisites the student still hasn't
        // passed — the actual thing blocking them, not just "this subject".
        unmet: [...(s.prerequisites || []), ...(s.co_requisites || [])]
          .filter((p) => !passedSet.has(p.id))
          .map((p) => p.code),
      })),
      fully_verified: fullyVerified,
      already_released: alreadyReleased,
      unverified_subjects: unverifiedClasses,
      promotion_status: promotionStatus,
      next_step: nextStep,
      grades: grades.map(g => ({
        subject_code: g.class?.subject?.code,
        subject_name: g.class?.subject?.name,
        midterm: g.midterm,
        finals: g.finals,
        average: g.average,
        status: g.status,
        released: g.released,
      })),
    };
  });

  // ── Per-subject completion tally — "how many of these students have
  // actually finished this subject" — so a Chairperson can see at a glance
  // which specific subjects are the bottleneck for the whole batch, not just
  // which students are stuck. One row per curriculum-required subject
  // actually relevant to the students being evaluated.
  const subjectCompletion = requiredByProgramYear
    ? Object.values(requiredByProgramYear).flat().map((subj) => {
        const relevant = studentData.filter((s) => s.program === subj.program && s.year_level === subj.year_level);
        const completed = relevant.filter((s) => (passedSubjectIds[s.id] || new Set()).has(subj.id)).length;
        return {
          subject_id: subj.id,
          code: subj.code,
          name: subj.name,
          program: subj.program,
          year_level: subj.year_level,
          completed_count: completed,
          total_count: relevant.length,
        };
      }).sort((a, b) => (a.year_level - b.year_level) || a.code.localeCompare(b.code))
    : [];

  res.json({
    semester,
    subject_completion: subjectCompletion,
    semester_order: semOrder,
    students: studentData,
    summary: {
      total: studentData.length,
      eligible: studentData.filter(s => s.promotion_status === 'Eligible' || s.promotion_status === 'Eligible (Retake Required)').length,
      retake_required: studentData.filter(s => s.promotion_status === 'Eligible (Retake Required)').length,
      // No status is "Failed Subjects" anymore (a Failed grade never blocks
      // promotion by itself) — this instead counts students who DO have a
      // retake pending, but can't be auto-enrolled in it yet because its own
      // prerequisite/co-requisite chain isn't cleared. That's the group that
      // actually needs a Chairperson/Admin's attention.
      retake_blocked_by_prereq: studentData.filter(s => (s.retakable_failed_subjects || []).some(f => f.blocked_by_prereq)).length,
      missing_prerequisites: studentData.filter(s => s.promotion_status === 'Missing Prerequisites').length,
      incomplete: studentData.filter(s => s.promotion_status === 'Incomplete Subjects').length,
      pending_verification: studentData.filter(s => s.promotion_status === 'Pending Verification').length,
      graduating: studentData.filter(s => s.promotion_status === 'For Graduation').length,
      no_grades: studentData.filter(s => s.promotion_status === 'No Grades').length,
      already_promoted: studentData.filter(s => s.promotion_status === 'Already Promoted').length,
    },
  });
});

// ================= PROMOTION ENGINE =================
// One set of rules for both ways a student gets promoted:
//   - AUTOMATICALLY (auto: true, actor: null) — the system checks on its own:
//       · when Faculty release a 1st-Semester class's grades
//         (autoPromoteForClass → cleared for the 2nd Semester), and
//       · when a semester ends — Admin sets the next one as current
//         (autoPromoteSemester → year level up / graduation after the 2nd
//         Semester, so nobody jumps a year mid-semester).
//   - MANUALLY by the section's adviser (POST /promote).
//   The automatic paths are switched off (AUTO_PROMOTION below), so today
//   only the adviser promotes.
// A student is only promoted once every curriculum subject for their year +
// semester is verified by the Chairperson and approved by Admin. Not passing
// a subject never holds a student back — Failed / INC / Dropped subjects, and
// curriculum subjects with no grade at all, are carried as retakes and the
// student is marked Irregular. (Per-class automatic checks wait for the whole
// semester before promoting over a missing subject; the semester-end check
// and the adviser do not.) A prerequisite still has to be passed before its
// follow-up subject can be taken — enforced at class-list import
// (classController.importClassList).
const runPromotion = async ({ app, students, semester, actor = null, auto = false, final = !auto }) => {
  const semOrder = getSemesterOrder(semester);
  const result = { semOrder, processed: 0, graduatedCount: 0, skipped: 0, newlyIrregular: [], resultNames: [] };
  if (!semOrder || students.length === 0) return result;

  const studentIds = students.map((s) => s.id);
  const allGrades = await Grade.findAll({
    where: { student_id: { [Op.in]: studentIds }, submitted: true },
    include: [{
      model: Class,
      as: 'class',
      where: { semester },
      required: true,
      include: [{
        model: Subject,
        as: 'subject',
        attributes: ['id', 'code', 'name'],
        include: [
          { model: Subject, as: 'prerequisites', through: { attributes: [] }, attributes: ['id'] },
          { model: Subject, as: 'co_requisites', through: { attributes: [] }, attributes: ['id'] },
        ],
      }],
    }],
  });

  const gradesByStudent = {};
  allGrades.forEach((g) => { (gradesByStudent[g.student_id] = gradesByStudent[g.student_id] || []).push(g); });

  // Every class each student is enrolled in this semester. The automatic
  // per-class check (not final) only acts once ALL of them have released
  // grades — one released class must never clear a student for the next
  // semester while their other classes are still running.
  const enrolledClassIds = {};
  if (!final) {
    (await Enrollment.findAll({
      where: { student_id: { [Op.in]: studentIds } },
      include: [{ model: Class, as: 'class', where: { semester }, attributes: ['id'], required: true }],
      attributes: ['student_id'],
    })).forEach((e) => { (enrolledClassIds[e.student_id] = enrolledClassIds[e.student_id] || new Set()).add(e.class.id); });
  }
  const passedSubjectIds = passedSubjectIdsByStudent(gradesByStudent);
  const requiredByProgramYear = await getRequiredSubjectsByProgramYear(students, semOrder);

  // Where each student was before promoting — the section history entry goes there.
  const processedBySection = new Map();
  const countFor = (s) => {
    const sec = { program: s.program, year_level: s.year_level, section: s.section };
    const k = `${sec.program}|${sec.year_level}|${sec.section}`;
    if (!processedBySection.has(k)) processedBySection.set(k, { sec, count: 0, graduated: 0 });
    return processedBySection.get(k);
  };
  const updatePromises = [];
  const promotedNotices = []; // { id, message }

  for (const student of students) {
    // Already actioned for this exact semester — never promote twice.
    if (student.last_promoted_semester === semester) continue;

    const grades = gradesByStudent[student.id] || [];
    // Nothing graded this semester at all — not in school this term; left alone.
    if (grades.length === 0) continue;
    // Automatic per-class check: wait until every class the student is
    // enrolled in this semester has its grades released.
    if (!final) {
      const releasedClassIds = new Set(grades.filter((g) => g.released).map((g) => g.class_id));
      const enrolled = enrolledClassIds[student.id] || new Set();
      if ([...enrolled].some((cid) => !releasedClassIds.has(cid))) continue;
    }
    // Anything not Passed (Failed, INC, Dropped) is carried as a retake.
    const notPassedGrades = grades.filter((g) => g.status !== 'Passed');
    const notPassedIds = new Set(notPassedGrades.map((g) => g.class?.subject_id).filter(Boolean));

    // Curriculum subjects with no grade at all this semester (e.g. never on a
    // class list). Same exception as evaluateStudents: a continuing student's
    // 1st Semester from before the system existed isn't checked.
    let missingSubjects = [];
    const skipCompletenessCheck = semOrder === '1st' && student.year_level > 1;
    if (requiredByProgramYear && !skipCompletenessCheck) {
      const required = (requiredByProgramYear[`${student.program}|${student.year_level}`] || []).filter((subj) => followsCurriculum(subj, student));
      missingSubjects = required.filter((s) => !(passedSubjectIds[student.id] || new Set()).has(s.id) && !notPassedIds.has(s.id));
    }
    // Per-class automatic checks wait for the rest of the semester's classes;
    // the final check (semester end / adviser) promotes anyway, as a retake.
    if (missingSubjects.length && !final) continue;

    // Every grade the student DOES have must be verified + approved first.
    if (!isFullyVerified(grades)) continue;
    // The automatic run also waits until the student can see every grade
    // (released), so a promotion notice never arrives before the grades do.
    // Nobody is promoted — automatically or by the adviser — before the Admin
    // has released all of their grades to them.
    if (!grades.every((g) => g.released)) continue;

    // Not passing a subject never holds a student back — they're promoted and
    // marked Irregular, carrying it as a retake. (A subject that's a
    // prerequisite still has to be passed before its follow-up subject can be
    // taken — enforced when a class list is imported.)
    const retakeCodesList = [...notPassedGrades.map((g) => g.class?.subject?.code), ...missingSubjects.map((s) => s.code)].filter(Boolean);
    const hasRetake = retakeCodesList.length > 0;
    const irregularUpdate = (hasRetake && student.student_status !== 'Irregular') ? { student_status: 'Irregular' } : {};
    if (hasRetake && student.student_status !== 'Irregular') result.newlyIrregular.push({ id: student.id, name: student.name });
    const retakeCodes = retakeCodesList.join(', ');
    const retakeNote = hasRetake ? ` [retaking ${retakeCodes}]` : '';
    const retakeTail = hasRetake ? ` You still need to retake ${retakeCodes}.` : '';

    if (semOrder === '1st') {
      countFor(student).count++;
      updatePromises.push(student.update({ ...irregularUpdate, last_promoted_semester: semester }));
      result.processed++;
      result.resultNames.push(`${student.name} (cleared for 2nd Semester)${retakeNote}`);
      promotedNotices.push({ id: student.id, title: 'Cleared for the 2nd Semester', message: `You completed ${semester} and are cleared for the 2nd Semester.${retakeTail}` });
    } else if (semOrder === '2nd') {
      if (student.year_level < 4) {
        // Captured before .update() mutates the instance.
        const nextYear = student.year_level + 1;
        countFor(student).count++;
        updatePromises.push(student.update({ ...irregularUpdate, year_level: nextYear, last_promoted_semester: semester }));
        result.processed++;
        result.resultNames.push(`${student.name} → Year ${nextYear}${retakeNote}`);
        promotedNotices.push({ id: student.id, title: 'You have been promoted', message: `You completed ${semester} and are now in Year ${nextYear}${student.section ? ` — Section ${student.section}` : ''}.${retakeTail}` });
      } else {
        // Year 4, final semester → graduated (archived, never deleted). Still
        // owing a retake means not done yet — stays active.
        const graduate = !hasRetake;
        updatePromises.push(student.update({
          ...irregularUpdate,
          last_promoted_semester: semester,
          ...(graduate ? { graduated_at: new Date(), graduated_semester: semester } : {}),
        }));
        if (graduate) result.graduatedCount++;
        const tally = countFor(student);
        tally.count++;
        if (graduate) tally.graduated++;
        result.processed++;
        result.resultNames.push(`${student.name} (${graduate ? 'Graduated — archived' : 'Graduating, pending retake'})${retakeNote}`);
        promotedNotices.push({
          id: student.id,
          title: graduate ? 'Congratulations, graduate!' : 'Final semester completed',
          message: graduate
            ? `You passed all your subjects in ${semester}. Congratulations on completing your program!`
            : `You completed ${semester}, but still need to retake ${retakeCodes} before graduating.`,
        });
      }
    }
  }

  await Promise.all(updatePromises);
  result.skipped = students.length - result.processed;

  if (result.processed > 0) {
    const who = actor ? actor.name : 'The system';
    const actionLabel = semOrder === '1st'
      ? `${auto ? 'automatically ' : ''}cleared ${result.processed} students for 2nd semester (${semester})`
      : `${auto ? 'automatically ' : ''}promoted ${result.processed} students to next year level (${semester})`;
    if (actor) await logActivity(actor.id, actionLabel, 'User', null);

    // Section history — stays with the section for whoever advises it next.
    const historyUser = actor || { id: null, name: 'System (automatic)' };
    for (const { sec, count, graduated } of processedBySection.values()) {
      const what = semOrder === '1st'
        ? `cleared ${count} student(s) for the 2nd Semester`
        : Number(sec.year_level) >= 4
          ? `processed ${count} 4th-year student(s)${graduated ? ` — ${graduated} graduated` : ''}`
          : `promoted ${count} student(s) to Year ${Number(sec.year_level) + 1} (Section ${sec.section})`;
      await logSectionActivity(sec, historyUser, `${what} — ${semester}`);
    }

    await notifyAdmins(app, {
      title: semOrder === '1st' ? 'Students Advanced to 2nd Semester' : 'Students Promoted',
      message: semOrder === '1st'
        ? `${who} cleared ${result.processed} student(s) for 2nd semester enrollment (${semester}).`
        : `${who} promoted ${result.processed} student(s) to the next year level (${semester}).`,
      type: 'promotion',
      link: '/admin/users',
    });

    // Each promoted student hears about it.
    await Promise.all(promotedNotices.map((n) => createNotification(app, { userId: n.id, title: n.title, message: n.message, type: 'promotion', link: '/student' })));
  }

  if (result.newlyIrregular.length > 0) {
    if (actor) await logActivity(actor.id, `auto-marked ${result.newlyIrregular.length} student(s) Irregular (failed/incomplete subjects, ${semester})`, 'User', null);
    await Promise.all(result.newlyIrregular.map((s) => createNotification(app, {
      userId: s.id,
      title: 'Academic Status Update',
      message: 'Your academic status has been updated to Irregular due to a failed or incomplete subject. Please see your adviser for re-enrollment guidance.',
      type: 'promotion',
      link: '/student/grades',
    })));
  }
  return result;
};

// Students still in school who have submitted grades in `semester`.
const studentsGradedIn = async (semester, extraWhere = {}) => {
  const rows = await Grade.findAll({
    where: { submitted: true },
    attributes: ['student_id'],
    include: [{ model: Class, as: 'class', where: { semester, ...extraWhere }, attributes: [] }],
    raw: true,
  });
  const ids = [...new Set(rows.map((r) => r.student_id))];
  if (!ids.length) return [];
  return User.findAll({ where: { id: { [Op.in]: ids }, role: 'Student', status: 'Active', graduated_at: null } });
};

// A class's grades were just released to its students. For a 1st-Semester class, its
// students are checked right away (cleared for the 2nd Semester once ALL their
// subjects are done). 2nd-Semester promotion (year level / graduation) waits
// for the semester to end — see autoPromoteSemester. Never throws.
// Off: only the section's ADVISER promotes students (My Advisory → Promotion,
// POST /promote below). Set to true to also promote automatically when grades
// are released and when the semester ends.
const AUTO_PROMOTION = false;

const autoPromoteForClass = async (app, classId) => {
  if (!AUTO_PROMOTION) return null;
  try {
    const cls = await Class.findByPk(classId, { attributes: ['id', 'semester'] });
    if (!cls) return null;
    const order = getSemesterOrder(cls.semester);
    if (order === '2nd') {
      // Year-level promotion normally waits for the semester to end — but a
      // class released AFTER its semester already ended is checked now.
      const sem = await Semester.findOne({ where: { name: cls.semester }, attributes: ['is_current', 'status'] });
      if (!sem || (sem.is_current && sem.status !== 'Completed')) return null;
    } else if (order !== '1st') {
      return null;
    }
    const students = await studentsGradedIn(cls.semester, { id: cls.id });
    // A late 2nd-Semester release is the semester's final word for these students.
    return await runPromotion({ app, students, semester: cls.semester, auto: true, final: order === '2nd' });
  } catch (err) {
    console.error('[auto-promotion] class check failed:', err.message);
    return null;
  }
};

// A semester just ended (Admin set the next one as current): everyone graded
// in it is checked — cleared (1st Sem) or promoted / graduated (2nd Sem).
// Never throws.
const autoPromoteSemester = async (app, semesterName) => {
  if (!AUTO_PROMOTION) return null;
  try {
    const students = await studentsGradedIn(semesterName);
    const result = await runPromotion({ app, students, semester: semesterName, auto: true, final: true });
    console.log(`[auto-promotion] ${semesterName}: ${result.processed} promoted, ${result.skipped} not yet eligible.`);
    return result;
  } catch (err) {
    console.error('[auto-promotion] semester check failed:', err.message);
    return null;
  }
};

// ================= POST /api/promotions/promote =================
// The adviser's manual fallback — same engine, their own section only.
const promoteStudents = asyncHandler(async (req, res) => {
  const { student_ids, semester } = req.body;

  if (!student_ids || student_ids.length === 0) {
    return res.status(400).json({ message: 'No students selected.' });
  }
  if (!getSemesterOrder(semester)) {
    return res.status(400).json({
      message: `Cannot determine semester order from: "${semester}". Make sure semester name includes "1st" or "2nd".`,
    });
  }

  const students = await User.findAll({ where: { id: { [Op.in]: student_ids }, role: 'Student', graduated_at: null } });
  const mine = await advisoriesOf(req.user.id);
  if (students.some((s) => !mine.some((a) => sameSection(a, s)))) {
    return res.status(403).json({ message: 'You can only promote students in your own advisory section.' });
  }

  const r = await runPromotion({ app: req.app, students, semester, actor: req.user });

  const baseMessage = r.semOrder === '1st'
    ? `Successfully cleared ${r.processed} student(s) for 2nd semester.`
    : `Successfully promoted ${r.processed} student(s) to the next year level.`;
  const graduatedNote = r.graduatedCount > 0
    ? ` ${r.graduatedCount} 4th-year student(s) graduated and were moved to the Graduated archive (accounts and records kept).`
    : '';
  const irregularNote = r.newlyIrregular.length > 0
    ? ` ${r.newlyIrregular.length} student(s) with failed/incomplete subjects were automatically marked Irregular.`
    : '';

  res.json({
    message: (r.skipped > 0 ? `${baseMessage} ${r.skipped} student(s) were skipped (already promoted, failed, incomplete, or not yet verified).` : baseMessage) + graduatedNote + irregularNote,
    graduated: r.graduatedCount,
    promoted: r.processed,
    skipped: r.skipped,
    newly_irregular: r.newlyIrregular.length,
    semester_order: r.semOrder,
    names: r.resultNames,
  });
});

module.exports = {
  evaluateStudents,
  promoteStudents,
  runPromotion,
  autoPromoteForClass,
  autoPromoteSemester,
};
