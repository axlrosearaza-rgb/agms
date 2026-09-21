require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running privacy-consent columns migration...');
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

    await addIfMissing('privacy_accepted', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    await addIfMissing('privacy_accepted_at', { type: DataTypes.DATE, allowNull: true });
    await addIfMissing('privacy_policy_version', { type: DataTypes.STRING(20), allowNull: true });

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
