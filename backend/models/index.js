const User = require('./User');
const Subject = require('./Subject');
const Prerequisite = require('./Prerequisite');
const CoRequisite = require('./CoRequisite');
const Class = require('./Class');
const Enrollment = require('./Enrollment');
const Grade = require('./Grade');
const Endorsement = require('./Endorsement');
const ActivityLog = require('./ActivityLog');
const Semester = require('./Semester');
const GradeComponent = require('./GradeComponent');
const ComponentItem = require('./ComponentItem');
const ComponentScore = require('./ComponentScore');
const Notification = require('./Notification');
const Conversation = require('./Conversation');
const ConversationParticipant = require('./ConversationParticipant');
const Message = require('./Message');
const VerificationAssignment = require('./VerificationAssignment');
const PendingRegistration = require('./PendingRegistration');

// ============ ASSOCIATIONS ============

// Subject <-> Prerequisite (self-referencing)
Subject.belongsToMany(Subject, {
  through: Prerequisite,
  as: 'prerequisites',
  foreignKey: 'subject_id',
  otherKey: 'prerequisite_subject_id',
});
Subject.belongsToMany(Subject, {
  through: Prerequisite,
  as: 'dependents',
  foreignKey: 'prerequisite_subject_id',
  otherKey: 'subject_id',
});

// Subject <-> CoRequisite (self-referencing, same shape as Prerequisite)
Subject.belongsToMany(Subject, {
  through: CoRequisite,
  as: 'co_requisites',
  foreignKey: 'subject_id',
  otherKey: 'co_requisite_subject_id',
});
Subject.belongsToMany(Subject, {
  through: CoRequisite,
  as: 'co_requisite_of',
  foreignKey: 'co_requisite_subject_id',
  otherKey: 'subject_id',
});

// Class -> Subject
Class.belongsTo(Subject, { foreignKey: 'subject_id', as: 'subject' });
Subject.hasMany(Class, { foreignKey: 'subject_id', as: 'classes' });

// Class -> Instructor (User)
Class.belongsTo(User, { foreignKey: 'instructor_id', as: 'instructor' });
User.hasMany(Class, { foreignKey: 'instructor_id', as: 'taught_classes' });

// Class <-> Student through Enrollment
Class.belongsToMany(User, {
  through: Enrollment,
  as: 'students',
  foreignKey: 'class_id',
  otherKey: 'student_id',
});
User.belongsToMany(Class, {
  through: Enrollment,
  as: 'enrolled_classes',
  foreignKey: 'student_id',
  otherKey: 'class_id',
});

// Grade -> Class
Grade.belongsTo(Class, { foreignKey: 'class_id', as: 'class' });
Class.hasMany(Grade, { foreignKey: 'class_id', as: 'grades' });

// Grade -> Student (User)
Grade.belongsTo(User, { foreignKey: 'student_id', as: 'student' });
User.hasMany(Grade, { foreignKey: 'student_id', as: 'grades' });

// Endorsement -> Student
Endorsement.belongsTo(User, { foreignKey: 'student_id', as: 'student' });
User.hasMany(Endorsement, { foreignKey: 'student_id', as: 'endorsements' });

// Endorsement -> Chairperson
Endorsement.belongsTo(User, { foreignKey: 'chairperson_id', as: 'chairperson' });

// ActivityLog -> User
ActivityLog.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(ActivityLog, { foreignKey: 'user_id', as: 'activities' });

// Enrollment associations for direct access
Enrollment.belongsTo(Class, { foreignKey: 'class_id', as: 'class' });
Enrollment.belongsTo(User, { foreignKey: 'student_id', as: 'student' });

// GradeComponent -> Class
GradeComponent.belongsTo(Class, { foreignKey: 'class_id', as: 'class' });
Class.hasMany(GradeComponent, { foreignKey: 'class_id', as: 'components' });

// GradeComponent -> ComponentItem
GradeComponent.hasMany(ComponentItem, { foreignKey: 'component_id', as: 'items' });
ComponentItem.belongsTo(GradeComponent, { foreignKey: 'component_id', as: 'component' });

// ComponentScore -> ComponentItem
ComponentScore.belongsTo(ComponentItem, { foreignKey: 'item_id', as: 'item' });
ComponentItem.hasMany(ComponentScore, { foreignKey: 'item_id', as: 'scores' });

// ComponentScore -> Student (User)
ComponentScore.belongsTo(User, { foreignKey: 'student_id', as: 'student' });
User.hasMany(ComponentScore, { foreignKey: 'student_id', as: 'component_scores' });

// Notification -> User
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });

// Conversation <-> User (the two participants)
Conversation.belongsTo(User, { foreignKey: 'user_a_id', as: 'user_a' });
Conversation.belongsTo(User, { foreignKey: 'user_b_id', as: 'user_b' });

// Conversation -> ConversationParticipant -> User
Conversation.hasMany(ConversationParticipant, { foreignKey: 'conversation_id', as: 'participants' });
ConversationParticipant.belongsTo(Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
ConversationParticipant.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Conversation -> Message
Conversation.hasMany(Message, { foreignKey: 'conversation_id', as: 'messages' });
Message.belongsTo(Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
Message.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });

// User <-> VerificationAssignment (self-referencing: a pending Student can have
// several verifiers — Faculty or another already-Active Student — delegated by
// a Chairperson to Approve/Reject on their behalf).
User.belongsToMany(User, {
  through: VerificationAssignment,
  as: 'verifiers',
  foreignKey: 'student_id',
  otherKey: 'verifier_id',
});
User.belongsToMany(User, {
  through: VerificationAssignment,
  as: 'assigned_students',
  foreignKey: 'verifier_id',
  otherKey: 'student_id',
});
VerificationAssignment.belongsTo(User, { foreignKey: 'student_id', as: 'student' });
VerificationAssignment.belongsTo(User, { foreignKey: 'verifier_id', as: 'verifier' });
VerificationAssignment.belongsTo(User, { foreignKey: 'assigned_by', as: 'assigner' });

module.exports = {
  User,
  Subject,
  Prerequisite,
  CoRequisite,
  Class,
  Enrollment,
  Grade,
  Endorsement,
  ActivityLog,
  Semester,
  GradeComponent,
  ComponentItem,
  ComponentScore,
  Notification,
  Conversation,
  ConversationParticipant,
  Message,
  VerificationAssignment,
  PendingRegistration,
};