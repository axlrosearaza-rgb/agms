require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running "Email verification" columns migration...');
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

    await addIfMissing('email_verified', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
    await addIfMissing('email_verification_code', { type: DataTypes.STRING(255), allowNull: true });
    await addIfMissing('email_verification_expires', { type: DataTypes.DATE, allowNull: true });

    // Backfill: every account that already exists predates this feature —
    // treat them all as verified so nobody already registered gets locked out.
    const [result] = await sequelize.query(`UPDATE users SET email_verified = true WHERE email_verified IS NULL;`);
    console.log(`✅ Backfilled email_verified = true for existing accounts (${result.rowCount ?? 'n/a'} rows)`);

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
