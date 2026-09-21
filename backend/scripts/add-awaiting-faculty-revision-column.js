require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Lets the Chairperson's Grade Approval page hide a class entirely while
// it's been bounced to Faculty for revision — it's not the Chairperson's
// problem again until Faculty resubmits.
const migrate = async () => {
  try {
    console.log('🔄 Running "classes.awaiting_faculty_revision" column migration...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('classes');

    if (desc.awaiting_faculty_revision) {
      console.log('⏭️  Skipped: classes.awaiting_faculty_revision already exists');
    } else {
      await qi.addColumn('classes', 'awaiting_faculty_revision', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
      console.log('✅ Added: classes.awaiting_faculty_revision');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
