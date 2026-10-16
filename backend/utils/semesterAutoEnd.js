const { Op } = require('sequelize');
const { Semester } = require('../models');

// ── Automatic Semester Lifecycle Management ───────────────────────────────────
// A semester's status and current active term are automatically determined from
// its duration (start_date and end_date):
//   1. start_date <= today <= end_date  -> Active & Current (is_current = true)
//   2. end_date < today                 -> Completed (is_current = false, classes archived)
//   3. start_date > today                -> Upcoming (is_current = false)
// Run at startup, hourly, and on semester queries/mutations.

const todayPH = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

const hasEnded = (endDate, today = todayPH()) => !!endDate && String(endDate) < today;
const isFuture = (startDate, today = todayPH()) => !!startDate && String(startDate) > today;
const isCurrentRange = (startDate, endDate, today = todayPH()) => {
  if (!startDate || !endDate) return false;
  return String(startDate) <= today && today <= String(endDate);
};

async function syncSemestersByDuration(app) {
  try {
    const { endSemester, emitSemestersUpdated } = require('../controllers/semesterController');
    const today = todayPH();
    let changed = false;

    // 1. End and archive all past semesters
    const pastSemesters = await Semester.findAll({
      where: {
        end_date: { [Op.lt]: today },
        [Op.or]: [{ status: { [Op.ne]: 'Completed' } }, { is_current: true }],
      },
    });

    for (const semester of pastSemesters) {
      if (semester.is_current) {
        semester.is_current = false;
        await semester.save();
      }
      await endSemester(app, semester);
      changed = true;
      console.log(`[semester-auto-sync] ${semester.name} ended on ${semester.end_date} — automatically marked Completed and archived.`);
    }

    // 2. Sync all semesters according to today's date
    const allSemesters = await Semester.findAll({
      order: [['start_date', 'DESC'], ['created_at', 'DESC']],
    });

    let currentFound = null;
    for (const sem of allSemesters) {
      if (hasEnded(sem.end_date, today)) {
        if (sem.status !== 'Completed' || sem.is_current) {
          sem.status = 'Completed';
          sem.is_current = false;
          await sem.save();
          changed = true;
        }
      } else if (isCurrentRange(sem.start_date, sem.end_date, today)) {
        if (!currentFound) {
          currentFound = sem;
          if (sem.status !== 'Active' || !sem.is_current) {
            sem.status = 'Active';
            sem.is_current = true;
            await sem.save();
            changed = true;
            console.log(`[semester-auto-sync] ${sem.name} is in progress (${sem.start_date} to ${sem.end_date}) — set as Current and Active.`);
          }
        } else if (sem.is_current) {
          sem.is_current = false;
          await sem.save();
          changed = true;
        }
      } else if (isFuture(sem.start_date, today)) {
        if (sem.status !== 'Upcoming' || sem.is_current) {
          sem.status = 'Upcoming';
          sem.is_current = false;
          await sem.save();
          changed = true;
        }
      }
    }

    // If an Active semester exists but has no start/end date, ensure at most one is_current
    if (!currentFound) {
      const activeSem = allSemesters.find((s) => s.status === 'Active');
      if (activeSem && !activeSem.is_current) {
        activeSem.is_current = true;
        await activeSem.save();
        changed = true;
      }
    }

    if (changed && app) {
      emitSemestersUpdated(app);
    }
    return changed;
  } catch (err) {
    console.error('[semester-auto-sync] check failed:', err.message);
    return false;
  }
}

async function endPastSemesters(app) {
  return syncSemestersByDuration(app);
}

module.exports = {
  syncSemestersByDuration,
  endPastSemesters,
  hasEnded,
  isFuture,
  isCurrentRange,
  todayPH,
};
