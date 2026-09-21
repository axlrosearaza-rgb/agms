require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Adding classes.rate_formula...');
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('classes');

    if (desc.rate_formula) {
      console.log('⏭️  Skipped: classes.rate_formula already exists');
    } else {
      await qi.addColumn('classes', 'rate_formula', {
        type: DataTypes.ENUM('50_45', '60_35'),
        allowNull: false,
        defaultValue: '50_45',
      });
      console.log('✅ Added: classes.rate_formula');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
