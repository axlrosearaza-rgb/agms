const { ActivityLog } = require('../models');
const { Op } = require('sequelize');

const logActivity = async (userId, action, entityType = null, entityId = null, details = null) => {
  try {
    await ActivityLog.create({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    });
  } catch (error) {
    console.error('Failed to log activity:', error.message);
  }
};

// Recent Activity normally ages out after 7 days, but promotion/
// regularization entries — Evaluate & Promote's own "cleared N students for
// 2nd semester"/"promoted N students to next year level", plus auto-
// regularization's "X automatically regularized" — are bulk, routine, and
// stale fast next to something like a grade approval or a semester change,
// so they get a much shorter 24h window instead. Matched by the exact
// wording promotionController.js/gradeController.js's own logActivity calls
// use. Shared here (not duplicated per controller) so every "Recent
// Activity"-shaped feed in the app — the Admin Dashboard's own widget, the
// Promotions Going card's own history list, whatever comes next — always
// agrees on what counts as archived for the exact same log row.
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const PROMOTION_ACTION_PATTERNS = [
  '%cleared % for 2nd semester%',
  '%promoted % to next year level%',
  '%auto-marked % Irregular%',
  '%marked % as Irregular%',
  '%automatically regularized%',
];
const isPromotionAction = { [Op.or]: PROMOTION_ACTION_PATTERNS.map((p) => ({ [Op.iLike]: p })) };
const isNotPromotionAction = { [Op.and]: PROMOTION_ACTION_PATTERNS.map((p) => ({ [Op.notILike]: p })) };

// `recent: true` for "still within its own type's window" (Recent
// Activity), `recent: false` for "aged past it" (Archived Activities).
const activityRetentionWhere = (recent) => {
  const now = Date.now();
  const op = recent ? Op.gte : Op.lt;
  return {
    [Op.or]: [
      { action: isPromotionAction, created_at: { [op]: new Date(now - ONE_DAY_MS) } },
      { action: isNotPromotionAction, created_at: { [op]: new Date(now - SEVEN_DAYS_MS) } },
    ],
  };
};

// Just the promotion-type rows still within their own 24h window — for
// feeds that ONLY ever show promotion activity to begin with (Promotion
// Management's own history), as opposed to activityRetentionWhere above,
// which also has to decide what to do with every OTHER activity type mixed
// into a general-purpose feed (the Admin Dashboard's own Recent Activity).
const promotionActivityRecentWhere = () => ({
  action: isPromotionAction,
  created_at: { [Op.gte]: new Date(Date.now() - ONE_DAY_MS) },
});

// Chairperson's own Activity Log card — a flat 24h window for EVERY action
// type (no promotion-vs-everything-else split like activityRetentionWhere
// above), since the department-scoped feed is small enough that a uniform
// same-day cutoff is what actually keeps it useful, per the Chairperson's
// own request. Admin's dashboard/archive views are untouched by this — they
// keep using activityRetentionWhere above.
const chairpersonActivityRetentionWhere = (recent) => ({
  created_at: { [recent ? Op.gte : Op.lt]: new Date(Date.now() - ONE_DAY_MS) },
});

module.exports = { logActivity, activityRetentionWhere, promotionActivityRecentWhere, chairpersonActivityRetentionWhere };
