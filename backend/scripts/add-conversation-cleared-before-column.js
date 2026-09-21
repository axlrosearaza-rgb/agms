require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Adds the column behind "delete for me" content erasure (see
// models/ConversationParticipant.js's own comment) — a one-way watermark
// that permanently excludes everything sent at or before it from that one
// participant's own view, independent of deleted_at (which only ever
// controls conversation-LIST visibility, not content).
const migrate = async () => {
  try {
    console.log('🔄 Running "Conversation cleared_before" column migration...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('conversation_participants');

    if (desc.cleared_before) {
      console.log('⏭️  Skipped: conversation_participants.cleared_before already exists');
    } else {
      await qi.addColumn('conversation_participants', 'cleared_before', { type: DataTypes.DATE, allowNull: true });
      console.log('✅ Added: conversation_participants.cleared_before');
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
