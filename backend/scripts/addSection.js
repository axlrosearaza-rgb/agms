const { sequelize } = require('../config/database');

async function run() {
  await sequelize.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS section VARCHAR(20);`);
  console.log('✅ section column added to classes table');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });