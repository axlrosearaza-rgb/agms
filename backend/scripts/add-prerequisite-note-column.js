require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running "prerequisite_note" column migration...');
    const qi = sequelize.getQueryInterface();
    const subjectsDesc = await qi.describeTable('subjects');

    if (subjectsDesc.prerequisite_note) {
      console.log('⏭️  Skipped: subjects.prerequisite_note already exists');
    } else {
      await qi.addColumn('subjects', 'prerequisite_note', { type: DataTypes.STRING(150), allowNull: true });
      console.log('✅ Added: subjects.prerequisite_note');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
