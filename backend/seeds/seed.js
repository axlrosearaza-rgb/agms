const { sequelize } = require('../config/database');
const { User, Subject, Prerequisite, Class, Enrollment, Grade, Endorsement, ActivityLog, Semester } = require('../models');
require('dotenv').config();

const seed = async () => {
  try {
    console.log('🌱 Starting clean database setup...');

    await sequelize.sync({ force: true });
    console.log('✅ Tables created.');

    // ============ DEFAULT ADMIN ACCOUNT ============
    await User.create({
      name: 'System Administrator',
      email: 'admin@ssu.edu.ph',
      password: 'admin123',
      role: 'Admin',
      department: null,
      avatar: 'S',
    });
    console.log('✅ Admin account created.');

    // ============ DEFAULT CURRENT SEMESTER ============
    await Semester.create({
      name: 'Second Semester 2024-2025',
      academic_year: '2024-2025',
      term: 'Second Semester',
      start_date: '2025-01-06',
      end_date: '2025-05-30',
      is_current: true,
      status: 'Active',
    });
    console.log('✅ Current semester created.');

    console.log('\n🎉 Clean database setup completed!');
    console.log('\n📋 Admin Login:');
    console.log('  Email:    admin@ssu.edu.ph');
    console.log('  Password: admin123');
    console.log('\n📌 Use the Admin panel to create Chairpersons, Instructors, Students, Subjects, and Classes.');
    console.log('📊 Grading: GWA Scale 1.0-5.0 (3.0 = passing)');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
};

seed();