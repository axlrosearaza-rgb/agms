require('dotenv').config();
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running username column migration...');
    const qi = sequelize.getQueryInterface();

    const usersDesc = await qi.describeTable('users');

    if (!usersDesc.username) {
      await sequelize.query(`ALTER TABLE users ADD COLUMN username VARCHAR(50) DEFAULT NULL;`);
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username) WHERE username IS NOT NULL;`);
      console.log('✅ Added: users.username');
    } else {
      console.log('⏭️  Skipped: users.username already exists');
    }

    if (usersDesc.email && usersDesc.email.allowNull === false) {
      await sequelize.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL;`);
      console.log('✅ Made users.email nullable');
    } else {
      console.log('⏭️  Skipped: users.email already nullable');
    }

    // Backfill usernames for existing non-Student accounts, derived from their email
    // prefix (e.g. admin@gmail.com -> "admin"), so nobody gets locked out of login.
    const [staffRows] = await sequelize.query(
      `SELECT id, email FROM users WHERE role != 'Student' AND username IS NULL;`
    );

    if (staffRows.length > 0) {
      const [existingRows] = await sequelize.query(`SELECT username FROM users WHERE username IS NOT NULL;`);
      const taken = new Set(existingRows.map((r) => r.username));

      for (const row of staffRows) {
        let base = (row.email || `user${row.id}`).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
        if (!base) base = `user${row.id}`;
        let candidate = base;
        let suffix = 1;
        while (taken.has(candidate)) {
          candidate = `${base}${suffix}`;
          suffix += 1;
        }
        taken.add(candidate);
        await sequelize.query(`UPDATE users SET username = :username WHERE id = :id;`, {
          replacements: { username: candidate, id: row.id },
        });
        console.log(`✅ Backfilled username "${candidate}" for user #${row.id} (${row.email})`);
      }
    } else {
      console.log('⏭️  No staff accounts needed a backfilled username');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
