// Targeted delivery for the app's most frequent real-time event.
//
// `gradesUpdated` used to be io.emit()'d — pushed to EVERY connected socket —
// on every event, including each Faculty autosave of a draft. Every browser
// that received it then re-fetched data (sidebar counts, dashboards, class
// lists). With 3,000 people online, a single autosave meant thousands of
// sockets woken and thousands of REST requests fired, from people who could
// not possibly care that a teacher was typing a draft score.
//
// Now each event goes only to the people whose screen it can change:
//
//   'draft'    — score/draft saves. Only the class's own instructor (their
//                other open tabs). Nobody in the review pipeline sees drafts.
//   'pipeline' — submit / verify / forward / approve / return / unlock /
//                reset / INC / drop. The instructor, plus every Admin and
//                Chairperson (whose approval queues and dashboards it moves).
//   'release'  — grades published. As 'pipeline', plus the class's enrolled
//                students (the only event they ever need).
const { invalidateTags } = require('./responseCache');

const instructorCache = new Map(); // class_id -> { instructorId, expiresAt }
const INSTRUCTOR_TTL_MS = 60 * 1000;

async function instructorOf(classId) {
  const hit = instructorCache.get(classId);
  if (hit && hit.expiresAt > Date.now()) return hit.instructorId;
  const { Class } = require('../models'); // lazy: avoid a load-order cycle
  const row = await Class.findByPk(classId, { attributes: ['instructor_id'], raw: true });
  const instructorId = row ? row.instructor_id : null;
  if (instructorCache.size > 5000) instructorCache.delete(instructorCache.keys().next().value);
  instructorCache.set(classId, { instructorId, expiresAt: Date.now() + INSTRUCTOR_TTL_MS });
  return instructorId;
}

// io may be undefined (no socket server in some contexts) — a no-op then.
async function emitGradesUpdated(io, payload, kind = 'pipeline') {
  // Anything cached about classes/dashboards is stale from this moment —
  // drop it BEFORE telling clients to re-fetch, so the re-fetch can't be
  // answered from the copy that's about to be wrong.
  if (kind !== 'draft') invalidateTags(['classes', 'dashboard']);
  if (!io) return;

  try {
    const classId = Number(payload && payload.class_id);
    const rooms = [];
    const instructorId = classId ? await instructorOf(classId) : null;
    if (instructorId) rooms.push(`user:${instructorId}`);

    if (kind !== 'draft') {
      rooms.push('role:Admin', 'role:Chairperson');
    }

    if (kind === 'release' && classId) {
      const { Enrollment } = require('../models');
      const roster = await Enrollment.findAll({ where: { class_id: classId }, attributes: ['student_id'], raw: true });
      roster.forEach((r) => rooms.push(`user:${r.student_id}`));
    }

    // Unknown class or no audience resolved: fall back to the staff rooms so
    // an event is never silently lost.
    if (rooms.length === 0) rooms.push('role:Admin', 'role:Chairperson');

    io.to(rooms).emit('gradesUpdated', payload);
  } catch (err) {
    console.error('emitGradesUpdated failed:', err.message);
  }
}

module.exports = { emitGradesUpdated };
