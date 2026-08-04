require('dotenv').config();
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running admin_approved columns migration...');
    const qi = sequelize.getQueryInterface();

    const gradesDesc = await qi.describeTable('grades');
    if (!gradesDesc.admin_approved) {
      await sequelize.query(`ALTER TABLE grades ADD COLUMN admin_approved BOOLEAN NOT NULL DEFAULT false;`);
      console.log('✅ Added: grades.admin_approved');
    } else {
      console.log('⏭️  Skipped: grades.admin_approved already exists');
    }
    if (!gradesDesc.admin_approved_date) {
      await sequelize.query(`ALTER TABLE grades ADD COLUMN admin_approved_date TIMESTAMP DEFAULT NULL;`);
      console.log('✅ Added: grades.admin_approved_date');
    } else {
      console.log('⏭️  Skipped: grades.admin_approved_date already exists');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
