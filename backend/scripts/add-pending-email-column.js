require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Self-service "Change Email" flow needs somewhere to hold the requested new
// address between "code sent" and "code confirmed" — the real `email` column
// only gets overwritten once the code is verified, so a still-old-but-
// unconfirmed request never locks someone out of their working address.
const migrate = async () => {
  try {
    console.log('🔄 Running "users.pending_email" column migration...');
    const qi = sequelize.getQueryInterface();
    const usersDesc = await qi.describeTable('users');

    if (usersDesc.pending_email) {
      console.log('⏭️  Skipped: users.pending_email already exists');
    } else {
      await qi.addColumn('users', 'pending_email', { type: DataTypes.STRING, allowNull: true });
      console.log('✅ Added: users.pending_email');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
