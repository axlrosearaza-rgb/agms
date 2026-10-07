// Idempotent indexes for the hot, per-user read paths. Runs at every server
// start (CREATE INDEX IF NOT EXISTS is a no-op once they exist) because
// sequelize.sync() only creates indexes when it creates a table — it never
// adds one to a table that already exists, so an index added to a model later
// would otherwise never reach a real database. Failure to create one is
// logged, never fatal.
const { sequelize } = require('../config/database');

const STATEMENTS = [
  // Columns added to an existing table after it was first created —
  // sequelize.sync() never adds those either, so they're added here the same
  // idempotent way (per-period INC: see the Grade model).
  'ALTER TABLE grades ADD COLUMN IF NOT EXISTS inc_midterm BOOLEAN NOT NULL DEFAULT false',
  'ALTER TABLE grades ADD COLUMN IF NOT EXISTS inc_finals BOOLEAN NOT NULL DEFAULT false',
  // INC not completed by its deadline → 5.0 (see utils/incLapse.js).
  'ALTER TABLE grades ADD COLUMN IF NOT EXISTS inc_lapsed_at TIMESTAMPTZ',
  // Which period(s) the lapsed INC was in: 'Midterm', 'Finals' or 'Both'.
  'ALTER TABLE grades ADD COLUMN IF NOT EXISTS inc_lapsed_period VARCHAR(10)',
  // Semester-ending warning already sent for this end date (utils/semesterEndWarning.js).
  'ALTER TABLE semesters ADD COLUMN IF NOT EXISTS end_warning_for DATE',
  // Grade-submission reminder (30 days before the end) already sent for this end date.
  'ALTER TABLE semesters ADD COLUMN IF NOT EXISTS grade_warning_for DATE',
  // Per-semester "Academic Year" vs "School Year" label (see Semester model).
  "ALTER TABLE semesters ADD COLUMN IF NOT EXISTS year_label VARCHAR(20) NOT NULL DEFAULT 'Academic Year'",
  // Graduated-student archive (see User model).
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS graduated_semester VARCHAR(100)',
  // Subject curriculum year (see Subject model).
  'ALTER TABLE subjects ADD COLUMN IF NOT EXISTS curriculum_year VARCHAR(20)',
  // Faculty advisory section (see User model).
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS advisory_program VARCHAR(150)',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS advisory_year_level INTEGER',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS advisory_section VARCHAR(10)',
  // Multiple advisory sections per faculty — replaces the single
  // advisory_program/_year_level/_section above. One-time carry-over of an
  // existing single advisory into the list, then the old columns are cleared.
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS advisories JSONB',
  `UPDATE users SET advisories = jsonb_build_array(jsonb_build_object('program', advisory_program, 'year_level', advisory_year_level, 'section', advisory_section))
     WHERE advisories IS NULL AND advisory_program IS NOT NULL`,
  'UPDATE users SET advisory_program = NULL, advisory_year_level = NULL, advisory_section = NULL WHERE advisories IS NOT NULL AND advisory_program IS NOT NULL',
  // Per-section history (class list imports, promotions, adviser changes) —
  // kept with the Program / Year / Section itself, so whoever advises the
  // section next sees everything done to it before (utils/sectionActivity.js).
  `CREATE TABLE IF NOT EXISTS section_activities (
     id SERIAL PRIMARY KEY,
     program VARCHAR(150) NOT NULL,
     year_level INTEGER NOT NULL,
     section VARCHAR(10) NOT NULL,
     user_id INTEGER,
     user_name VARCHAR(255),
     action TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_section_activities_section ON section_activities (program, year_level, section, created_at DESC)',
  // Subject Major / Minor (see Subject model). Added once with the minors
  // pre-filled from their codes: GE, GEE, PE, NSE, OE and CE E1. Editable
  // afterwards on the Subjects page — the pre-fill only runs when the column
  // is first created.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subjects' AND column_name = 'subject_type') THEN
       ALTER TABLE subjects ADD COLUMN subject_type VARCHAR(10) NOT NULL DEFAULT 'Major';
       UPDATE subjects SET subject_type = 'Minor'
        WHERE code ~* '^(GE|GEE|PE|NSE|OE|NSTP)([^A-Za-z]|$)' OR code ~* '^CE E';
     END IF;
   END $$`,
  // Staff idle screen-lock preference (see User model).
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS idle_lock_minutes INTEGER',
  // Student first-login setup + per-semester status declaration (see User model).
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS account_setup_at TIMESTAMPTZ',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS status_declared_semester VARCHAR(100)',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS status_declared_at TIMESTAMPTZ',
  // Who created the account (class-list import) — users.created_by.
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER',
  // The student's own Regular / Irregular answer this semester.
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS declared_status VARCHAR(20)",
  // Nothing is deleted from the system — accounts and subjects are archived.
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ',
  'ALTER TABLE subjects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ',
  // "Is this your class?" — a class outside the student's own Year + Section.
  'ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS needs_confirmation BOOLEAN NOT NULL DEFAULT false',
  'ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ',
  'ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ',
  // Students who answered "No, not mine" — the instructor's dashboard warning.
  `CREATE TABLE IF NOT EXISTS class_disputes (
    id SERIAL PRIMARY KEY,
    class_id INTEGER,
    instructor_id INTEGER,
    student_id INTEGER,
    student_name VARCHAR(200),
    student_no VARCHAR(50),
    class_label VARCHAR(120),
    removed BOOLEAN NOT NULL DEFAULT false,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  'CREATE INDEX IF NOT EXISTS idx_class_disputes_instructor ON class_disputes (instructor_id, dismissed_at)',
  // My Advisory's Semester overview, kept per section when a semester ends
  // (utils/advisoryOverview.js) — one row per semester + section.
  `CREATE TABLE IF NOT EXISTS advisory_overviews (
    id SERIAL PRIMARY KEY,
    semester VARCHAR(100) NOT NULL,
    program VARCHAR(150) NOT NULL,
    year_level INTEGER NOT NULL,
    section VARCHAR(10) NOT NULL,
    adviser_id INTEGER,
    adviser_name VARCHAR(255),
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (semester, program, year_level, section)
  )`,
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS declared_subjects JSONB',
  // Student Add/Drop window (see Semester model).
  'ALTER TABLE semesters ADD COLUMN IF NOT EXISTS add_drop_start DATE',
  'ALTER TABLE semesters ADD COLUMN IF NOT EXISTS add_drop_end DATE',
  // Conversation lookups match on EITHER participant column; the unique index
  // only helps when user_a_id is the one being matched.
  'CREATE INDEX IF NOT EXISTS idx_conversations_user_b ON conversations (user_b_id)',
  // The unread badge/list counts only unread rows — a partial index keeps that
  // tiny and fast no matter how large the read message history grows.
  'CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages (conversation_id, sender_id) WHERE is_read = false',
  // Sidebar "Assigned Work" count filters by verifier.
  'CREATE INDEX IF NOT EXISTS idx_verification_assignments_verifier ON verification_assignments (verifier_id)',
  // "How many submitted grades in this class" (approval queues, dashboards).
  'CREATE INDEX IF NOT EXISTS idx_grades_class_submitted ON grades (class_id, submitted)',
  // Approval queue badges filter classes by pipeline state.
  'CREATE INDEX IF NOT EXISTS idx_classes_chairperson_verified ON classes (chairperson_verified)',
];

async function ensureIndexes() {
  for (const sql of STATEMENTS) {
    try {
      await sequelize.query(sql);
    } catch (err) {
      console.warn(`[indexes] skipped (${err.message}): ${sql}`);
    }
  }
}

module.exports = { ensureIndexes };
