require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running "last_seen_at" column migration...');
    const qi = sequelize.getQueryInterface();
    const usersDesc = await qi.describeTable('users');

    if (usersDesc.last_seen_at) {
      console.log('⏭️  Skipped: users.last_seen_at already exists');
    } else {
      await qi.addColumn('users', 'last_seen_at', { type: DataTypes.DATE, allowNull: true });
      console.log('✅ Added: users.last_seen_at');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
