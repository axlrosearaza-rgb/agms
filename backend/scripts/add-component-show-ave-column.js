require('dotenv').config();
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Adding grade_components.show_ave...');
    const qi = sequelize.getQueryInterface();

    const desc = await qi.describeTable('grade_components');
    if (!desc.show_ave) {
      await sequelize.query(`ALTER TABLE grade_components ADD COLUMN show_ave BOOLEAN NOT NULL DEFAULT true;`);
      console.log('✅ Added: grade_components.show_ave');
    } else {
      console.log('⏭️  Skipped: grade_components.show_ave already exists');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
