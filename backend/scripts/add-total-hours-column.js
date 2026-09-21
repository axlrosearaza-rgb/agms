require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running "total_hours" column migration...');
    const qi = sequelize.getQueryInterface();
    const subjectsDesc = await qi.describeTable('subjects');

    if (subjectsDesc.total_hours) {
      console.log('⏭️  Skipped: subjects.total_hours already exists');
    } else {
      await qi.addColumn('subjects', 'total_hours', { type: DataTypes.INTEGER, allowNull: true });
      console.log('✅ Added: subjects.total_hours');
    }

    // Backfill: for existing subjects that already have a lecture/lab breakdown,
    // set total_hours = lecture_hours + lab_hours so nothing regresses to blank.
    const [result] = await sequelize.query(`
      UPDATE subjects
      SET total_hours = COALESCE(lecture_hours, 0) + COALESCE(lab_hours, 0)
      WHERE total_hours IS NULL AND (lecture_hours IS NOT NULL OR lab_hours IS NOT NULL);
    `);
    console.log(`✅ Backfilled total_hours for existing subjects with a Lecture/Lab breakdown`);

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
