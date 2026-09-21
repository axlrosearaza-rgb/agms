require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Lets Faculty's own Dashboard/My Classes put a class the Chairperson bounced
// back in its own "Returned by Chairperson" container with the actual reason
// shown, mirroring what admin_return_reason already does on the Chairperson's
// own Grade Approval page.
const migrate = async () => {
  try {
    console.log('🔄 Running "classes.chairperson_return_reason/chairperson_returned_at" column migration...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('classes');

    if (desc.chairperson_return_reason) {
      console.log('⏭️  Skipped: classes.chairperson_return_reason already exists');
    } else {
      await qi.addColumn('classes', 'chairperson_return_reason', { type: DataTypes.TEXT, allowNull: true });
      console.log('✅ Added: classes.chairperson_return_reason');
    }

    if (desc.chairperson_returned_at) {
      console.log('⏭️  Skipped: classes.chairperson_returned_at already exists');
    } else {
      await qi.addColumn('classes', 'chairperson_returned_at', { type: DataTypes.DATE, allowNull: true });
      console.log('✅ Added: classes.chairperson_returned_at');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
