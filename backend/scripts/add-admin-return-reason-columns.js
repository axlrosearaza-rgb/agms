require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Lets the Chairperson's Grade Approval page put "Admin sent this back"
// classes in their own container with the actual reason shown, instead of
// blending back into the generic "not yet verified" pile.
const COLUMNS = [
  ['admin_return_reason', { type: DataTypes.TEXT, allowNull: true }],
  ['admin_returned_at', { type: DataTypes.DATE, allowNull: true }],
];

const migrate = async () => {
  try {
    console.log('🔄 Running "classes.admin_return_reason" columns migration...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('classes');

    for (const [name, def] of COLUMNS) {
      if (desc[name]) {
        console.log(`⏭️  Skipped: classes.${name} already exists`);
      } else {
        await qi.addColumn('classes', name, def);
        console.log(`✅ Added: classes.${name}`);
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
