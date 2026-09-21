require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running "classes.year_level" column migration...');
    const qi = sequelize.getQueryInterface();
    const classesDesc = await qi.describeTable('classes');

    if (classesDesc.year_level) {
      console.log('⏭️  Skipped: classes.year_level already exists');
    } else {
      await qi.addColumn('classes', 'year_level', { type: DataTypes.INTEGER, allowNull: true });
      console.log('✅ Added: classes.year_level');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
