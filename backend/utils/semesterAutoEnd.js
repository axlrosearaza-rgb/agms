const { Op } = require('sequelize');
const { Semester } = require('../models');

// ── A semester whose end date has passed is over ─────────────────────────────
// Any semester still Active/Upcoming (or still marked current) whose end_date
// is before today (Philippine time) is ended the same way an Admin ending it
// by hand does — status 'Completed', no longer current, its classes archived
// and everyone notified (semesterController.endSemester). The semester is
// still OPEN on its end date itself; it ends the day after.
// Run shortly after startup, hourly (server.js), and after every semester
// create/update/set-current so a past end date applies immediately.

const todayPH = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

// True when a YYYY-MM-DD end date is already behind us.
const hasEnded = (endDate, today = todayPH()) => !!endDate && String(endDate) < today;

async function endPastSemesters(app) {
  try {
    const { endSemester, emitSemestersUpdated } = require('../controllers/semesterController');
    const today = todayPH();
    const due = await Semester.findAll({
      where: {
        end_date: { [Op.lt]: today },
        [Op.or]: [{ status: { [Op.ne]: 'Completed' } }, { is_current: true }],
      },
    });
    if (!due.length) return 0;
    for (const semester of due) {
      if (semester.is_current) {
        semester.is_current = false;
        await semester.save();
      }
      await endSemester(app, semester); // no-op if it was already Completed
      console.log(`[semester-auto-end] ${semester.name} ended on ${semester.end_date} — marked Completed.`);
    }
    if (app) emitSemestersUpdated(app);
    return due.length;
  } catch (err) {
    console.error('[semester-auto-end] check failed:', err.message);
    return 0;
  }
}

module.exports = { endPastSemesters, hasEnded, todayPH };
