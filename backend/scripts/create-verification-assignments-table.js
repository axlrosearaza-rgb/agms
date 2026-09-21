require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running verification_assignments table migration...');
    const qi = sequelize.getQueryInterface();

    const tables = await qi.showAllTables();
    if (tables.includes('verification_assignments')) {
      console.log('⏭️  Skipped: verification_assignments table already exists');
    } else {
      await qi.createTable('verification_assignments', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        student_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
        },
        verifier_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
        },
        assigned_by: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
        },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await qi.addIndex('verification_assignments', ['student_id', 'verifier_id'], { unique: true, name: 'verification_assignments_student_verifier_unique' });
      console.log('✅ Created table: verification_assignments');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
