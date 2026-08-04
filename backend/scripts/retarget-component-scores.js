require('dotenv').config();
const { sequelize } = require('../config/database');

// ComponentScore now scores per-ITEM (component_items.id) instead of per-component.
// The table is empty post-reset, so the safest move is to drop it and let the next
// sequelize.sync() recreate it fresh with the new item_id FK — no data to migrate.
const migrate = async () => {
  try {
    console.log('🔄 Retargeting component_scores to reference component_items...');
    const count = await sequelize.query('SELECT COUNT(*) FROM component_scores', { type: sequelize.QueryTypes.SELECT });
    const rowCount = parseInt(count[0].count, 10);
    if (rowCount > 0) {
      console.log(`⚠️  component_scores has ${rowCount} row(s) — refusing to drop. Clear it manually first if this is intentional.`);
      process.exit(1);
    }
    await sequelize.query('DROP TABLE IF EXISTS component_scores;');
    console.log('✅ Dropped empty component_scores table. It will be recreated on next server start (sequelize.sync()).');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
