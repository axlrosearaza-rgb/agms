const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Mirrors Prerequisite.js exactly, but for co-requisites (subjects that must be
// taken *alongside* each other, e.g. a lecture + its lab), matching the
// "Co-Requisite" column in the official curriculum checklist.
const CoRequisite = sequelize.define('CoRequisite', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  subject_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'subjects', key: 'id' },
  },
  co_requisite_subject_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'subjects', key: 'id' },
  },
}, {
  tableName: 'co_requisites',
});

module.exports = CoRequisite;
