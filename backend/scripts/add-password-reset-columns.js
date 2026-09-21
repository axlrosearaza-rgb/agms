require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running password-reset columns migration...');
    const qi = sequelize.getQueryInterface();
    const usersDesc = await qi.describeTable('users');

    const addIfMissing = async (name, definition) => {
      if (usersDesc[name]) {
        console.log(`⏭️  Skipped: users.${name} already exists`);
        return;
      }
      await qi.addColumn('users', name, definition);
      console.log(`✅ Added: users.${name}`);
    };

    await addIfMissing('reset_password_token', { type: DataTypes.STRING(255), allowNull: true });
    await addIfMissing('reset_password_expires', { type: DataTypes.DATE, allowNull: true });

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
