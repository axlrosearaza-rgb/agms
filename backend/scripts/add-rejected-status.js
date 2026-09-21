require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sequelize } = require('../config/database');

const run = async () => {
  try {
    const [rows] = await sequelize.query(
      "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE typname = 'enum_users_status';"
    );
    console.log('Current enum labels:', rows.map((r) => r.enumlabel));

    const labels = rows.map((r) => r.enumlabel);
    if (!labels.includes('Rejected')) {
      await sequelize.query("ALTER TYPE enum_users_status ADD VALUE 'Rejected';");
      console.log("✅ Added 'Rejected' to enum_users_status");
    } else {
      console.log("ℹ️ 'Rejected' already exists in enum_users_status");
    }
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
};

run();
