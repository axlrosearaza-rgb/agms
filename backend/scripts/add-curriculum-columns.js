require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running curriculum-checklist columns migration...');
    const qi = sequelize.getQueryInterface();
    const subjectsDesc = await qi.describeTable('subjects');

    const addIfMissing = async (name, definition) => {
      if (subjectsDesc[name]) {
        console.log(`⏭️  Skipped: subjects.${name} already exists`);
        return;
      }
      await qi.addColumn('subjects', name, definition);
      console.log(`✅ Added: subjects.${name}`);
    };

    await addIfMissing('lecture_hours', { type: DataTypes.INTEGER, allowNull: true });
    await addIfMissing('lecture_units', { type: DataTypes.INTEGER, allowNull: true });
    await addIfMissing('lab_hours', { type: DataTypes.INTEGER, allowNull: true });
    await addIfMissing('lab_units', { type: DataTypes.INTEGER, allowNull: true });

    const tables = await qi.showAllTables();
    if (tables.includes('co_requisites')) {
      console.log('⏭️  Skipped: co_requisites table already exists');
    } else {
      await qi.createTable('co_requisites', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        subject_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'subjects', key: 'id' },
          onDelete: 'CASCADE',
        },
        co_requisite_subject_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'subjects', key: 'id' },
          onDelete: 'CASCADE',
        },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      console.log('✅ Created table: co_requisites');
    }

    console.log('\n🎉 Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
