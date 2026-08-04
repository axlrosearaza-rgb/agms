const { ActivityLog } = require('../models');

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

module.exports = { logActivity };
