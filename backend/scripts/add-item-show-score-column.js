require('dotenv').config();
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Adding component_items.show_score...');
    const qi = sequelize.getQueryInterface();

    const desc = await qi.describeTable('component_items');
    if (!desc.show_score) {
      await sequelize.query(`ALTER TABLE component_items ADD COLUMN show_score BOOLEAN NOT NULL DEFAULT true;`);
      console.log('✅ Added: component_items.show_score');
    } else {
      console.log('⏭️  Skipped: component_items.show_score already exists');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
