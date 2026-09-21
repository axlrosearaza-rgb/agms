require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running "is_teaching" column migration...');
    const qi = sequelize.getQueryInterface();
    const usersDesc = await qi.describeTable('users');

    if (usersDesc.is_teaching) {
      console.log('⏭️  Skipped: users.is_teaching already exists');
    } else {
      await qi.addColumn('users', 'is_teaching', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
      console.log('✅ Added: users.is_teaching');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
