// An INC the student didn't complete by its compliance deadline becomes 5.0.
//
// The faculty sets a deadline when marking a student INC (gradeController
// .markAsINC). Once that day has fully passed and the grade is still INC, the
// INC period(s) and the final grade become 5.0 and the status Failed. The
// faculty's INC reason (inc_remarks) is kept — the Class Record / Grade Sheet
// Remarks show it instead of "FAILED", so it's clear why. An INC with no
// deadline (older records) lapses INC_DEFAULT_WINDOW_DAYS after release.
const { Op } = require('sequelize');
const { Grade, Class, Subject, User } = require('../models');

const INC_DEFAULT_WINDOW_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

// Start of today (server local time) — a deadline is valid for its whole day.
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

// classId (optional) limits the sweep to one class. Never throws.
async function lapseExpiredINCs(app, { classId = null } = {}) {
  try {
    const where = {
      status: 'INC',
      [Op.or]: [
        { inc_deadline: { [Op.lt]: startOfToday() } },
        { inc_deadline: null, released: true, released_date: { [Op.lt]: new Date(Date.now() - INC_DEFAULT_WINDOW_DAYS * DAY_MS) } },
      ],
    };
    if (classId) where.class_id = classId;
    const expired = await Grade.findAll({
      where,
      include: [
        { model: Class, as: 'class', attributes: ['id', 'instructor_id', 'section', 'year_level'], include: [{ model: Subject, as: 'subject', attributes: ['code'] }] },
        { model: User, as: 'student', attributes: ['id', 'name'] },
      ],
    });
    if (!expired.length) return 0;

    const { createNotification } = require('../controllers/notificationController');
    const { emitGradesUpdated } = require('./realtime');
    const now = new Date();
    const touchedClasses = new Set();

    for (const g of expired) {
      // Older INC rows may have neither period flagged — treat whichever
      // period has no grade as the incomplete one.
      const midInc = g.inc_midterm || (!g.inc_midterm && !g.inc_finals && g.midterm == null);
      const finInc = g.inc_finals || (!g.inc_midterm && !g.inc_finals && g.finals == null);
      // Grade.update (static) skips the beforeSave hook, which would otherwise
      // recompute the average from the two periods.
      await Grade.update({
        midterm: midInc ? 5.0 : g.midterm,
        finals: finInc ? 5.0 : g.finals,
        average: 5.0,
        status: 'Failed',
        inc_midterm: false,
        inc_finals: false,
        inc_lapsed_at: now,
        inc_lapsed_period: midInc && finInc ? 'Both' : midInc ? 'Midterm' : 'Finals',
      }, { where: { id: g.id } });
      touchedClasses.add(g.class_id);

      const label = `${g.class?.subject?.code || 'a subject'}${g.class?.section ? ` - Section ${g.class.section}` : ''}`;
      const reason = g.inc_remarks ? ` Reason: "${g.inc_remarks}".` : '';
      if (app) {
        if (g.released) {
          await createNotification(app, {
            userId: g.student_id,
            title: 'INC Not Completed — Grade is now 5.0',
            message: `Your INC in ${label} was not completed by the deadline, so your grade is now 5.0 (Failed).${reason}`,
            type: 'grade',
            link: '/student/grades',
          });
        }
        if (g.class?.instructor_id) {
          await createNotification(app, {
            userId: g.class.instructor_id,
            title: 'INC Lapsed to 5.0',
            message: `${g.student?.name || 'A student'}'s INC in ${label} passed its deadline without being completed — their grade is now 5.0.${reason}`,
            type: 'grade',
            link: `/faculty/encode/${g.class_id}`,
          });
        }
      }
    }

    const io = app && app.get && app.get('io');
    if (io) touchedClasses.forEach((id) => emitGradesUpdated(io, { class_id: id, message: 'INC lapsed to 5.0' }, 'pipeline'));
    console.log(`[inc-lapse] ${expired.length} INC grade(s) passed their deadline → 5.0`);
    return expired.length;
  } catch (err) {
    console.error('[inc-lapse] failed:', err.message);
    return 0;
  }
}

module.exports = { lapseExpiredINCs };
