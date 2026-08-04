require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running "irregular_sections" column migration...');
    const qi = sequelize.getQueryInterface();
    const usersDesc = await qi.describeTable('users');

    if (usersDesc.irregular_sections) {
      console.log('⏭️  Skipped: users.irregular_sections already exists');
    } else {
      await qi.addColumn('users', 'irregular_sections', { type: DataTypes.JSONB, allowNull: true });
      console.log('✅ Added: users.irregular_sections');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
