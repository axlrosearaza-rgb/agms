const { GradeComponent, ComponentItem, ComponentScore, Class, Subject, Enrollment, Grade, User } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');
const { logActivity } = require('../utils/activityLogger');
const { actsAsInstructor } = require('../utils/teachingAuth');

// ── SSU Class Record formula ────────────────────────────────────────────────
// Item Rate: linear transmutation of a raw score into a Rate. Kept at full
// precision (unrounded) all the way through Rate → Average → Weighted →
// Composite — only the final GWA (via toGWA below) is rounded, to 1
// decimal. Whole-number/1-decimal display of Rate/Average/Weighted happens
// in the frontend, purely cosmetic — it never feeds back into this math.
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

// Composite (0–100ish) -> continuous GWA, clamped to the SSU 1.0–5.0 scale.
// Exact — composite is never floored/truncated first, so this reads the
// real computed composite, not one already thrown off by an earlier
// rounding step.
const compositeToGWA = (composite) => {
  const gwa = 10.5 - 0.1 * composite;
  return Math.min(5.0, Math.max(1.0, gwa));
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

  if (cls.class_record_locked) {
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

    let midtermGWA = null;
    let finalsGWA = null;
    // GWA is reported to 1 decimal place school-wide (per the Registrar's own
    // instruction) — matches classRecordExcel.js's periodGWA on the frontend,
    // so the live grid,
    // the exports, and this stored value never disagree. Both Grade.midterm
    // and Grade.finals are each period's OWN GWA, graded
    // in isolation — this is deliberately NOT the course's cumulative Final
    // Grade (see classRecordExcel.js's finalGWA): the Class Record's own
    // "Final Grade" column is computed live from BOTH periods' composites
    // combined and never reads this stored field at all (ClassRecordView.js/
    // GradeEncoding.js), while the Grade Sheet's "Average" is deliberately
    // the simple (Grade.midterm + Grade.finals) / 2 of these two isolated
    // per-period numbers — a different, simpler figure the Grade Sheet asks
    // for on purpose. Storing the cumulative Final Grade in Grade.finals
    // instead would silently break that Grade Sheet average by double-
    // blending Midterm into an already-cumulative number.
    const toGWA = (composite) => Math.round(compositeToGWA(composite) * 10) / 10;

    if (midtermComps.length > 0) {
      const composite = computePeriodComposite(midtermComps, sid);
      if (composite !== null) midtermGWA = toGWA(composite);
    }
    if (finalsComps.length > 0) {
      const composite = computePeriodComposite(finalsComps, sid);
      if (composite !== null) finalsGWA = toGWA(composite);
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
        await grade.save();
      }
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

  const io = req.app.get('io');
  if (io) {
    io.emit('gradesUpdated', { class_id: parseInt(classId), message: 'Component scores updated' });
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

  cls.class_record_locked = false;
  await cls.save();

  await logActivity(req.user.id, `unlocked the Class Record for ${cls.subject?.code}`, 'Class', classId);

  const io = req.app.get('io');
  if (io) {
    io.emit('gradesUpdated', { class_id: parseInt(classId), message: 'Class Record unlocked' });
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
    io.emit('gradesUpdated', { class_id: parseInt(classId), message: 'Grades reset' });
  }

  res.json({ message: 'Grades and scores cleared — you can start encoding again.' });
});

module.exports = {
  getComponents,
  saveComponents,
  getScores,
  saveScores,
  unlockScores,
  resetClassGrades,
  itemRate,
  compositeToGWA,
};
