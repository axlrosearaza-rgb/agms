require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running "conversation_participants.deleted_at" column migration...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('conversation_participants');

    if (desc.deleted_at) {
      console.log('⏭️  Skipped: conversation_participants.deleted_at already exists');
    } else {
      await qi.addColumn('conversation_participants', 'deleted_at', { type: DataTypes.DATE, allowNull: true });
      console.log('✅ Added: conversation_participants.deleted_at');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
