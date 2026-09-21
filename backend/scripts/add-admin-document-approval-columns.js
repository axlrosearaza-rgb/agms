require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Admin's side of the same per-document approve pattern Chairperson already
// has (class_record_verified / grade_sheet_verified) — two independent
// Approve buttons instead of one combined action.
const COLUMNS = [
  ['admin_class_record_approved', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }],
  ['admin_class_record_approved_at', { type: DataTypes.DATE, allowNull: true }],
  ['admin_grade_sheet_approved', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }],
  ['admin_grade_sheet_approved_at', { type: DataTypes.DATE, allowNull: true }],
];

const migrate = async () => {
  try {
    console.log('🔄 Running "classes.admin_*_approved" columns migration...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('classes');

    for (const [name, def] of COLUMNS) {
      if (desc[name]) {
        console.log(`⏭️  Skipped: classes.${name} already exists`);
      } else {
        await qi.addColumn('classes', name, def);
        console.log(`✅ Added: classes.${name}`);
      }
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
