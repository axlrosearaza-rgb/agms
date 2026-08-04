const { GradeComponent, ComponentItem, ComponentScore, Class, Subject, Enrollment, Grade } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');
const { logActivity } = require('../utils/activityLogger');

// ── SSU Class Record formula ────────────────────────────────────────────────
// Item Rate: linear transmutation of a raw score into the 50–95 range.
const itemRate = (score, maxScore) => {
  const s = parseFloat(score);
  const m = parseFloat(maxScore) || 100;
  return (s / m) * 45 + 50;
};

// Composite (0–100ish) -> continuous GWA, clamped to the SSU 1.0–5.0 scale.
const compositeToGWA = (composite) => {
  const floored = Math.floor(composite * 10) / 10;
  const gwa = 10.5 - 0.1 * floored;
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

  if (req.user.role === 'Instructor' && cls.instructor_id !== req.user.id) {
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
  const { components } = req.body; // Array of { id?, name, period, weight, order_index, items: [{id?, name, max_score, order_index}] }

  const cls = await Class.findByPk(classId, {
    include: [{ model: Subject, as: 'subject' }],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Instructor' && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'Access denied.' });
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
      }, { where: { id: comp.id } });
      componentId = comp.id;
    } else {
      const newComp = await GradeComponent.create({
        class_id: parseInt(classId),
        name: comp.name,
        period: comp.period,
        weight: comp.weight,
        order_index: comp.order_index || 0,
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
        }, { where: { id: item.id } });
      } else {
        await ComponentItem.create({
          component_id: componentId,
          name: item.name,
          max_score: item.max_score || 100,
          order_index: item.order_index || 0,
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

  if (req.user.role === 'Instructor' && cls.instructor_id !== req.user.id) {
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
  const { scores } = req.body; // { student_id: { item_id: score_value } }

  const cls = await Class.findByPk(classId, {
    include: [{ model: Subject, as: 'subject' }],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Instructor' && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  // Save individual item scores
  for (const [studentId, itemScores] of Object.entries(scores)) {
    for (const [itemId, scoreValue] of Object.entries(itemScores)) {
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
      const rates = items.map(i => itemRate(studentScores[i.id], i.max_score));
      const componentAverage = rates.reduce((s, r) => s + r, 0) / rates.length;
      composite += componentAverage * (parseFloat(comp.weight) / 100);
    }
    return composite;
  };

  for (const enrollment of enrollments) {
    const sid = enrollment.student_id;

    let midtermGWA = null;
    let finalsGWA = null;

    if (midtermComps.length > 0) {
      const composite = computePeriodComposite(midtermComps, sid);
      if (composite !== null) midtermGWA = Math.round(compositeToGWA(composite) * 100) / 100;
    }
    if (finalsComps.length > 0) {
      const composite = computePeriodComposite(finalsComps, sid);
      if (composite !== null) finalsGWA = Math.round(compositeToGWA(composite) * 100) / 100;
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

  await logActivity(req.user.id, `saved component scores for ${cls.subject?.code}`, 'Class', classId);

  const io = req.app.get('io');
  if (io) {
    io.emit('gradesUpdated', { class_id: parseInt(classId), message: 'Component scores updated' });
  }

  res.json({ message: 'Scores saved and grades computed.' });
});

module.exports = {
  getComponents,
  saveComponents,
  getScores,
  saveScores,
  itemRate,
  compositeToGWA,
};
