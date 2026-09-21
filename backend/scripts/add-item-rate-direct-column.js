require('dotenv').config();
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Adding component_items.is_rate_direct...');
    const qi = sequelize.getQueryInterface();

    const desc = await qi.describeTable('component_items');
    if (!desc.is_rate_direct) {
      await sequelize.query(`ALTER TABLE component_items ADD COLUMN is_rate_direct BOOLEAN NOT NULL DEFAULT false;`);
      console.log('✅ Added: component_items.is_rate_direct');
    } else {
      console.log('⏭️  Skipped: component_items.is_rate_direct already exists');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
