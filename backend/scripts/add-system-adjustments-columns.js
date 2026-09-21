require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running "System Adjustments" columns migration...');
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

    await addIfMissing('student_status', { type: DataTypes.ENUM('Regular', 'Irregular'), allowNull: true, defaultValue: 'Regular' });
    await addIfMissing('programs', { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: true });
    await addIfMissing('employment_type', { type: DataTypes.ENUM('Full Time', 'Part Time'), allowNull: true, defaultValue: 'Full Time' });
    await addIfMissing('position', { type: DataTypes.ENUM('Chairperson', 'Dean'), allowNull: true });
    await addIfMissing('can_manage_semester', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

    // Backfill: every existing Student gets student_status = 'Regular' explicitly
    // (defaultValue only applies to *new* rows, not the ones already in the table).
    const [studentUpdate] = await sequelize.query(
      `UPDATE users SET student_status = 'Regular' WHERE role = 'Student' AND student_status IS NULL;`
    );
    console.log(`✅ Backfilled student_status = 'Regular' for existing students (${studentUpdate.rowCount ?? 'n/a'} rows)`);

    // Backfill: existing Faculty/Chairperson keep their current singular `program`
    // value by copying it into the new `programs` array, so nobody loses their tag.
    // (Historical note: this ran when the role value was still 'Instructor', before
    // the later rename to 'Faculty' — updated here so a re-run stays valid.)
    const [facultyRows] = await sequelize.query(
      `SELECT id, program FROM users WHERE role IN ('Faculty','Chairperson') AND program IS NOT NULL AND programs IS NULL;`
    );
    for (const row of facultyRows) {
      await sequelize.query(`UPDATE users SET programs = ARRAY[:program] WHERE id = :id;`, {
        replacements: { program: row.program, id: row.id },
      });
      console.log(`✅ Backfilled programs = ["${row.program}"] for user #${row.id}`);
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
