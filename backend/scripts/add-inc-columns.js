require('dotenv').config();
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running INC columns migration...');
    const qi = sequelize.getQueryInterface();
    const tableDesc = await qi.describeTable('grades');

    if (!tableDesc.inc_remarks) {
      await sequelize.query(`ALTER TABLE grades ADD COLUMN inc_remarks TEXT DEFAULT NULL;`);
      console.log('✅ Added: inc_remarks');
    } else {
      console.log('⏭️  Skipped: inc_remarks already exists');
    }

    if (!tableDesc.inc_deadline) {
      await sequelize.query(`ALTER TABLE grades ADD COLUMN inc_deadline TIMESTAMP DEFAULT NULL;`);
      console.log('✅ Added: inc_deadline');
    } else {
      console.log('⏭️  Skipped: inc_deadline already exists');
    }

    if (!tableDesc.inc_resolved_date) {
      await sequelize.query(`ALTER TABLE grades ADD COLUMN inc_resolved_date TIMESTAMP DEFAULT NULL;`);
      console.log('✅ Added: inc_resolved_date');
    } else {
      console.log('⏭️  Skipped: inc_resolved_date already exists');
    }

    console.log('\n🎉 Migration complete! You can now use the INC workflow.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();