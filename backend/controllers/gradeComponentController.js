const { emitGradesUpdated } = require('../utils/realtime');
const { GradeComponent, ComponentItem, ComponentScore, Class, Subject, Enrollment, Grade, User } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');
const { logActivity } = require('../utils/activityLogger');
const { actsAsInstructor } = require('../utils/teachingAuth');
const { archivedClassMessage } = require('../utils/archiveGuard');
const notifyAdmins = (...args) => require('./notificationController').notifyAdmins(...args);

// Why a class's scores can't be edited freely anymore (null = still open):
// it is archived (itself or its whole semester), or it was already submitted
// to the Chairperson and not returned for revision. Its INC students can
// still be completed — see saveScores.
const closedClassMessage = async (cls) => {
  const archived = await archivedClassMessage(cls);
  if (archived) return archived;
  if (cls.sent_to_chairperson && !cls.awaiting_faculty_revision) {
    return 'This class was already submitted, so its Class Record is closed.';
  }
  return null;
};

// ── SSU Class Record formula ────────────────────────────────────────────────
// Item Rate: linear transmutation of a raw score into a Rate. Kept at full
// precision (unrounded) all the way through Rate → Average → Weighted →
// Composite — only then is the composite rounded to a whole-number Term
// Grade, whose equivalent is looked up (toGWA below). Whole-number display
// of Rate/Average/Weighted happens in the frontend, purely cosmetic — it
// never feeds back into this math.
// Which formula applies is a per-Class choice (Class.rate_formula, set from
// Grade Component Setup) — '50_45' is the SSU default (Rate = (score/max)*45
// + 50, range 50-95), '60_35' is the alternate (Rate = (score/max)*35 + 60,
// range 60-95). Both top out at 95 for a perfect score; only the floor for a
// 0 score differs. Mirrored on the frontend in classRecordExcel.js's own
// RATE_FORMULAS — keep the two in sync.
const RATE_FORMULAS = {
  '50_45': { base: 50, range: 45 },
  '60_35': { base: 60, range: 35 },
};
const getRateFormula = (cls) => RATE_FORMULAS[cls?.rate_formula] || RATE_FORMULAS['50_45'];

// `isRateDirect` (ComponentItem.is_rate_direct) skips the transmutation
// entirely — the value typed in for an item like this already IS the Rate
// (a Faculty member with no raw score to compute one from), just clamped to
// the same range the formula below would otherwise produce.
const itemRate = (score, maxScore, isRateDirect, formula = RATE_FORMULAS['50_45']) => {
  const s = parseFloat(score);
  if (isRateDirect) return Math.min(formula.base + formula.range, Math.max(formula.base, s));
  const m = parseFloat(maxScore) || 100;
  return (s / m) * formula.range + formula.base;
};

// Grade equivalent of a WHOLE-NUMBER term/overall grade, clamped to the SSU
// 1.0–5.0 scale: 95+ → 1.0, 79 → 2.6, 75 → 3.0, 74 → 3.1, 55- → 5.0.
// (105 − grade) / 10 rather than 10.5 − 0.1 × grade so a whole grade gives
// an exact one-decimal equivalent. Mirrors classRecordExcel.js on the
// frontend — keep the two in sync.
const compositeToGWA = (grade) => {
  const gwa = (105 - grade) / 10;
  return Math.min(5.0, Math.max(1.0, gwa));
};

// A composite rounded off to a whole number (half up) — the Term Grade /
// Overall Grade exactly as the Class Record shows it. Epsilon only cleans
// up floating-point noise (a true 79.5 stored as 79.49999999999999).
const roundGrade = (composite) => Math.round(composite + 1e-9);

// A period's own GWA (Grade.midterm / Grade.finals) — the equivalent of its
// whole-number Term Grade.
const toGWA = (composite) => compositeToGWA(roundGrade(composite));

// Grade.average / Passed-Failed — the equivalent of the whole-number Overall
// Grade: the TRUE average of both periods' exact composites, rounded ONCE
// at the end (never each Term Grade first, which could push the Overall
// Grade a point off). Matches the Class Record's own
// Overall Grade / Final Grade columns (classRecordExcel.js's
// overallComposite). NOT an average of the two already-clamped period GWAs
// (what Grade.js's beforeSave hook falls back to for manual-entry classes) —
// combining the grades first and clamping once avoids a Midterm of 96
// clamping its own GWA to 1.0 before ever being averaged.
const combinedGWA = (midComposite, finComposite) => {
  if (midComposite === null || midComposite === undefined || finComposite === null || finComposite === undefined) return null;
  return toGWA((midComposite + finComposite) / 2);
};

// A student may only view their own class record, and only once their instructor
// has submitted AND released the grade for that class (mirrors the gate My Grades
// already applies to the summary view).
const assertStudentCanViewOwnRecord = async (classId, studentId) => {
  const enrollment = await Enrollment.findOne({ where: { class_id: classId, student_id: studentId } });
  if (!enrollment) return 'You are not enrolled in this class.';
  const grade = await Grade.findOne({ where: { class_id: classId, student_id: studentId } });
  if (!grade || !grade.submitted || !grade.released) return 'Your grades for this class have not been released yet.';
  return null;
};

// ================= GET COMPONENTS (with nested items) FOR A CLASS =================
const getComponents = asyncHandler(async (req, res) => {
  const { classId } = req.params;

  const cls = await Class.findByPk(classId);
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Faculty' && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  if (req.user.role === 'Student') {
    const denyReason = await assertStudentCanViewOwnRecord(classId, req.user.id);
    if (denyReason) return res.status(403).json({ message: denyReason });
  }

  const components = await GradeComponent.findAll({
    where: { class_id: classId },
    include: [{ model: ComponentItem, as: 'items', separate: true, order: [['order_index', 'ASC']] }],
    order: [['period', 'ASC'], ['order_index', 'ASC']],
  });

  res.json({ components });
});

// ================= SAVE COMPONENTS + ITEMS (CREATE/UPDATE/DELETE) =================
const saveComponents = asyncHandler(async (req, res) => {
  const { classId } = req.params;
  const { components, rate_formula } = req.body; // Array of { id?, name, period, weight, order_index, items: [{id?, name, max_score, order_index}] }

  const cls = await Class.findByPk(classId, {
    include: [{ model: Subject, as: 'subject' }],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  // actsAsInstructor covers real Faculty and a Chairperson flagged is_teaching
  // alike — both are restricted to THEIR OWN classes only. Admin stays
  // unrestricted (system-wide oversight); a non-teaching or unrelated
  // Chairperson never reaches this route in the frontend (gated on
  // is_teaching) and would fail actsAsInstructor here too if they tried it directly.
  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  // An archived class's class record is kept as it is — no setup changes.
  const archivedMsg = await require('../utils/archiveGuard').archivedClassMessage(cls);
  if (archivedMsg) return res.status(400).json({ message: archivedMsg });

  // Which Rate scale this class's Class Record uses — set here from Grade
  // Component Setup's own selector. Optional in the request body so any
  // other future caller of this same save-components route isn't forced to
  // always resend it; omitting it just leaves whatever this class already had.
  if (rate_formula !== undefined) {
    if (!RATE_FORMULAS[rate_formula]) {
      return res.status(400).json({ message: 'rate_formula must be "50_45" or "60_35".' });
    }
    cls.rate_formula = rate_formula;
    await cls.save();
  }

  // Validate weights per period (must sum to 100)
  const midtermComponents = components.filter(c => c.period === 'Midterm');
  const finalsComponents = components.filter(c => c.period === 'Finals');

  const midtermWeight = midtermComponents.reduce((sum, c) => sum + parseFloat(c.weight || 0), 0);
  const finalsWeight = finalsComponents.reduce((sum, c) => sum + parseFloat(c.weight || 0), 0);

  if (midtermComponents.length > 0 && Math.abs(midtermWeight - 100) > 0.01) {
    return res.status(400).json({ message: `Midterm component weights must total 100%. Currently: ${midtermWeight}%` });
  }
  if (finalsComponents.length > 0 && Math.abs(finalsWeight - 100) > 0.01) {
    return res.status(400).json({ message: `Finals component weights must total 100%. Currently: ${finalsWeight}%` });
  }
  for (const comp of components) {
    if (!comp.items || comp.items.length === 0) {
      return res.status(400).json({ message: `"${comp.name || 'Untitled component'}" needs at least one item.` });
    }
    for (const item of comp.items) {
      // A direct-rate item has no raw score/max at all — the typed value IS
      // the Rate — so the usual "needs a max score" requirement doesn't
      // apply to it.
      if (!item.is_rate_direct && !(parseFloat(item.max_score) > 0)) {
        return res.status(400).json({ message: `"${item.name || 'An item'}" in "${comp.name || 'Untitled component'}" needs a max score greater than 0.` });
      }
    }
  }

  // Delete components removed by the client (cascades to their items/scores)
  const existingComponents = await GradeComponent.findAll({ where: { class_id: classId } });
  const existingIds = existingComponents.map(c => c.id);
  const incomingIds = components.filter(c => c.id).map(c => c.id);
  const componentsToDelete = existingIds.filter(id => !incomingIds.includes(id));
  if (componentsToDelete.length > 0) {
    const itemsToDelete = await ComponentItem.findAll({ where: { component_id: componentsToDelete }, attributes: ['id'] });
    const itemIdsToDelete = itemsToDelete.map(i => i.id);
    if (itemIdsToDelete.length > 0) await ComponentScore.destroy({ where: { item_id: itemIdsToDelete } });
    await ComponentItem.destroy({ where: { component_id: componentsToDelete } });
    await GradeComponent.destroy({ where: { id: componentsToDelete } });
  }

  // Create or update components + their items
  const savedComponentIds = [];
  for (const comp of components) {
    let componentId;
    if (comp.id && existingIds.includes(comp.id)) {
      await GradeComponent.update({
        name: comp.name,
        period: comp.period,
        weight: comp.weight,
        order_index: comp.order_index || 0,
        show_ave: comp.show_ave !== false,
      }, { where: { id: comp.id } });
      componentId = comp.id;
    } else {
      const newComp = await GradeComponent.create({
        class_id: parseInt(classId),
        name: comp.name,
        period: comp.period,
        weight: comp.weight,
        order_index: comp.order_index || 0,
        show_ave: comp.show_ave !== false,
      });
      componentId = newComp.id;
    }
    savedComponentIds.push(componentId);

    // Diff items within this component the same way components are diffed
    const existingItems = await ComponentItem.findAll({ where: { component_id: componentId } });
    const existingItemIds = existingItems.map(i => i.id);
    const incomingItemIds = comp.items.filter(i => i.id).map(i => i.id);
    const itemsToDelete = existingItemIds.filter(id => !incomingItemIds.includes(id));
    if (itemsToDelete.length > 0) {
      await ComponentScore.destroy({ where: { item_id: itemsToDelete } });
      await ComponentItem.destroy({ where: { id: itemsToDelete } });
    }

    for (const item of comp.items) {
      if (item.id && existingItemIds.includes(item.id)) {
        await ComponentItem.update({
          name: item.name,
          max_score: item.max_score || 100,
          order_index: item.order_index || 0,
          is_rate_direct: !!item.is_rate_direct,
          show_score: item.show_score !== false,
          show_rate: item.show_rate !== false,
        }, { where: { id: item.id } });
      } else {
        await ComponentItem.create({
          component_id: componentId,
          name: item.name,
          max_score: item.max_score || 100,
          order_index: item.order_index || 0,
          is_rate_direct: !!item.is_rate_direct,
          show_score: item.show_score !== false,
          show_rate: item.show_rate !== false,
        });
      }
    }
  }

  await logActivity(req.user.id, `updated grade components for ${cls.subject?.code}`, 'Class', classId);

  res.json({ message: 'Components saved successfully.', component_ids: savedComponentIds });
});

// ================= GET ITEM SCORES FOR A CLASS =================
const getScores = asyncHandler(async (req, res) => {
  const { classId } = req.params;

  const cls = await Class.findByPk(classId);
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Faculty' && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  if (req.user.role === 'Student') {
    const denyReason = await assertStudentCanViewOwnRecord(classId, req.user.id);
    if (denyReason) return res.status(403).json({ message: denyReason });
  }

  const components = await GradeComponent.findAll({
    where: { class_id: classId },
    include: [{ model: ComponentItem, as: 'items', separate: true, order: [['order_index', 'ASC']] }],
    order: [['period', 'ASC'], ['order_index', 'ASC']],
  });

  const itemIds = components.flatMap(c => c.items.map(i => i.id));
  // Students only ever get their own scores back — everyone else (Instructor/Admin/
  // Chairperson) sees the full class roster.
  const scoreWhere = req.user.role === 'Student'
    ? { item_id: itemIds, student_id: req.user.id }
    : { item_id: itemIds };
  const scores = await ComponentScore.findAll({ where: scoreWhere });

  const scoreMap = {};
  scores.forEach(s => {
    if (!scoreMap[s.student_id]) scoreMap[s.student_id] = {};
    scoreMap[s.student_id][s.item_id] = s.score !== null ? parseFloat(s.score) : null;
  });

  res.json({ components, scores: scoreMap });
});

// ================= SAVE ITEM SCORES =================
const saveScores = asyncHandler(async (req, res) => {
  const { classId } = req.params;
  // { student_id: { item_id: score_value } }. `lock` defaults to true — the
  // normal "Save All Scores" button locks the grid on purpose. Resolve INC
  // passes `lock: false` since it's only ever writing ONE student's scores
  // and has no business locking everyone else's still-in-progress editing.
  const { scores, lock = true } = req.body;

  const cls = await Class.findByPk(classId, {
    include: [{ model: Subject, as: 'subject' }],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  // actsAsInstructor covers real Faculty and a Chairperson flagged is_teaching
  // alike — both are restricted to THEIR OWN classes only. Admin stays
  // unrestricted (system-wide oversight); a non-teaching or unrelated
  // Chairperson never reaches this route in the frontend (gated on
  // is_teaching) and would fail actsAsInstructor here too if they tried it directly.
  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  // A class that already went through the pipeline (submitted to the
  // Chairperson, released, or archived with its semester) is closed for
  // editing — EXCEPT its students still marked INC, whose missing scores the
  // faculty can still enter (Resolve INC: one student, lock:false). Nobody
  // else's scores or grades can be touched on that path.
  const closedMsg = await closedClassMessage(cls);
  let incOnlyStudents = null;
  if (closedMsg) {
    const ids = Object.keys(scores || {}).map((id) => parseInt(id, 10)).filter(Boolean);
    const theirGrades = ids.length ? await Grade.findAll({ where: { class_id: cls.id, student_id: ids } }) : [];
    // INC, or INC just reopened by Resolve INC (undoINC → Pending, unsubmitted).
    const completing = (g) => g.status === 'INC' || (g.status === 'Pending' && !g.submitted);
    const allIncomplete = ids.length > 0 && lock === false && ids.every((id) => theirGrades.some((g) => g.student_id === id && completing(g)));
    if (!allIncomplete) {
      return res.status(400).json({ message: `${closedMsg} Only students marked INC can still be completed — use "Resolve INC" on that student.` });
    }
    incOnlyStudents = new Set(ids);
  } else if (cls.class_record_locked) {
    return res.status(400).json({ message: 'The Class Record is locked. Click "Edit Scores" to unlock it before making changes.' });
  }

  // Validate every incoming score against its own item's max_score before
  // writing anything — mirrors the Class Record UI's own input clamp, but
  // enforced here too since a request can always bypass client-side checks.
  // A direct-rate item (is_rate_direct) has no max_score to bound against at
  // all — the typed value IS the Rate, so it's bounded to this class's own
  // Rate range (Class.rate_formula) instead of 0..max_score.
  const rateFormula = getRateFormula(cls);
  const submittedItemIds = [...new Set(Object.values(scores).flatMap((s) => Object.keys(s).map(Number)))];
  const submittedItems = await ComponentItem.findAll({ where: { id: submittedItemIds } });
  const itemById = {};
  submittedItems.forEach((i) => { itemById[i.id] = i; });

  for (const [, itemScores] of Object.entries(scores)) {
    for (const [itemId, scoreValue] of Object.entries(itemScores)) {
      if (scoreValue === '' || scoreValue === null) continue;
      const num = parseFloat(scoreValue);
      const item = itemById[parseInt(itemId)];
      if (item?.is_rate_direct) {
        const rateMax = rateFormula.base + rateFormula.range;
        if (isNaN(num) || num < rateFormula.base || num > rateMax) {
          return res.status(400).json({ message: `Invalid Rate (${scoreValue}) — must be between ${rateFormula.base} and ${rateMax}.` });
        }
        continue;
      }
      const max = item ? parseFloat(item.max_score) : undefined;
      if (isNaN(num) || num < 0 || (max !== undefined && num > max)) {
        return res.status(400).json({ message: `Invalid score (${scoreValue}) — must be between 0 and ${max ?? 'the item\'s max'}.` });
      }
    }
  }

  // Save individual item scores
  for (const [studentId, itemScores] of Object.entries(scores)) {
    for (const [itemId, scoreValue] of Object.entries(itemScores)) {
      // A stale item_id — e.g. left over in the Faculty's own browser
      // draft (componentScores' own localStorage draft) from before a
      // Grade Component Setup edit deleted or recreated that item — can't
      // be saved at all: there's no real ComponentItem for it anymore, so
      // writing it would violate the FK constraint on component_items.id
      // ("Referenced record does not exist"). Silently dropped rather
      // than erroring the whole save, same as any other now-meaningless
      // leftover.
      if (!itemById[parseInt(itemId)]) continue;
      const [record, created] = await ComponentScore.findOrCreate({
        where: { item_id: parseInt(itemId), student_id: parseInt(studentId) },
        defaults: { score: scoreValue !== '' && scoreValue !== null ? parseFloat(scoreValue) : null },
      });

      if (!created) {
        record.score = scoreValue !== '' && scoreValue !== null ? parseFloat(scoreValue) : null;
        await record.save();
      }
    }
  }

  // Recompute Midterm & Finals GWA for every enrolled student
  const components = await GradeComponent.findAll({
    where: { class_id: classId },
    include: [{ model: ComponentItem, as: 'items', separate: true, order: [['order_index', 'ASC']] }],
    order: [['period', 'ASC'], ['order_index', 'ASC']],
  });

  const midtermComps = components.filter(c => c.period === 'Midterm');
  const finalsComps = components.filter(c => c.period === 'Finals');

  const enrollments = await Enrollment.findAll({ where: { class_id: classId } });
  const allItemIds = components.flatMap(c => c.items.map(i => i.id));
  const allScores = await ComponentScore.findAll({ where: { item_id: allItemIds } });

  const scoreByStudentAndItem = {};
  allScores.forEach(s => {
    if (!scoreByStudentAndItem[s.student_id]) scoreByStudentAndItem[s.student_id] = {};
    scoreByStudentAndItem[s.student_id][s.item_id] = s.score !== null ? parseFloat(s.score) : null;
  });

  // Composite for a period: only computed once every component in that period
  // has ALL of its items scored (mirrors the existing all-components-filled gate).
  const computePeriodComposite = (periodComps, studentId) => {
    const studentScores = scoreByStudentAndItem[studentId] || {};
    let composite = 0;
    for (const comp of periodComps) {
      const items = comp.items;
      if (items.length === 0) return null;
      const allFilled = items.every(i => studentScores[i.id] !== null && studentScores[i.id] !== undefined);
      if (!allFilled) return null;
      const rates = items.map(i => itemRate(studentScores[i.id], i.max_score, i.is_rate_direct, rateFormula));
      // Exact average — no rounding, so the Weighted/Composite below stay
      // at full precision.
      const componentAverage = rates.reduce((s, r) => s + r, 0) / rates.length;
      // Exact weighted contribution — Ave × weight%, unrounded.
      composite += componentAverage * (parseFloat(comp.weight) / 100);
    }
    return composite;
  };

  for (const enrollment of enrollments) {
    const sid = enrollment.student_id;
    // Completing an INC in a closed class recomputes that student only —
    // everyone else's submitted / released grade is left exactly as it is.
    if (incOnlyStudents && !incOnlyStudents.has(sid)) continue;

    let midtermGWA = null;
    let finalsGWA = null;
    let midComposite = null;
    let finComposite = null;
    // toGWA (top of file) matches classRecordExcel.js's periodGWA on the
    // frontend, so the live grid, the exports, and this stored value never
    // disagree. Both Grade.midterm and Grade.finals are each period's OWN
    // GWA, graded in isolation — kept that way since the Grade Sheet's
    // Midterm/Final Term Grade columns are still each period's own figure.
    // Grade.average (below) is the different, cumulative one — see
    // combinedGWA.

    if (midtermComps.length > 0) {
      midComposite = computePeriodComposite(midtermComps, sid);
      if (midComposite !== null) midtermGWA = toGWA(midComposite);
    }
    if (finalsComps.length > 0) {
      finComposite = computePeriodComposite(finalsComps, sid);
      if (finComposite !== null) finalsGWA = toGWA(finComposite);
    }

    if (midtermGWA !== null || finalsGWA !== null) {
      const [grade, created] = await Grade.findOrCreate({
        where: { class_id: parseInt(classId), student_id: sid },
        defaults: {
          midterm: midtermGWA,
          finals: finalsGWA,
          is_draft: true,
        },
      });

      if (!created) {
        if (midtermGWA !== null) grade.midterm = midtermGWA;
        if (finalsGWA !== null) grade.finals = finalsGWA;
        grade.is_draft = true;
      }

      // Both periods complete (and not manually marked INC/DRP): work out
      // Grade.average/status ourselves from the combined composites, and
      // tell the model's beforeSave hook to leave it alone (skipAutoAverage)
      // instead of immediately overwriting it with its own naive
      // (midterm+finals)/2 of the two already-clamped GWAs above. Runs
      // whether this row was just created or already existed, in case both
      // periods happened to complete in the very same recompute.
      let skipAutoAverage = false;
      if (midComposite !== null && finComposite !== null && grade.status !== 'INC' && grade.status !== 'DRP') {
        grade.average = combinedGWA(midComposite, finComposite);
        // <=3.01, not 3.0 — matches the real official spreadsheet's own
        // Remarks formula (IF(BU15<=3.01,"PASSED","FAILED")) exactly.
        grade.status = grade.average >= 1.0 && grade.average <= 3.01 ? 'Passed' : 'Failed';
        skipAutoAverage = true;
      }

      if (!created || skipAutoAverage) {
        await grade.save({ skipAutoAverage });
      }
    }
  }

  // A student marked INC whose scores are now all in is complete — turn
  // their stored grade back into a real one so it matches this Class Record.
  await resolveCompletedINCs(parseInt(classId));

  // In a closed class there is no "Submit Grades" left to click, so a
  // completed INC grade is final the moment the faculty resolves it:
  // submitted, carrying the class's existing approval, and — when the class's
  // grades were already released — released to the student right away. No
  // Admin step. (A class not released yet just rejoins the rest of the class:
  // the Admin releases it with everyone else's.) An INC nobody resolves by
  // its compliance deadline becomes 5.0 instead — utils/incLapse.js.
  if (incOnlyStudents) {
    const done = await Grade.findAll({ where: { class_id: cls.id, student_id: [...incOnlyStudents], status: ['Passed', 'Failed'], submitted: false } });
    if (done.length) {
      const approved = !!(cls.admin_class_record_approved && cls.admin_grade_sheet_approved);
      const classReleased = (await Grade.count({ where: { class_id: cls.id, released: true } })) > 0;
      const now = new Date();
      await Grade.update(
        { submitted: true, submitted_date: now, is_draft: false, admin_approved: approved, admin_approved_date: approved ? now : null, released: classReleased, released_date: classReleased ? now : null },
        { where: { id: done.map((g) => g.id) } }
      );
      const label = `${cls.subject?.code || 'a class'}${cls.section ? ` ${cls.year_level || ''}-${cls.section}` : ''}`;
      const students = await User.findAll({ where: { id: done.map((g) => g.student_id) }, attributes: ['id', 'name'] });
      const names = students.map((u) => u.name).join(', ');
      await logActivity(req.user.id, `completed the INC of ${names} in ${label} (${cls.semester})${classReleased ? ' — grade released to the student' : ''}`, 'Class', cls.id);
      if (classReleased) {
        const { createNotification } = require('./notificationController');
        await Promise.all(done.map((g) => createNotification(req.app, {
          userId: g.student_id,
          title: 'INC Completed — Grade Released',
          message: `Your INC in ${label} (${cls.semester}) was completed. Your final grade is ${Number(g.average).toFixed(2)} (${g.status}).`,
          type: 'grade',
          link: '/student/grades',
        })));
        // Passing it may make them Regular again / clear a retake.
        await require('../utils/enrollmentChecks').syncRegularity(req.app, done.map((g) => g.student_id), req.user.id).catch(() => {});
      }
      // The Admin is told, for the record — nothing for them to do.
      await notifyAdmins(req.app, {
        title: 'INC completed',
        message: `${req.user.name} completed the INC of ${names} in ${label} (${cls.semester}).${classReleased ? ' The grade was released to the student automatically.' : ''}`,
        type: 'grade',
        link: '/admin',
      });
    }
  }

  // Locks the score grid the moment Faculty explicitly saves — prevents
  // accidental further edits. unlockScores below is the deliberate way back
  // in. Skipped entirely when lock is false (Resolve INC).
  if (lock) {
    cls.class_record_locked = true;
    await cls.save();
  }

  await logActivity(req.user.id, `saved component scores for ${cls.subject?.code}`, 'Class', classId);

  // An explicit save (not a keystroke autosave) — Chairperson and Admin
  // dashboards show each class's encoding progress, so they hear about it
  // too ('pipeline' reaches them and drops the cached dashboard numbers).
  const io = req.app.get('io');
  if (io) {
    emitGradesUpdated(io, { class_id: parseInt(classId), message: 'Component scores saved' }, 'pipeline');
  }

  res.json({ message: 'Scores saved and grades computed.' });
});

// ================= UNLOCK SCORES =================
// The deliberate way back in after saveScores locks the grid — Faculty
// clicks "Edit Scores" to reopen it and make a correction, then saves again
// (which locks it right back). Doesn't touch any scores itself.
const unlockScores = asyncHandler(async (req, res) => {
  const { classId } = req.params;

  const cls = await Class.findByPk(classId, { include: [{ model: Subject, as: 'subject' }] });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  // A closed class is never reopened as a whole — only its INC students.
  const closedMsg = await closedClassMessage(cls);
  if (closedMsg) {
    return res.status(400).json({ message: `${closedMsg} Only students marked INC can still be completed — use "Resolve INC" on that student.` });
  }

  cls.class_record_locked = false;
  await cls.save();

  await logActivity(req.user.id, `unlocked the Class Record for ${cls.subject?.code}`, 'Class', classId);

  const io = req.app.get('io');
  if (io) {
    emitGradesUpdated(io, { class_id: parseInt(classId), message: 'Class Record unlocked' }, 'pipeline');
  }

  res.json({ message: 'Class Record unlocked — you can edit scores again.' });
});

// ================= RESET GRADES =================
// Wipes this class's actual encoded work — every ComponentScore, each
// student's computed midterm/finals/average/status, and the whole submit →
// verify → approve → release pipeline — back to a blank slate. Does NOT
// touch the class itself, its enrolled students, or its grade component/item
// SETUP (weights, item names, max scores all stay exactly as configured) —
// only the scores and grades that were entered against that setup. The
// deliberate, explicit way to start a class's grading cycle over; nothing
// else in the app does this as a side effect.
const resetClassGrades = asyncHandler(async (req, res) => {
  const { classId } = req.params;

  const cls = await Class.findByPk(classId, { include: [{ model: Subject, as: 'subject' }] });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  // Never on an archived class — its scores and grades are a kept record.
  const archivedMsg = await require('../utils/archiveGuard').archivedClassMessage(cls);
  if (archivedMsg) return res.status(400).json({ message: archivedMsg });

  const components = await GradeComponent.findAll({
    where: { class_id: classId },
    include: [{ model: ComponentItem, as: 'items' }],
  });
  const itemIds = components.flatMap((c) => (c.items || []).map((i) => i.id));
  if (itemIds.length > 0) {
    await ComponentScore.destroy({ where: { item_id: itemIds } });
  }

  // individualHooks so Grade's own beforeSave hook runs — with midterm/
  // finals both explicitly nulled here it's a no-op either way, but keeps
  // this consistent with every other place Grade rows get written.
  await Grade.update(
    {
      midterm: null,
      finals: null,
      average: null,
      status: 'Pending',
      inc_remarks: null,
      inc_deadline: null,
      inc_resolved_date: null,
      inc_lapsed_at: null,
      inc_lapsed_period: null,
      inc_midterm: false,
      inc_finals: false,
      submitted: false,
      submitted_date: null,
      is_draft: true,
      released: false,
      released_date: null,
      admin_approved: false,
      admin_approved_date: null,
    },
    { where: { class_id: classId }, individualHooks: true }
  );

  cls.class_record_locked = false;
  cls.chairperson_verified = false;
  cls.chairperson_verified_at = null;
  cls.class_record_verified = false;
  cls.class_record_verified_at = null;
  cls.grade_sheet_verified = false;
  cls.grade_sheet_verified_at = null;
  cls.admin_class_record_approved = false;
  cls.admin_class_record_approved_at = null;
  cls.admin_grade_sheet_approved = false;
  cls.admin_grade_sheet_approved_at = null;
  cls.admin_return_reason = null;
  cls.admin_returned_at = null;
  cls.awaiting_faculty_revision = false;
  cls.sent_to_chairperson = false;
  await cls.save();

  await logActivity(req.user.id, `reset all grades and scores for ${cls.subject?.code}`, 'Class', classId);

  const io = req.app.get('io');
  if (io) {
    emitGradesUpdated(io, { class_id: parseInt(classId), message: 'Grades reset' }, 'pipeline');
  }

  res.json({ message: 'Grades and scores cleared — you can start encoding again.' });
});

// ================= AUTO-COMPLETE INC =================
// The Class Record is the source of truth: a student still marked INC whose
// scores are now ALL in (every item of every Midterm and Finals component) is
// not incomplete anymore, so the stored grade has to say so — otherwise the
// Grade Sheet, its exports, and the Chairperson/Admin views keep showing INC
// for a student the Class Record already shows as complete.
//
// Turns the grade back into a normal, computed one exactly the way undoINC +
// a score save would (status -> Pending, then the Grade model's own hook
// works out average/Passed/Failed from the two GWAs): unsubmitted so Faculty
// resubmits it, and with release/approval cleared since the completed grade
// hasn't been through either yet. Idempotent and a cheap no-op when the class
// has no INC students. Returns how many were completed.
const resolveCompletedINCs = async (classId) => {
  const incGrades = await Grade.findAll({ where: { class_id: classId, status: 'INC' } });
  if (incGrades.length === 0) return 0;

  const cls = await Class.findByPk(classId);
  if (!cls) return 0;
  const rateFormula = getRateFormula(cls);

  const components = await GradeComponent.findAll({
    where: { class_id: classId },
    include: [{ model: ComponentItem, as: 'items', separate: true }],
  });
  const midtermComps = components.filter((c) => c.period === 'Midterm');
  const finalsComps = components.filter((c) => c.period === 'Finals');
  // The overall average (and so Passed/Failed) needs both periods.
  if (midtermComps.length === 0 || finalsComps.length === 0) return 0;

  const itemIds = components.flatMap((c) => c.items.map((i) => i.id));
  if (itemIds.length === 0) return 0;
  const scores = await ComponentScore.findAll({
    where: { item_id: itemIds, student_id: incGrades.map((g) => g.student_id) },
  });
  const scoreByStudentAndItem = {};
  scores.forEach((s) => {
    if (!scoreByStudentAndItem[s.student_id]) scoreByStudentAndItem[s.student_id] = {};
    scoreByStudentAndItem[s.student_id][s.item_id] = s.score !== null ? parseFloat(s.score) : null;
  });

  // Same computation saveScores uses: null until every item in every
  // component of the period has a score. Split into the raw composite and
  // its GWA conversion (rather than one function returning just the GWA) so
  // the raw composites are still around below to feed combinedGWA — same
  // reason saveScores keeps midComposite/finComposite around.
  const periodComposite = (periodComps, studentId) => {
    const studentScores = scoreByStudentAndItem[studentId] || {};
    let composite = 0;
    for (const comp of periodComps) {
      if (comp.items.length === 0) return null;
      if (!comp.items.every((i) => studentScores[i.id] !== null && studentScores[i.id] !== undefined)) return null;
      const rates = comp.items.map((i) => itemRate(studentScores[i.id], i.max_score, i.is_rate_direct, rateFormula));
      composite += (rates.reduce((s, r) => s + r, 0) / rates.length) * (parseFloat(comp.weight) / 100);
    }
    return composite;
  };
  // Faculty can mark a period INC even when its scores are already all in
  // (Mark INC is never blocked), so "scores are complete" alone can't mean the
  // INC is done — that would clear it the instant it was marked. A flagged
  // period only auto-clears when its scores were entered AFTER it was marked
  // (the mark stamps submitted_date), i.e. the student actually completed it.
  const periodOfItem = {};
  components.forEach((c) => c.items.forEach((i) => { periodOfItem[i.id] = c.period; }));
  const latestScoreAt = {};
  scores.forEach((s) => {
    const key = `${s.student_id}|${periodOfItem[s.item_id]}`;
    const t = new Date(s.updatedAt).getTime();
    if (!latestScoreAt[key] || t > latestScoreAt[key]) latestScoreAt[key] = t;
  });
  const enteredAfterMark = (grade, period) => {
    const markedAt = grade.submitted_date ? new Date(grade.submitted_date).getTime() : 0;
    return (latestScoreAt[`${grade.student_id}|${period}`] || 0) > markedAt;
  };

  // INC is per period (Grade.inc_midterm / inc_finals): each flagged period
  // clears on its own once ITS scores are all in, and the student only stops
  // being INC when no period is flagged anymore. A row from before the flags
  // existed (INC, neither set) counts as flagged in both.
  let completed = 0;
  for (const grade of incGrades) {
    const midComposite = periodComposite(midtermComps, grade.student_id);
    const finComposite = periodComposite(finalsComps, grade.student_id);
    const midterm = midComposite !== null ? toGWA(midComposite) : null;
    const finals = finComposite !== null ? toGWA(finComposite) : null;
    const legacy = !grade.inc_midterm && !grade.inc_finals;
    let incMid = grade.inc_midterm;
    let incFin = grade.inc_finals;

    let changed = false;
    if (legacy) {
      // A row marked INC before the per-period flags existed doesn't say which
      // period it was for, and reading it as "both" is what made the Finals
      // show INC when only the Midterm was ever marked. Settle it once, here:
      // INC in the earliest period still missing scores (a fully scored one
      // isn't INC at all and resolves below).
      incMid = midterm === null;
      incFin = midterm !== null && finals === null;
      changed = true;
      // (Neither period incomplete = a fully scored row from the old flow —
      // resolves below like before.)
    } else {
      if (incMid && midterm !== null && enteredAfterMark(grade, 'Midterm')) { incMid = false; changed = true; }
      if (incFin && finals !== null && enteredAfterMark(grade, 'Finals')) { incFin = false; changed = true; }
    }
    if (!changed) continue;

    // The Class Record is the truth — keep any completed period's GWA stored.
    if (midterm !== null) grade.midterm = midterm;
    if (finals !== null) grade.finals = finals;
    grade.inc_midterm = incMid;
    grade.inc_finals = incFin;

    if (!incMid && !incFin) {
      grade.status = 'Pending'; // not INC anymore — the beforeSave hook computes average + Passed/Failed once both GWAs exist
      grade.submitted = false;
      grade.submitted_date = null;
      grade.is_draft = true;
      grade.released = false;
      grade.released_date = null;
      grade.admin_approved = false;
      grade.admin_approved_date = null;
      grade.inc_remarks = null;
      grade.inc_deadline = null;
      grade.inc_resolved_date = new Date();
      completed += 1;
    }

    // Both periods complete (this resolve or an earlier one) and not INC/DRP
    // anymore: work out Grade.average/status from the combined composites
    // ourselves — same reasoning as saveScores' own combinedGWA call.
    let skipAutoAverage = false;
    if (midComposite !== null && finComposite !== null && grade.status !== 'INC' && grade.status !== 'DRP') {
      grade.average = combinedGWA(midComposite, finComposite);
      // <=3.01, not 3.0 — matches the real official spreadsheet's own
      // Remarks formula exactly.
      grade.status = grade.average >= 1.0 && grade.average <= 3.01 ? 'Passed' : 'Failed';
      skipAutoAverage = true;
    }

    await grade.save({ skipAutoAverage });
  }
  return completed;
};

// The Final Grade of each student in a class, worked out from its Class
// Record — { [studentId]: { average, status } } — for every student whose
// Midterm AND Finals are both completely scored. Empty when the class has no
// components in both periods. The same rule saveScores applies (combinedGWA:
// the true average of both periods' exact composites, converted once), so
// anything else that saves a grade row can keep that figure instead of
// replacing it with a plain (Midterm + Finals) / 2.
const classRecordFinalGrades = async (cls) => {
  const components = await GradeComponent.findAll({
    where: { class_id: cls.id },
    include: [{ model: ComponentItem, as: 'items', separate: true, order: [['order_index', 'ASC']] }],
  });
  const midtermComps = components.filter((c) => c.period === 'Midterm');
  const finalsComps = components.filter((c) => c.period === 'Finals');
  if (midtermComps.length === 0 || finalsComps.length === 0) return {};
  const rateFormula = getRateFormula(cls);
  const itemIds = components.flatMap((c) => c.items.map((i) => i.id));
  const scores = itemIds.length ? await ComponentScore.findAll({ where: { item_id: itemIds } }) : [];
  const byStudent = {};
  scores.forEach((s) => {
    if (!byStudent[s.student_id]) byStudent[s.student_id] = {};
    byStudent[s.student_id][s.item_id] = s.score !== null ? parseFloat(s.score) : null;
  });
  const compositeOf = (periodComps, studentScores) => {
    let composite = 0;
    for (const comp of periodComps) {
      if (comp.items.length === 0) return null;
      if (!comp.items.every((i) => studentScores[i.id] !== null && studentScores[i.id] !== undefined)) return null;
      const rates = comp.items.map((i) => itemRate(studentScores[i.id], i.max_score, i.is_rate_direct, rateFormula));
      composite += (rates.reduce((sum, r) => sum + r, 0) / rates.length) * (parseFloat(comp.weight) / 100);
    }
    return composite;
  };
  const out = {};
  Object.entries(byStudent).forEach(([studentId, studentScores]) => {
    const mid = compositeOf(midtermComps, studentScores);
    const fin = compositeOf(finalsComps, studentScores);
    if (mid === null || fin === null) return;
    const average = combinedGWA(mid, fin);
    out[studentId] = { average, status: average >= 1.0 && average <= 3.01 ? 'Passed' : 'Failed' };
  });
  return out;
};

module.exports = {
  classRecordFinalGrades,
  getComponents,
  saveComponents,
  getScores,
  saveScores,
  unlockScores,
  resetClassGrades,
  resolveCompletedINCs,
  itemRate,
  compositeToGWA,
  toGWA,
  combinedGWA,
};
