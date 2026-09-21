require('dotenv').config();
const { DataTypes, Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Class, Grade } = require('../models');

// Lets Faculty's own "Send to Chairperson" button stay disabled once already
// sent, only re-enabling once the Chairperson bounces it back for revision.
const migrate = async () => {
  try {
    console.log('🔄 Running "classes.sent_to_chairperson" column migration...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('classes');

    if (desc.sent_to_chairperson) {
      console.log('⏭️  Skipped: classes.sent_to_chairperson already exists');
    } else {
      await qi.addColumn('classes', 'sent_to_chairperson', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
      console.log('✅ Added: classes.sent_to_chairperson');

      // Backfill: any class that already has submitted grades has, in
      // effect, already been sent (this column just didn't exist yet to
      // record that) — without this, Faculty's button would look clickable
      // for classes already sitting with the Chairperson/Admin.
      const submittedClassIds = await Grade.findAll({
        where: { submitted: true },
        attributes: ['class_id'],
        group: ['class_id'],
        raw: true,
      });
      const ids = submittedClassIds.map((r) => r.class_id);
      if (ids.length > 0) {
        const [count] = await Class.update(
          { sent_to_chairperson: true },
          { where: { id: { [Op.in]: ids }, awaiting_faculty_revision: false } }
        );
        console.log(`✅ Backfilled sent_to_chairperson for ${count} class(es) with existing submitted grades.`);
      }
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
