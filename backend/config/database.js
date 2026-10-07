const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME || 'agms_db',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'password',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: process.env.DB_LOGGING === 'true' ? console.log : false,
    // Sized against Postgres' default max_connections of 100 (this one Node
    // process must leave headroom for migrations/psql/other clients).
    // `acquire` is how long a request waits for a free connection before it
    // fails — kept short so a saturated pool sheds load with a clean error
    // in ~15s instead of stacking up minute-long requests behind it.
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '40', 10),
      min: 5,
      acquire: 15000,
      idle: 10000,
    },
    // A runaway query (an unbounded report, a bad filter) must never be able
    // to hold a pooled connection forever and starve everyone else.
    dialectOptions: {
      statement_timeout: 30000,
      idle_in_transaction_session_timeout: 30000,
      keepAlive: true,
    },
    define: {
      timestamps: true,
      underscored: true,
    },
  }
);

const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ PostgreSQL connection established successfully.');
  } catch (error) {
    console.error('❌ Unable to connect to PostgreSQL:', error.message);
    process.exit(1);
  }
};

module.exports = { sequelize, testConnection };
