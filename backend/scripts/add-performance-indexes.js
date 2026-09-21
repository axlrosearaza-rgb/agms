const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { sequelize } = require('../config/database');

const indexes = [
  // Activity logs: critical for admin/chairperson dashboards & logs table
  { name: 'idx_activity_logs_created_at', table: 'activity_logs', sql: 'CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at DESC);' },
  { name: 'idx_activity_logs_user_id_created_at', table: 'activity_logs', sql: 'CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id_created_at ON activity_logs (user_id, created_at DESC);' },

  // Notifications: polled constantly on page loads and role layouts
  { name: 'idx_notifications_user_archived_created', table: 'notifications', sql: 'CREATE INDEX IF NOT EXISTS idx_notifications_user_archived_created ON notifications (user_id, archived, created_at DESC);' },
  { name: 'idx_notifications_user_unread', table: 'notifications', sql: 'CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, is_read) WHERE is_read = false;' },

  // Classes: queried whenever faculty, chairpersons, or students view classes
  { name: 'idx_classes_instructor_status', table: 'classes', sql: 'CREATE INDEX IF NOT EXISTS idx_classes_instructor_status ON classes (instructor_id, status);' },
  { name: 'idx_classes_subject_semester', table: 'classes', sql: 'CREATE INDEX IF NOT EXISTS idx_classes_subject_semester ON classes (subject_id, semester, academic_year);' },
  { name: 'idx_classes_year_section', table: 'classes', sql: 'CREATE INDEX IF NOT EXISTS idx_classes_year_section ON classes (year_level, section);' },

  // Grades: loaded on grading sheets, report cards, evaluation, clearance
  { name: 'idx_grades_student_class', table: 'grades', sql: 'CREATE INDEX IF NOT EXISTS idx_grades_student_class ON grades (student_id, class_id);' },
  { name: 'idx_grades_class_status', table: 'grades', sql: 'CREATE INDEX IF NOT EXISTS idx_grades_class_status ON grades (class_id, status);' },

  // Users: filtered on student lists, faculty lists, program scoping
  { name: 'idx_users_role_status_program', table: 'users', sql: 'CREATE INDEX IF NOT EXISTS idx_users_role_status_program ON users (role, status, program);' },
  { name: 'idx_users_student_no', table: 'users', sql: 'CREATE INDEX IF NOT EXISTS idx_users_student_no ON users (student_no) WHERE student_no IS NOT NULL;' },
  { name: 'idx_users_program_year_section', table: 'users', sql: 'CREATE INDEX IF NOT EXISTS idx_users_program_year_section ON users (program, year_level, section);' },

  // Messages & Chat: real-time message queries
  { name: 'idx_messages_conversation_created', table: 'messages', sql: 'CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages (conversation_id, created_at ASC);' },
  { name: 'idx_conversation_participants_user', table: 'conversation_participants', sql: 'CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants (user_id, conversation_id);' },

  // Grade components & scores
  { name: 'idx_grade_components_class', table: 'grade_components', sql: 'CREATE INDEX IF NOT EXISTS idx_grade_components_class ON grade_components (class_id);' },
  { name: 'idx_component_items_component', table: 'component_items', sql: 'CREATE INDEX IF NOT EXISTS idx_component_items_component ON component_items (component_id);' },
  { name: 'idx_component_scores_item_student', table: 'component_scores', sql: 'CREATE INDEX IF NOT EXISTS idx_component_scores_item_student ON component_scores (item_id, student_id);' },
  { name: 'idx_component_scores_student', table: 'component_scores', sql: 'CREATE INDEX IF NOT EXISTS idx_component_scores_student ON component_scores (student_id);' },
];

const run = async () => {
  try {
    console.log('⚡ Starting performance index creation...');
    await sequelize.authenticate();

    let created = 0;
    let skipped = 0;

    for (const item of indexes) {
      try {
        await sequelize.query(item.sql);
        console.log(`✅ Index applied: ${item.name} on ${item.table}`);
        created++;
      } catch (err) {
        console.warn(`⚠️ Could not create index ${item.name}: ${err.message}`);
        skipped++;
      }
    }

    console.log(`\n🎉 Index optimization finished! Applied: ${created}, Skipped/Errors: ${skipped}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to run index migration:', error);
    process.exit(1);
  }
};

run();
