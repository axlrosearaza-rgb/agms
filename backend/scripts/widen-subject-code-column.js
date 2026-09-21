require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Widening subjects.code from VARCHAR(20) to VARCHAR(60)...');
    const qi = sequelize.getQueryInterface();
    await qi.changeColumn('subjects', 'code', {
      type: DataTypes.STRING(60),
      allowNull: false,
    });
    console.log('✅ Widened: subjects.code -> VARCHAR(60)');
    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
