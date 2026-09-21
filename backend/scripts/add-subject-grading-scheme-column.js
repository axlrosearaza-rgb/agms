require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running "Subject grading scheme" column migration...');
    const qi = sequelize.getQueryInterface();
    const subjectsDesc = await qi.describeTable('subjects');

    if (subjectsDesc.grading_scheme) {
      console.log('⏭️  Skipped: subjects.grading_scheme already exists');
    } else {
      await qi.addColumn('subjects', 'grading_scheme', { type: DataTypes.JSONB, allowNull: true });
      console.log('✅ Added: subjects.grading_scheme');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
