require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Adds the three columns behind message Edit / Unsend / Forward — see
// models/Message.js's own comments for what each one means.
const migrate = async () => {
  try {
    console.log('🔄 Running "Message edit/unsend/forward" columns migration...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('messages');

    if (desc.edited_at) {
      console.log('⏭️  Skipped: messages.edited_at already exists');
    } else {
      await qi.addColumn('messages', 'edited_at', { type: DataTypes.DATE, allowNull: true });
      console.log('✅ Added: messages.edited_at');
    }

    if (desc.deleted_at) {
      console.log('⏭️  Skipped: messages.deleted_at already exists');
    } else {
      await qi.addColumn('messages', 'deleted_at', { type: DataTypes.DATE, allowNull: true });
      console.log('✅ Added: messages.deleted_at');
    }

    if (desc.is_forwarded) {
      console.log('⏭️  Skipped: messages.is_forwarded already exists');
    } else {
      await qi.addColumn('messages', 'is_forwarded', { type: DataTypes.BOOLEAN, defaultValue: false });
      console.log('✅ Added: messages.is_forwarded');
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
