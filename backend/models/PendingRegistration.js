const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Holds a self-registration attempt while its email is unconfirmed — the real
// `users` row is only created once the 6-digit code is verified (see
// authController.verifyEmail). This is what makes an abandoned registration
// (code never entered) harmless: nothing in `users` ever claimed the email or
// student number, so resubmitting the form just overwrites this row with a
// fresh code instead of hitting a stale "account already exists" error.
const PendingRegistration = sequelize.define('PendingRegistration', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  // Pre-hashed with bcrypt at submission time (same cost factor User's own
  // beforeCreate hook uses) — never stored in plaintext, and passed straight
  // through (with hooks disabled) into User.create() once verified, so it's
  // hashed exactly once.
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  student_no: {
    type: DataTypes.STRING(20),
    allowNull: false,
  },
  program: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  year_level: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  section: {
    type: DataTypes.STRING(10),
    allowNull: true,
  },
  student_status: {
    type: DataTypes.ENUM('Regular', 'Irregular'),
    allowNull: false,
    defaultValue: 'Regular',
  },
  // "Student Type" — New/Shifter/Transferee/Old Student/Quitter, self-picked
  // alongside Regular/Irregular above but kept as its own field (same split
  // as User.student_type/student_status once this becomes a real account).
  student_type: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  irregular_sections: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  // Same SHA-256-hash-only pattern as User.email_verification_code.
  verification_code: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  verification_expires: {
    type: DataTypes.DATE,
    allowNull: false,
  },
}, {
  tableName: 'pending_registrations',
  indexes: [
    { unique: true, fields: ['email'] },
    { unique: true, fields: ['student_no'] },
  ],
});

module.exports = PendingRegistration;
