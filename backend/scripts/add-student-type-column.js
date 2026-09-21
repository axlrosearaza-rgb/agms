/**
 * Splits "Student Type" out of student_status, which used to double as both
 * the functional Regular/Irregular flag AND the purely-descriptive New/
 * Shifter/Transferee/Old/Quitter label — adds a dedicated `student_type`
 * column (nullable STRING) to both `users` and `pending_registrations`.
 * student_status keeps its existing DB enum type unchanged (still legally
 * allows all 7 old values) but the app only ever writes Regular/Irregular
 * into it from here on.
 *
 * Run: node scripts/add-student-type-column.js
 */
require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

async function addIfMissing(table, column, spec) {
  const qi = sequelize.getQueryInterface();
  const desc = await qi.describeTable(table);
  if (desc[column]) {
    console.log(`  ${table}.${column} already exists — skipping.`);
    return;
  }
  await qi.addColumn(table, column, spec);
  console.log(`  ✅ Added ${table}.${column}`);
}

async function main() {
  await addIfMissing('users', 'student_type', { type: DataTypes.STRING(20), allowNull: true });
  await addIfMissing('pending_registrations', 'student_type', { type: DataTypes.STRING(20), allowNull: true });

  // No backfill needed — checked live data before writing this script and
  // every existing Student/PendingRegistration row's student_status is
  // already just 'Regular' (nothing had picked a descriptive type yet), so
  // there's nothing stray to migrate out of it.
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
