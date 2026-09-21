require('dotenv').config();
const { sequelize } = require('../config/database');

// Cleans up users.role's enum_users_role type: Sequelize's auto-sync already added
// 'Faculty' as a new label (it can't remove old ones on its own), leaving both
// 'Instructor' and 'Faculty' present side by side. This finishes the job:
//   1. Migrates any row still storing 'Instructor' to 'Faculty' (data-safe, no-op
//      if nothing does).
//   2. Rebuilds the enum type without the stale 'Instructor' label, since Postgres
//      has no direct "DROP VALUE" for enums — swap in a clean replacement type.
const migrate = async () => {
  const t = await sequelize.transaction();
  try {
    const [enumRows] = await sequelize.query(
      `SELECT enumlabel FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'enum_users_role' ORDER BY e.enumsortorder;`,
      { transaction: t }
    );
    const labels = enumRows.map((r) => r.enumlabel);
    console.log('Current enum_users_role values:', labels);

    if (!labels.includes('Instructor')) {
      console.log('⏭️  "Instructor" not present — nothing to clean up.');
      await t.rollback();
      process.exit(0);
    }

    const [, migrateMeta] = await sequelize.query(
      `UPDATE users SET role = 'Faculty' WHERE role = 'Instructor';`,
      { transaction: t }
    );
    console.log(`✅ Migrated ${migrateMeta?.rowCount ?? 0} row(s) from role='Instructor' to role='Faculty'.`);

    // Rebuild the enum without 'Instructor'.
    await sequelize.query(`CREATE TYPE enum_users_role_new AS ENUM ('Admin','Chairperson','Faculty','Student');`, { transaction: t });
    await sequelize.query(`ALTER TABLE users ALTER COLUMN role TYPE enum_users_role_new USING role::text::enum_users_role_new;`, { transaction: t });
    await sequelize.query(`DROP TYPE enum_users_role;`, { transaction: t });
    await sequelize.query(`ALTER TYPE enum_users_role_new RENAME TO enum_users_role;`, { transaction: t });
    console.log('✅ Rebuilt enum_users_role without "Instructor".');

    const [afterEnum] = await sequelize.query(
      `SELECT enumlabel FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'enum_users_role' ORDER BY e.enumsortorder;`,
      { transaction: t }
    );
    console.log('New enum_users_role values:', afterEnum.map((r) => r.enumlabel));

    const [afterUsers] = await sequelize.query(`SELECT id, name, role FROM users;`, { transaction: t });
    console.log('Users after migration:', JSON.stringify(afterUsers));

    await t.commit();
    console.log('\n🎉 Migration complete and committed.');
    process.exit(0);
  } catch (err) {
    await t.rollback();
    console.error('❌ Migration failed, rolled back:', err.message);
    process.exit(1);
  }
};

migrate();
