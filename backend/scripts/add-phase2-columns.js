require('dotenv').config();
const { sequelize } = require('../config/database');

const migrate = async () => {
  try {
    console.log('🔄 Running Phase 2 columns migration...');
    const qi = sequelize.getQueryInterface();

    // subjects.program
    const subjectsDesc = await qi.describeTable('subjects');
    if (!subjectsDesc.program) {
      await sequelize.query(`ALTER TABLE subjects ADD COLUMN program VARCHAR(150) DEFAULT NULL;`);
      console.log('✅ Added: subjects.program');
    } else {
      console.log('⏭️  Skipped: subjects.program already exists');
    }

    // grades.released / released_date
    const gradesDesc = await qi.describeTable('grades');
    if (!gradesDesc.released) {
      await sequelize.query(`ALTER TABLE grades ADD COLUMN released BOOLEAN NOT NULL DEFAULT false;`);
      console.log('✅ Added: grades.released');
    } else {
      console.log('⏭️  Skipped: grades.released already exists');
    }
    if (!gradesDesc.released_date) {
      await sequelize.query(`ALTER TABLE grades ADD COLUMN released_date TIMESTAMP DEFAULT NULL;`);
      console.log('✅ Added: grades.released_date');
    } else {
      console.log('⏭️  Skipped: grades.released_date already exists');
    }

    // endorsements.semester + unique index swap
    const endorsementsDesc = await qi.describeTable('endorsements');
    if (!endorsementsDesc.semester) {
      await sequelize.query(`ALTER TABLE endorsements ADD COLUMN semester VARCHAR(50) DEFAULT NULL;`);
      console.log('✅ Added: endorsements.semester');
    } else {
      console.log('⏭️  Skipped: endorsements.semester already exists');
    }

    const indexes = await qi.showIndex('endorsements');
    const oldUnique = indexes.find((i) => i.unique && i.fields.length === 2
      && i.fields.some((f) => f.attribute === 'student_id')
      && i.fields.some((f) => f.attribute === 'chairperson_id'));
    const newUniqueExists = indexes.some((i) => i.unique && i.fields.length === 3
      && i.fields.some((f) => f.attribute === 'semester'));

    if (oldUnique && !newUniqueExists) {
      await sequelize.query(`DROP INDEX IF EXISTS "${oldUnique.name}";`);
      console.log(`✅ Dropped old unique index: ${oldUnique.name}`);
      await qi.addIndex('endorsements', ['student_id', 'chairperson_id', 'semester'], { unique: true, name: 'endorsements_student_chairperson_semester_unique' });
      console.log('✅ Added new unique index: endorsements_student_chairperson_semester_unique');
    } else if (newUniqueExists) {
      console.log('⏭️  Skipped: endorsements semester unique index already exists');
    } else {
      console.log('⚠️  Old unique index on (student_id, chairperson_id) not found — check manually.');
    }

    console.log('\n🎉 Phase 2 migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();
