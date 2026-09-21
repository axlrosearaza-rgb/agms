require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Splits the single chairperson_verified flag into two independent flags
// (class_record_verified, grade_sheet_verified) so Admin can verify/send
// back each document separately from Grade Approval's preview, instead of
// one action always covering both. chairperson_verified stays as the
// combined gate everything else (release, promotion) already depends on —
// it's just derived as (class_record_verified && grade_sheet_verified) from
// here on, rather than being its own independent source of truth.
const migrate = async () => {
  try {
    console.log('🔄 Running "classes" split-verification columns migration...');
    const qi = sequelize.getQueryInterface();
    const classesDesc = await qi.describeTable('classes');

    const addIfMissing = async (name, definition) => {
      if (classesDesc[name]) {
        console.log(`⏭️  Skipped: classes.${name} already exists`);
        return;
      }
      await qi.addColumn('classes', name, definition);
      console.log(`✅ Added: classes.${name}`);
    };

    await addIfMissing('class_record_verified', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    await addIfMissing('class_record_verified_at', { type: DataTypes.DATE, allowNull: true });
    await addIfMissing('grade_sheet_verified', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    await addIfMissing('grade_sheet_verified_at', { type: DataTypes.DATE, allowNull: true });

    // Backfill: any class already chairperson_verified=true was verified as
    // one combined action before this split existed — carry that forward as
    // both halves being verified, rather than resetting everyone back to
    // "not verified" for either document.
    const [result] = await sequelize.query(`
      UPDATE classes
      SET class_record_verified = true, class_record_verified_at = chairperson_verified_at,
          grade_sheet_verified = true, grade_sheet_verified_at = chairperson_verified_at
      WHERE chairperson_verified = true
        AND (class_record_verified = false OR grade_sheet_verified = false);
    `);
    console.log(`✅ Backfilled split verification flags for already-verified classes (${result.rowCount ?? 'n/a'} rows)`);

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
