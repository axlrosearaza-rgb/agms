const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: { notEmpty: true },
  },
  // Not a login credential — Staff (Admin/Chairperson/Faculty) log in with
  // `username`; Students log in with `student_no`. Used for password-recovery
  // links and account-status notifications (e.g. registration approved).
  // Required + must be a Gmail address for self-registered Students (enforced
  // in authController.register, not here, since Admin-created staff accounts
  // may not always have one).
  email: {
    type: DataTypes.STRING(150),
    allowNull: true,
    unique: true,
    validate: { isEmail: true },
  },
  // Login credential for Admin/Chairperson/Faculty. Always stored lowercase so
  // lookups/uniqueness are case-insensitive regardless of which controller writes it.
  username: {
    type: DataTypes.STRING(50),
    allowNull: true,
    unique: true,
    validate: { len: [3, 50] },
    set(value) {
      this.setDataValue('username', value ? value.toLowerCase() : value);
    },
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM('Admin', 'Chairperson', 'Faculty', 'Student'),
    allowNull: false,
  },
  department: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  // Student fields
  student_no: {
    type: DataTypes.STRING(20),
    allowNull: true,
    unique: true,
  },
  program: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  year_level: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: { min: 1, max: 6 },
  },
  section: {
    type: DataTypes.STRING(10),
    allowNull: true,
  },
  // Regular vs Irregular — the only enrollment classification with any
  // functional effect elsewhere in the app: it decides whether a student is
  // on the normal year/section track or has a custom mix of subjects across
  // years (see irregular_sections below). Self-declared at registration
  // (RegisterPage) like student_type below; promotionController also flips
  // this automatically when evaluation finds a student needs a custom mix.
  // Students only.
  student_status: {
    type: DataTypes.ENUM('New', 'Shifter', 'Transferee', 'Old', 'Quitter', 'Regular', 'Irregular'),
    allowNull: true,
    defaultValue: 'Regular',
  },
  // "Student Type" in the UI — New/Shifter/Transferee/Old Student/Quitter.
  // Purely descriptive (nothing branches on it) and deliberately separate
  // from student_status above: this is self-declared once at registration
  // and never touched again (not even by Admin — see UserManagement.js,
  // which shows it read-only past creation), while student_status is a live
  // administrative/functional flag. Students only.
  student_type: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  // The exact Semester.name string (e.g. "First Semester 2026-2027") this
  // student was last cleared/promoted for by promotionController.promoteStudents.
  // 1st-semester clearing doesn't change year_level (and even a 2nd-semester
  // year bump leaves grades/curriculum pointed at the old semester), so
  // without this a promoted student would keep evaluating as freshly
  // "Eligible" forever — evaluateStudents checks this to show "Already
  // Promoted" instead and Promotion Management hides them from Review.
  // Students only.
  last_promoted_semester: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  // Irregular students only: every Year+Section pair they're actually taking
  // classes under (e.g. retaking a Year 2 subject while also enrolled in Year 3
  // classes) — [{ year_level: 2, section: 'A' }, ...]. `year_level`/`section`
  // above stay set to the first pair so existing grouping/scoping code (which
  // reads those singular fields) keeps working unchanged.
  irregular_sections: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  // Irregular students only: the specific Subject IDs a Chairperson has
  // flagged as "clear these and you're Regular again" — [1, 4, 7, ...].
  // Checked automatically every time one of this student's grades is
  // submitted (gradeController.submitGrades) — once every subject in this
  // list has a Passed grade, student_status flips back to 'Regular' and
  // this list is cleared on its own; nobody has to remember to do it by
  // hand. Not the same thing as irregular_sections above (which just
  // records their current mixed year+section enrollment) — this is the
  // Chairperson's own explicit "here's their path back to Regular" list.
  regularization_subjects: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  // Set the moment a student's regularization_subjects list is first saved —
  // from then on userController.setRegularizationSubjects refuses further
  // changes ("once selected and saved, it cannot be undone"), so the list a
  // Chairperson/Admin sees stays exactly what the student committed to.
  // Cleared automatically alongside regularization_subjects whenever
  // gradeController.checkAndRegularizeStudent flips the student back to
  // Regular, so a future Irregular spell starts with a fresh, unlocked pick.
  regularization_locked_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Employment-related fields (Faculty & Chairperson)
  employee_no: {
    type: DataTypes.STRING(30),
    allowNull: true,
    unique: true,
  },
  academic_rank: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  specialization: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  highest_education: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  // Multi-program tags for faculty (e.g. an IT instructor who also teaches IS
  // classes) — replaces the singular `program` field for Faculty/Chairperson
  // accounts. Students keep using the singular `program` field, unchanged.
  programs: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    allowNull: true,
  },
  // Faculty employment classification ("Part Timer" in the spec).
  employment_type: {
    type: DataTypes.ENUM('Full Time', 'Part Time'),
    allowNull: true,
    defaultValue: 'Full Time',
  },
  // Cosmetic label for Chairperson-role accounts — a "Dean" is a Chairperson
  // account with this label set; permissions are identical either way.
  position: {
    type: DataTypes.ENUM('Chairperson', 'Dean'),
    allowNull: true,
  },
  // Only one Chairperson account should be flagged true at a time in practice —
  // Admin sets this manually. Gates who may create/edit/set-current a Semester.
  can_manage_semester: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  // Chairperson-only: some department chairs also teach. When true, this single
  // account additionally gets Faculty-side capabilities (create/manage their
  // own classes, encode grades) on top of their normal Chairperson permissions —
  // no separate Faculty account needed. Meaningless for other roles.
  is_teaching: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  // Online/offline presence — whether this account is currently online lives
  // in memory only (utils/presence.js, tied to actual live Socket.IO
  // connections, never persisted since it'd go stale the moment the server
  // restarts). This column is just the one thing that DOES need to survive a
  // restart/disconnect: the timestamp of their most recent connection, so
  // "Offline · 3h ago" can still be shown after they've left. Updated on
  // every disconnect (utils/presence.js) and once at login as a same-day
  // fallback for an account that's never actually opened a live connection yet.
  last_seen_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('Active', 'Inactive', 'Deactivated', 'Pending', 'Rejected'),
    defaultValue: 'Active',
  },
  avatar: {
    type: DataTypes.STRING(10),
    allowNull: true,
  },
  // Data Privacy Act (RA 10173) consent — recorded the moment a user accepts the
  // first-login Privacy Notice modal. `privacy_policy_version` pins WHICH version
  // they agreed to, so bumping PRIVACY_POLICY_VERSION (backend/config/privacy.js)
  // automatically re-prompts everyone without needing a data migration.
  privacy_accepted: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  privacy_accepted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  privacy_policy_version: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  // Forgot-password flow — a SHA-256 hash of the one-time reset token is stored
  // here (never the raw token, so a leaked database still can't be used to reset
  // anyone's password), plus its expiry. Both cleared once used or expired.
  reset_password_token: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  reset_password_expires: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Self-registration email verification — confirms the student actually owns
  // and can reach the address before it's trusted for account recovery /
  // approval notifications. Defaults true so every existing account and every
  // account created directly by Admin/Chairperson (who never go through this
  // flow) are unaffected; register() explicitly sets it false for new
  // self-signups until the code is confirmed. Code is stored as a SHA-256 hash,
  // same pattern as reset_password_token — never the raw code.
  email_verified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  email_verification_code: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  email_verification_expires: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Self-service "Change Email" (Settings page): holds the requested new
  // address between "code sent" and "code confirmed" — `email` itself only
  // gets overwritten once the code checks out, reusing the same
  // email_verification_code/_expires fields above rather than a second pair.
  pending_email: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  tableName: 'users',
  validate: {
    hasLoginCredential() {
      if (this.role === 'Student') {
        if (!this.student_no) throw new Error('Students must have a Student ID Number to log in.');
      } else if (!this.username) {
        throw new Error(`${this.role} accounts must have a username to log in.`);
      }
    },
  },
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
      if (!user.avatar && user.name) {
        user.avatar = user.name.charAt(0).toUpperCase();
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
    },
  },
});

User.prototype.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

User.prototype.toSafeJSON = function () {
  const values = { ...this.get() };
  delete values.password;
  return values;
};

module.exports = User;