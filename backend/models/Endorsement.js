const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Endorsement = sequelize.define('Endorsement', {
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
  chairperson_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  status: {
    type: DataTypes.ENUM('Endorsed', 'Flagged', 'Pending'),
    defaultValue: 'Pending',
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  flagged_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  endorsed_date: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  semester: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
}, {
  tableName: 'endorsements',
  indexes: [
    { unique: true, fields: ['student_id', 'chairperson_id', 'semester'] },
  ],
});

module.exports = Endorsement;
