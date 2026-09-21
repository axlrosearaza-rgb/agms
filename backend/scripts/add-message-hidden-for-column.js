require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Adds messages.hidden_for — the per-user "delete for me" column that
// replaced the old shared "Unsend" behavior. See models/Message.js's own
// comment for what it means.
const migrate = async () => {
  try {
    console.log('🔄 Running "Message delete-for-me (hidden_for)" column migration...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('messages');

    if (desc.hidden_for) {
      console.log('⏭️  Skipped: messages.hidden_for already exists');
    } else {
      await qi.addColumn('messages', 'hidden_for', {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        allowNull: false,
        defaultValue: [],
      });
      console.log('✅ Added: messages.hidden_for');
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
