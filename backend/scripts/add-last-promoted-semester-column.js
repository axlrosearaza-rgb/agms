/**
 * Adds User.last_promoted_semester (STRING, nullable) — records the exact
 * semester name a student was last cleared/promoted for, so
 * promotionController.evaluateStudents can tell "freshly Eligible" apart
 * from "already processed by a previous Promote run" instead of the same
 * student showing as Eligible forever.
 *
 * Run: node scripts/add-last-promoted-semester-column.js
 */
require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

async function main() {
  const qi = sequelize.getQueryInterface();
  const desc = await qi.describeTable('users');
  if (desc.last_promoted_semester) {
    console.log('users.last_promoted_semester already exists — skipping.');
    process.exit(0);
  }
  await qi.addColumn('users', 'last_promoted_semester', { type: DataTypes.STRING(100), allowNull: true });
  console.log('✅ Added users.last_promoted_semester');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
