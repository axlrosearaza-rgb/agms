require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running "regularization_locked_at" column migration...');
    const qi = sequelize.getQueryInterface();
    const usersDesc = await qi.describeTable('users');

    if (usersDesc.regularization_locked_at) {
      console.log('⏭️  Skipped: users.regularization_locked_at already exists');
    } else {
      await qi.addColumn('users', 'regularization_locked_at', { type: DataTypes.DATE, allowNull: true });
      console.log('✅ Added: users.regularization_locked_at');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
