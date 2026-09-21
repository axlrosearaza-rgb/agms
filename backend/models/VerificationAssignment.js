const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// A Chairperson can delegate the Approve/Reject decision on a pending
// student's registration to one or more "verifiers" — Faculty, or another
// already-Active (verified) Student acting as a trusted helper — so the
// Chairperson doesn't have to review every single registration personally.
// One row per (pending student, verifier) pair; a student can have several
// verifiers assigned at once, any one of whom (or the Chairperson, who always
// keeps override power) can make the final call.
const VerificationAssignment = sequelize.define('VerificationAssignment', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  student_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  verifier_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  assigned_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
}, {
  tableName: 'verification_assignments',
  indexes: [
    { unique: true, fields: ['student_id', 'verifier_id'] },
  ],
});

module.exports = VerificationAssignment;
