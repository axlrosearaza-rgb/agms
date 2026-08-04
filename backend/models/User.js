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
  // Contact/display only — no longer the login credential. Staff (Admin/Chairperson/
  // Instructor) log in with `username`; Students log in with `student_no`.
  email: {
    type: DataTypes.STRING(150),
    allowNull: true,
    unique: true,
    validate: { isEmail: true },
  },
  // Login credential for Admin/Chairperson/Instructor. Always stored lowercase so
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
    type: DataTypes.ENUM('Admin', 'Chairperson', 'Instructor', 'Student'),
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
  // Whether a student is on the normal year/section track ('Regular') or has a
  // custom mix of subjects across years ('Irregular'). Students only.
  student_status: {
    type: DataTypes.ENUM('Regular', 'Irregular'),
    allowNull: true,
    defaultValue: 'Regular',
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
  // Faculty fields (Instructor & Chairperson)
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
  // classes) — replaces the singular `program` field for Instructor/Chairperson
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
  status: {
    type: DataTypes.ENUM('Active', 'Inactive', 'Deactivated', 'Pending'),
    defaultValue: 'Active',
  },
  avatar: {
    type: DataTypes.STRING(10),
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
        const salt = await bcrypt.genSalt(12);
        user.password = await bcrypt.hash(user.password, salt);
      }
      if (!user.avatar && user.name) {
        user.avatar = user.name.charAt(0).toUpperCase();
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        const salt = await bcrypt.genSalt(12);
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