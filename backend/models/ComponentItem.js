const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// A single sub-item within a GradeComponent (e.g. "Test 1" inside "Summative Test").
// Item scores are averaged (via their transmuted Rate) to produce the component's score.
const ComponentItem = sequelize.define('ComponentItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  component_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'grade_components', key: 'id' },
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'e.g. Test 1, Quiz 2, Lab 3',
  },
  max_score: {
    type: DataTypes.DECIMAL(7, 2),
    allowNull: false,
    defaultValue: 100,
  },
  // Skips the raw-score-to-Rate transmutation entirely for this one item —
  // a Faculty member who already has a final Rate for a student on this
  // item (no raw score to compute it from) types it in directly instead.
  // The item's own `score` column still holds whatever was typed; this flag
  // just tells every Rate computation (gradeComponentController.itemRate,
  // classRecordExcel.js's itemRate, and the Excel export's own Rate formula)
  // to treat that typed value AS the Rate (clamped 50-95) rather than run it
  // through (score/max_score)*45+50. `max_score` is unused for an item like
  // this — it's left at whatever it was, just ignored by every Rate call.
  is_rate_direct: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  // Whether this item's raw Score column is shown in the read-only Class
  // Record (ClassRecordView.js) and its Excel export — the Rate is still
  // shown either way. Has no effect on the Faculty's own editable grading
  // grid (GradeEncoding.js), which always shows Score so it can be typed
  // in; this only controls what OTHER roles see once grading is done.
  // Meaningless for a direct-rate item (is_rate_direct already has no
  // Score column at all).
  show_score: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  // Same idea as show_score, but for this item's own Rate column — shown
  // by default, hidden in the read-only Class Record/Excel export when
  // false. Unlike show_score, this one IS meaningful for a direct-rate
  // item too (its Rate is its only column; turning this off leaves that
  // item with nothing displayed at all, while its value still folds into
  // the component's Ave/Weighted computation same as always).
  show_rate: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  order_index: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'component_items',
  indexes: [
    { fields: ['component_id'] },
  ],
});

module.exports = ComponentItem;
