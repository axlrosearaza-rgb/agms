require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Adds grades.inc_component_ids — see models/Grade.js's own comment for what
// it means (the GradeComponent ids flagged incomplete when a student is
// marked INC, used to keep everything else locked while resolving).
const migrate = async () => {
  try {
    console.log('🔄 Running "Grade INC component ids" column migration...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('grades');

    if (desc.inc_component_ids) {
      console.log('⏭️  Skipped: grades.inc_component_ids already exists');
    } else {
      await qi.addColumn('grades', 'inc_component_ids', {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        allowNull: false,
        defaultValue: [],
      });
      console.log('✅ Added: grades.inc_component_ids');
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
