const { User, Grade, Class, Subject, Enrollment, Semester } = require('../models');
const { Op } = require('sequelize');
const { logActivity, promotionActivityRecentWhere } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
// Shared "notify every Admin" helper — emits the real-time
// `notification:${userId}` Socket.IO event the frontend bell (and its
// notification sound) listens for, unlike a bare Notification.create which
// would leave it silently sitting there until the recipient's next page
// load/manual refresh.
const { notifyAdmins, createNotification } = require('./notificationController');

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
    attributes: ['id', 'code', 'name', 'program', 'year_level'],
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
  const { semester, program, year_level } = req.query;

  if (!semester) {
    return res.status(400).json({ message: 'Semester is required.' });
  }

  const semOrder = getSemesterOrder(semester);

  // ── Query 1: Get all matching students ───────────────────────────────
  const studentWhere = { role: 'Student', status: 'Active' };
  // Chairpersons are always scoped to their own program(s), regardless of what was requested
  studentWhere.program = req.user.role === 'Chairperson' ? { [Op.in]: req.user.programs || [] } : (program || undefined);
  if (!studentWhere.program) delete studentWhere.program;
  if (year_level) studentWhere.year_level = parseInt(year_level);

  const students = await User.findAll({
    where: studentWhere,
    attributes: { exclude: ['password'] },
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
      ? (requiredByProgramYear[`${student.program}|${student.year_level}`] || [])
      : null;
    // A retakable Failed subject was actually attempted, not skipped —
    // excluded here so it doesn't double as "missing" on top of already
    // being accounted for by retakableFailedGrades/"Eligible (Retake
    // Required)" below.
    const missingSubjects = requiredSubjects
      ? requiredSubjects.filter((s) => !(passedSubjectIds[student.id] || new Set()).has(s.id) && !retakableFailedSubjectIds.has(s.id))
      : [];
    // Of those missing subjects, the ones the student can't even enroll in
    // yet — a prerequisite or co-requisite that hasn't itself been passed —
    // as opposed to a subject they simply haven't gotten to. Distinct from
    // ordinary "Incomplete Subjects" below since re-enrolling them in this
    // subject alone wouldn't work; the prerequisite has to be cleared first.
    const missingSubjectsBlockedByPrereqs = missingSubjects.filter((s) =>
      (s.prerequisites || []).some((p) => !passedSet.has(p.id)) ||
      (s.co_requisites || []).some((p) => !passedSet.has(p.id))
    );

    const gwa = grades.length > 0
      ? (grades.reduce((sum, g) => sum + parseFloat(g.average || 0), 0) / grades.length).toFixed(1)
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
    let promotionStatus;
    if (grades.length === 0) {
      promotionStatus = 'No Grades';
    } else if (missingSubjectsBlockedByPrereqs.length > 0) {
      promotionStatus = 'Missing Prerequisites';
    } else if (missingSubjects.length > 0) {
      promotionStatus = 'Incomplete Subjects';
    } else if (!fullyVerified) {
      promotionStatus = 'Pending Verification';
    } else if (student.last_promoted_semester === semester) {
      // Already processed by a previous Promote run for this exact semester
      // — 1st-semester clearing doesn't change year_level, so without this
      // flag they'd otherwise keep showing up as freshly "Eligible" forever,
      // with no way to tell they were already handled.
      promotionStatus = 'Already Promoted';
    } else if (student.year_level >= 4 && semOrder === '2nd') {
      promotionStatus = 'For Graduation';
    } else if (retakableFailedGrades.length > 0) {
      // Otherwise fully on track, but still owes a retake or two on
      // standalone (no prerequisite/co-requisite) subjects — promotable, but
      // still flagged Irregular once actually promoted (see promoteStudents)
      // since they genuinely have a non-standard subject mix now.
      promotionStatus = 'Eligible (Retake Required)';
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
      gwa,
      passed_count: passedCount,
      failed_count: failedCount,
      // Every Failed subject, surfaced separately from `grades` below so the
      // UI can call out "still owes a retake" without re-deriving it. Each
      // one flags whether its own prerequisite/co-requisite chain is still
      // unmet — that's what actually blocks re-enrolling in it (see
      // unmetPrereqsFor above), not whether the student can advance.
      retakable_failed_subjects: retakableFailedGrades.map((g) => {
        const unmet = unmetPrereqsFor(g.class?.subject, passedSet);
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

// ================= POST /api/promotions/promote =================
// Also optimized — fetches all grades for selected students in one query.
const promoteStudents = asyncHandler(async (req, res) => {
  const { student_ids, semester } = req.body;

  if (!student_ids || student_ids.length === 0) {
    return res.status(400).json({ message: 'No students selected.' });
  }

  const semOrder = getSemesterOrder(semester);
  if (!semOrder) {
    return res.status(400).json({
      message: `Cannot determine semester order from: "${semester}". Make sure semester name includes "1st" or "2nd".`,
    });
  }

  // ── Fetch all selected students, scoped to the Chairperson's own program ──
  const studentWhere = { id: { [Op.in]: student_ids }, role: 'Student' };
  if (req.user.role === 'Chairperson') studentWhere.program = { [Op.in]: req.user.programs || [] };
  const students = await User.findAll({ where: studentWhere });

  // Endorsement used to gate this (only students explicitly Endorsed for the
  // semester were eligible), but that whole feature — including the only UI
  // that ever created an Endorsement record — was removed from the app.
  // Keeping this gate would make it impossible to promote anyone ever again,
  // so selecting a student here (scoped to the Chairperson's own program,
  // above) is now itself the affirmative action that used to be "Endorsed".

  // ── Fetch all their grades in one query ──────────────────────────────
  const allGrades = await Grade.findAll({
    where: {
      student_id: { [Op.in]: student_ids },
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
        include: [
          { model: Subject, as: 'prerequisites', through: { attributes: [] }, attributes: ['id'] },
          { model: Subject, as: 'co_requisites', through: { attributes: [] }, attributes: ['id'] },
        ],
      }],
    }],
  });

  // Group grades by student
  const gradesByStudent = {};
  allGrades.forEach(g => {
    const sid = g.student_id;
    if (!gradesByStudent[sid]) gradesByStudent[sid] = [];
    gradesByStudent[sid].push(g);
  });
  const passedSubjectIds = passedSubjectIdsByStudent(gradesByStudent);

  // Same "must have actually completed every required subject" rule as
  // evaluateStudents — re-checked here server-side regardless of what the
  // frontend already filtered to, so promoting can never be tricked into
  // advancing someone who's merely un-Failed rather than actually done.
  const requiredByProgramYear = await getRequiredSubjectsByProgramYear(students, semOrder);

  let processed = 0;
  const resultNames = [];
  const updatePromises = [];
  const newlyIrregular = [];

  for (const student of students) {
    // Already actioned for this exact semester (evaluateStudents' own
    // "Already Promoted" status, at line ~263) — skip outright instead of
    // re-running the checks below and re-applying year_level/irregular
    // updates a second time. The frontend now folds "Already Promoted" into
    // the same "eligible" bucket as a genuinely new Promote, so without this
    // guard a bulk "Promote All" that happens to include one would silently
    // double-promote them (bump year_level again, re-flag Irregular, etc.).
    if (student.last_promoted_semester === semester) continue;

    const grades = gradesByStudent[student.id] || [];
    // Every Failed subject is retake-required now, never blocking on its
    // own — see unmetPrereqsFor/evaluateStudents above. It's handled below
    // alongside the actual promotion, not as a reason to skip the student.
    const retakableFailedGrades = grades.filter(g => g.status === 'Failed');

    // Skip students still missing a Passed grade for any curriculum-required
    // subject this year+semester (never enrolled, or enrolled but never
    // submitted) — not Failed, but not actually done either. Also covers a
    // subject blocked by an unmet prerequisite/co-requisite (evaluateStudents'
    // "Missing Prerequisites" status) — either way they can't advance on
    // schedule, so they're auto-flagged Irregular the same as a Failed subject.
    if (requiredByProgramYear) {
      const retakableFailedSubjectIds = new Set(retakableFailedGrades.map((g) => g.class?.subject_id).filter(Boolean));
      const required = requiredByProgramYear[`${student.program}|${student.year_level}`] || [];
      // A retakable Failed subject was attempted, not skipped — excluded
      // here so it doesn't count as "missing" on top of being handled by
      // the retake-flagging below.
      const missing = required.some((s) => !(passedSubjectIds[student.id] || new Set()).has(s.id) && !retakableFailedSubjectIds.has(s.id));
      if (missing) {
        if (student.student_status !== 'Irregular') {
          updatePromises.push(student.update({ student_status: 'Irregular' }));
          newlyIrregular.push({ id: student.id, name: student.name });
        }
        continue;
      }
    }

    // Skip students whose grades haven't cleared both sign-offs yet
    // (Chairperson verification + Admin approval on every Passed grade) —
    // same gate gradeController.releaseClassGrades enforces per class,
    // checked here across the whole semester so nobody gets promoted on
    // grades that were never actually verified and finalized. Not an
    // academic problem (just administrative lag), so NOT auto-marked
    // Irregular — re-running Promote once verification clears will pick
    // them back up normally.
    if (!isFullyVerified(grades)) continue;

    // Promotable, but still owes a retake on a Failed subject — flagged
    // Irregular alongside the promotion itself (not instead of it): they
    // genuinely have a non-standard subject mix now, even though nothing
    // stopped them from advancing on schedule.
    const hasRetake = retakableFailedGrades.length > 0;
    const irregularUpdate = (hasRetake && student.student_status !== 'Irregular') ? { student_status: 'Irregular' } : {};
    if (hasRetake && student.student_status !== 'Irregular') {
      newlyIrregular.push({ id: student.id, name: student.name });
    }
    const retakeNote = hasRetake ? ` [retaking ${retakableFailedGrades.map((g) => g.class?.subject?.code).join(', ')}]` : '';

    if (semOrder === '1st') {
      // 1st semester passed → no year_level change, just cleared for 2nd sem.
      // Nothing else about this student's record changes, so without
      // recording last_promoted_semester here they'd otherwise keep
      // evaluating as freshly "Eligible" forever on every future Evaluate
      // run against this same semester.
      updatePromises.push(student.update({ ...irregularUpdate, last_promoted_semester: semester }));
      processed++;
      resultNames.push(`${student.name} (cleared for 2nd Semester)${retakeNote}`);

    } else if (semOrder === '2nd') {
      if (student.year_level < 4) {
        // Captured before .update() — Sequelize's .update() mutates the
        // in-memory instance's year_level synchronously (the DB write is
        // the only async part), so reading student.year_level again AFTER
        // calling it below would already see the new value and double-count
        // the +1 in the message (e.g. Year 1 -> correctly persisted as
        // Year 2, but the text would say "Year 3").
        const nextYear = student.year_level + 1;
        // Queue all year_level updates to run in parallel
        updatePromises.push(student.update({ ...irregularUpdate, year_level: nextYear, last_promoted_semester: semester }));
        processed++;
        resultNames.push(`${student.name} → Year ${nextYear}${retakeNote}`);
      } else {
        // Year 4 graduating
        // Optionally: updatePromises.push(student.update({ student_status: 'Graduated' }));
        updatePromises.push(student.update({ ...irregularUpdate, last_promoted_semester: semester }));
        processed++;
        resultNames.push(`${student.name} (Graduating)${retakeNote}`);
      }
    }
  }

  // Run all DB updates at the same time instead of one by one
  await Promise.all(updatePromises);

  const skipped = students.length - processed;
  const actionLabel = semOrder === '1st'
    ? `cleared ${processed} students for 2nd semester (${semester})`
    : `promoted ${processed} students to next year level (${semester})`;

  await logActivity(req.user.id, actionLabel, 'User', null);

  const notifTitle = semOrder === '1st' ? 'Students Advanced to 2nd Semester' : 'Students Promoted';
  const notifMsg = semOrder === '1st'
    ? `${processed} student(s) have been cleared for 2nd semester enrollment (${semester}).`
    : `${processed} student(s) have been promoted to the next year level (${semester}).`;

  await notifyAdmins(req.app, { title: notifTitle, message: notifMsg, type: 'promotion', link: '/admin/promotions' });

  if (newlyIrregular.length > 0) {
    await logActivity(req.user.id, `auto-marked ${newlyIrregular.length} student(s) Irregular (failed/incomplete subjects, ${semester})`, 'User', null);
    await Promise.all(newlyIrregular.map((s) => createNotification(req.app, {
      userId: s.id,
      title: 'Academic Status Update',
      message: 'Your academic status has been updated to Irregular due to a failed or incomplete subject. Please see your adviser for re-enrollment guidance.',
      type: 'promotion',
      link: '/student/grades',
    })));
  }

  const baseMessage = semOrder === '1st'
    ? `Successfully cleared ${processed} student(s) for 2nd semester.`
    : `Successfully promoted ${processed} student(s) to the next year level.`;

  const irregularNote = newlyIrregular.length > 0
    ? ` ${newlyIrregular.length} student(s) with failed/incomplete subjects were automatically marked Irregular.`
    : '';

  res.json({
    // Anyone selected but not processed either had a Failed/incomplete/
    // not-yet-verified grade, or was already promoted for this exact
    // semester earlier — re-run Evaluate to see exactly which and why.
    message: (skipped > 0 ? `${baseMessage} ${skipped} student(s) were skipped (already promoted, failed, incomplete, or not yet verified).` : baseMessage) + irregularNote,
    promoted: processed,
    skipped,
    newly_irregular: newlyIrregular.length,
    semester_order: semOrder,
    names: resultNames,
  });
});

// ================= POST /api/promotions/mark-irregular =================
const markIrregular = asyncHandler(async (req, res) => {
  const { student_id } = req.body;

  const student = await User.findByPk(student_id);
  if (!student || student.role !== 'Student') {
    return res.status(404).json({ message: 'Student not found.' });
  }

  if (req.user.role === 'Chairperson' && !(req.user.programs || []).includes(student.program)) {
    return res.status(403).json({ message: 'You may only mark students in your own program.' });
  }

  await student.update({ student_status: 'Irregular' });

  await logActivity(req.user.id, `marked ${student.name} as Irregular`, 'User', student_id);

  await createNotification(req.app, {
    userId: student_id,
    title: 'Academic Status Update',
    message: 'Your academic status has been updated. Please see your adviser for re-enrollment guidance.',
    type: 'promotion',
    link: '/student/grades',
  });

  res.json({
    message: `${student.name} has been marked as Irregular.`,
    student: student.toSafeJSON(),
  });
});

// ================= GET /api/promotions/history =================
const getPromotionHistory = asyncHandler(async (req, res) => {
  const { ActivityLog } = require('../models');

  // Same 24h retention every other promotion/regularization entry gets
  // (see utils/activityLogger.js's promotionActivityRecentWhere) — without
  // this, an entry that ages out of the Admin Dashboard's own Recent
  // Activity would keep sitting here indefinitely, the one place still
  // showing something that's supposed to be archived everywhere else.
  const logs = await ActivityLog.findAll({
    where: promotionActivityRecentWhere(),
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'role'] }],
    order: [['created_at', 'DESC']],
    limit: 50,
  });

  res.json({ history: logs });
});

// ================= GET /api/promotions/overview =================
// A dashboard-sized status summary — the current semester's promotion
// summary counts (Eligible, Failed, Incomplete, etc.) without requiring
// anyone to have actually clicked "Evaluate" in Promotion Management first,
// and without the full per-student payload that page needs (3,000+ students'
// worth) — just the numbers. Reuses evaluateStudents' own logic wholesale by
// calling it internally and capturing its response instead of re-deriving
// the same computation a second, slightly-different way.
const getPromotionOverview = asyncHandler(async (req, res) => {
  const currentSemester = await Semester.findOne({ where: { is_current: true } });
  if (!currentSemester) {
    return res.json({ semester: null, summary: null });
  }

  // asyncHandler's wrapper doesn't return/await its inner promise (it's
  // fire-and-forget, relying on Express's own req/res lifecycle) — so
  // capturing the result has to happen via this res.json() call resolving a
  // promise of our own, not by awaiting evaluateStudents(...) directly
  // (that would just resolve immediately with undefined, before the inner
  // logic has actually run).
  const captured = await new Promise((resolve, reject) => {
    const capturingRes = {
      status() { return this; },
      json(payload) { resolve(payload); return this; },
    };
    evaluateStudents(
      { query: { semester: currentSemester.name }, user: req.user },
      capturingRes,
      reject
    );
  });

  res.json({
    semester: currentSemester.name,
    academic_year: currentSemester.academic_year,
    semester_order: captured?.semester_order,
    summary: captured?.summary,
  });
});

module.exports = {
  evaluateStudents,
  promoteStudents,
  markIrregular,
  getPromotionHistory,
  getPromotionOverview,
};