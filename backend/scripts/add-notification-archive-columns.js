require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Adds the two columns behind auto-archiving (see models/Notification.js +
// notificationController.archiveStaleNotifications) — a notification turns
// `archived: true` once it's 24h old, dropping it out of the bell dropdown
// and unread count without deleting the row.
const migrate = async () => {
  try {
    console.log('🔄 Running "Notification archive" columns migration...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('notifications');

    const addIfMissing = async (name, definition) => {
      if (desc[name]) {
        console.log(`⏭️  Skipped: notifications.${name} already exists`);
        return;
      }
      await qi.addColumn('notifications', name, definition);
      console.log(`✅ Added: notifications.${name}`);
    };

    await addIfMissing('archived', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    await addIfMissing('archived_at', { type: DataTypes.DATE, allowNull: true });

    console.log('✅ Migration complete.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
};

migrate();
