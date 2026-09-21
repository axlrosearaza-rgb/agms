require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running "classes.chairperson_verified[_at]" column migration...');
    const qi = sequelize.getQueryInterface();
    const classesDesc = await qi.describeTable('classes');

    if (classesDesc.chairperson_verified) {
      console.log('⏭️  Skipped: classes.chairperson_verified already exists');
    } else {
      await qi.addColumn('classes', 'chairperson_verified', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
      console.log('✅ Added: classes.chairperson_verified');
    }

    if (classesDesc.chairperson_verified_at) {
      console.log('⏭️  Skipped: classes.chairperson_verified_at already exists');
    } else {
      await qi.addColumn('classes', 'chairperson_verified_at', { type: DataTypes.DATE, allowNull: true });
      console.log('✅ Added: classes.chairperson_verified_at');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
