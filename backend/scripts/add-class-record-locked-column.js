/**
 * Adds Class.class_record_locked (BOOLEAN, default false) — locks the Class
 * Record's per-item score grid once Faculty clicks "Save All Scores", with
 * an explicit "Edit Scores" action to unlock it again (see
 * gradeComponentController.saveScores/unlockScores).
 *
 * Run: node scripts/add-class-record-locked-column.js
 */
require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

async function main() {
  const qi = sequelize.getQueryInterface();
  const desc = await qi.describeTable('classes');
  if (desc.class_record_locked) {
    console.log('classes.class_record_locked already exists — skipping.');
    process.exit(0);
  }
  await qi.addColumn('classes', 'class_record_locked', {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  console.log('✅ Added classes.class_record_locked');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
