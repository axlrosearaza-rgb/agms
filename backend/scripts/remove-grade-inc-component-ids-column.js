require('dotenv').config();
const { sequelize } = require('../config/database');

// Rolls back add-grade-inc-component-ids-column.js — resolving an INC no
// longer requires picking which components are incomplete ahead of time
// (see models/Grade.js's own history); the Resolve INC popup now detects
// what's still missing live off componentScores instead, so this column is
// dead weight.
const migrate = async () => {
  try {
    console.log('🔄 Rolling back "Grade INC component ids" column...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('grades');

    if (!desc.inc_component_ids) {
      console.log('⏭️  Skipped: grades.inc_component_ids already gone');
    } else {
      await qi.removeColumn('grades', 'inc_component_ids');
      console.log('✅ Removed: grades.inc_component_ids');
    }

    console.log('✅ Migration complete.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
};

migrate();
