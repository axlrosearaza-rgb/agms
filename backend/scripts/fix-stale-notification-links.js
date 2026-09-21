require('dotenv').config();
const { sequelize } = require('../config/database');

// The notification `link` is stored on the row at the moment it's created —
// fixing where a controller points a notification going forward does
// nothing for rows already sitting in the table with the old link (or no
// link at all) baked in. This is a one-off backfill for exactly those: safe
// to re-run, every statement only ever touches rows that still have a stale
// pattern, never ones already correct.
const run = async () => {
  try {
    console.log('🔄 Fixing stale notification links...');

    // ---- Static, role-independent fixes ----
    const staticFixes = [
      // "Grading Sheet Submitted" (Faculty -> Chairperson) used to send both
      // Chairperson and Admin to the read-only /grading-sheet/:id preview.
      { from: '/grading-sheet/', to: '/chairperson/grading-sheets' },
      // "Class Record & Grade Sheet Sent Back for Revision" (Admin ->
      // Chairperson) used to send Chairperson to the read-only
      // /class-record/:id preview.
      { from: '/class-record/', to: '/chairperson/grading-sheets' },
    ];
    for (const { from, to } of staticFixes) {
      const [, result] = await sequelize.query(
        `UPDATE notifications SET link = :to WHERE link LIKE :pattern`,
        { replacements: { to, pattern: `${from}%` } }
      );
      console.log(`✅ ${result?.rowCount ?? 0} row(s): "${from}*" → "${to}"`);
    }

    // ---- Role-dependent fixes — the correct link differs per recipient,
    // so these join back to the recipient's own current role instead of a
    // single fixed replacement string. ----
    const roleFixes = [
      // Chat notifications from before chatController.js started building
      // the link as `/${role}/messages` — a bare "/messages" matches no
      // route for any role.
      { where: `type = 'chat' AND link = '/messages'`, to: (col) => `'/' || lower(${col}::text) || '/messages'`, label: 'chat: /messages -> /<role>/messages' },
      // Semester-ended notifications (notifyAllUsers) from before that
      // helper defaulted a missing link to the recipient's own role home.
      { where: `type = 'semester' AND link IS NULL`, to: (col) => `'/' || lower(${col}::text)`, label: 'semester: NULL -> /<role>' },
      // Security notifications (username/email/password changed) from
      // before those calls started passing settingsPathFor(role).
      { where: `type = 'security' AND link IS NULL`, to: (col) => `'/' || lower(${col}::text) || '/settings'`, label: 'security: NULL -> /<role>/settings' },
    ];
    for (const fix of roleFixes) {
      const [, result] = await sequelize.query(`
        UPDATE notifications n
        SET link = ${fix.to('u.role')}
        FROM users u
        WHERE n.user_id = u.id AND ${fix.where}
      `);
      console.log(`✅ ${result?.rowCount ?? 0} row(s): ${fix.label}`);
    }

    console.log('Done.');
  } catch (err) {
    console.error('❌ Failed:', err.message);
  } finally {
    await sequelize.close();
  }
};

run();
