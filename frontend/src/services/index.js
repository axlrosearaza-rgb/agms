import api from './api';

// ============ AUTH SERVICE ============
export const authService = {
  login: (identifier, password) => api.post('/auth/login', { identifier, password }),
  register: (data) => api.post('/auth/register', data),
  verifyEmail: (student_no, code) => api.post('/auth/verify-email', { student_no, code }),
  resendVerificationCode: (student_no) => api.post('/auth/resend-verification-code', { student_no }),
  getMe: () => api.get('/auth/me'),
  changeUsername: (data) => api.put('/auth/username', data),
  requestEmailChange: (data) => api.put('/auth/email/request', data),
  confirmEmailChange: (data) => api.put('/auth/email/confirm', data),
  verifyPassword: (password) => api.post('/auth/verify-password', { password }),
  changePassword: (data) => api.put('/auth/password', data),
  acceptPrivacyPolicy: () => api.post('/auth/accept-privacy'),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (data) => api.post('/auth/reset-password', data),
};

// ============ USER SERVICE ============
export const userService = {
  getAll: (params) => api.get('/users', { params }),
  getById: (id) => api.get(`/users/${id}`),
  getPending: () => api.get('/users/pending'),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  setRegularizationSubjects: (id, subjectIds) => api.put(`/users/${id}/regularization-subjects`, { subject_ids: subjectIds }),
  getPresence: (ids) => api.get('/users/presence', { params: { ids: ids.join(',') } }),
};

// ============ SUBJECT SERVICE ============
export const subjectService = {
  getAll: (params) => api.get('/subjects', { params }),
  getById: (id) => api.get(`/subjects/${id}`),
  create: (data) => api.post('/subjects', data),
  update: (id, data) => api.put(`/subjects/${id}`, data),
  delete: (id) => api.delete(`/subjects/${id}`),
};

// ============ CLASS SERVICE ============
export const classService = {
  getAll: (params) => api.get('/classes', { params }),
  getById: (id) => api.get(`/classes/${id}`),
  getInstructorClasses: (instructorId, params) => api.get(`/classes/instructor/${instructorId}`, { params }),
  create: (data) => api.post('/classes', data),
  update: (id, data) => api.put(`/classes/${id}`, data),
  archive: (id, archived) => api.put(`/classes/${id}/archive`, { archived }),
  delete: (id) => api.delete(`/classes/${id}`),
  enroll: (id, studentIds) => api.post(`/classes/${id}/enroll`, { student_ids: studentIds }),
  getEligibleStudents: (id) => api.get(`/classes/${id}/eligible-students`),
  getPendingApprovalCount: () => api.get('/classes/pending-approval-count'),
};

// ============ GRADE SERVICE ============
export const gradeService = {
  getByClass: (classId) => api.get(`/grades/class/${classId}`),
  getGradesByClass: (classId) => api.get(`/grades/class/${classId}`),
  getStudentGrades: (studentId, params = {}) => api.get(`/grades/student/${studentId}`, { params }),
  getStudentProspectus: (studentId) => api.get(`/grades/student/${studentId}/prospectus`),
  encodeGrades: (payload) => api.post('/grades/encode', payload),
  submitGrades: (payload) => api.post('/grades/submit', payload),
  getDistribution: (params = {}) => api.get('/grades/distribution', { params }),
  getRecentSubmissions: () => api.get('/grades/recent'),
  approveClass: (classId) => api.post(`/grades/class/${classId}/approve`),
  approveDocument: (classId, type) => api.post(`/grades/class/${classId}/approve-document`, { type }),
  releaseClass: (classId) => api.post(`/grades/class/${classId}/release`),
};

// ============ ENDORSEMENT SERVICE ============
export const endorsementService = {
  getAll: () => api.get('/endorsements'),
  getDepartmentStudents: () => api.get('/endorsements/department-students'),
  endorse: (studentId, notes) => api.post('/endorsements/endorse', { student_id: studentId, notes }),
  flag: (studentId, reason, notes) => api.post('/endorsements/flag', { student_id: studentId, flagged_reason: reason, notes }),
  adminOverride: (studentId, status, notes, flaggedReason) =>
    api.put('/endorsements/override', { student_id: studentId, status, notes, flagged_reason: flaggedReason }),
};

// ============ DASHBOARD SERVICE ============
export const dashboardService = {
  getAdmin: () => api.get('/dashboard/admin'),
  getAdminAnalytics: () => api.get('/dashboard/admin/analytics'),
  getInstructor: () => api.get('/dashboard/instructor'),
  getStudent: () => api.get('/dashboard/student'),
  getChairpersonFacultyReview: () => api.get('/dashboard/chairperson-faculty-review'),
  getActivities: (params) => api.get('/dashboard/activities', { params }),
};

// ============ SEMESTER SERVICE ============
export const semesterService = {
  getAll: (params) => api.get('/semesters', { params }),
  create: (data) => api.post('/semesters', data),
  update: (id, data) => api.put(`/semesters/${id}`, data),
  delete: (id) => api.delete(`/semesters/${id}`),
  setCurrent: (id) => api.put(`/semesters/${id}/current`),
};

// ============ REPORT SERVICE ============
export const reportService = {
  getGrades: (params) => api.get('/reports/grades', { params }),
  send: (data) => api.post('/reports/send', data),
  sendGradingSheet: (classId) => api.post(`/reports/send-grading-sheet/${classId}`),
  forwardGradingSheetToAdmin: (classId) => api.post(`/reports/forward-grading-sheet/${classId}`),
  verifyDocument: (classId, type) => api.post(`/reports/verify-document/${classId}`, { type }),
  returnToChairperson: (classId, message) => api.post(`/reports/return-to-chairperson/${classId}`, { message }),
  returnToFaculty: (classId, message) => api.post(`/reports/return-to-faculty/${classId}`, { message }),
  sendApprovedGradeSheet: (classId) => api.post(`/reports/send-approved-grade-sheet/${classId}`),
  getAdminGradesReport: () => api.get('/reports/admin'),
  getChairpersonReport: () => api.get('/reports/chairperson'),
};

// ============ PROMOTION SERVICE ============
export const promotionService = {
  getHistory: () => api.get('/promotions/history'),
  getOverview: () => api.get('/promotions/overview'),
};

// ============ CHAT SERVICE ============
export const chatService = {
  getContacts: () => api.get('/chat/contacts'),
  getConversations: () => api.get('/chat/conversations'),
  getUnreadCount: () => api.get('/chat/unread-count'),
  startConversation: (targetUserId) => api.post('/chat/conversations', { targetUserId }),
  getMessages: (conversationId, before) => api.get(`/chat/conversations/${conversationId}/messages`, { params: before ? { before } : {} }),
  sendMessage: (conversationId, body) => api.post(`/chat/conversations/${conversationId}/messages`, { body }),
  editMessage: (messageId, body) => api.put(`/chat/messages/${messageId}`, { body }),
  unsendMessage: (messageId) => api.delete(`/chat/messages/${messageId}/unsend`),
  deleteMessageForMe: (messageId) => api.delete(`/chat/messages/${messageId}`),
  forwardMessage: (messageId, targetUserId) => api.post(`/chat/messages/${messageId}/forward`, { targetUserId }),
  markRead: (conversationId) => api.put(`/chat/conversations/${conversationId}/read`),
  toggleMute: (conversationId, muted) => api.put(`/chat/conversations/${conversationId}/mute`, { muted }),
  deleteConversation: (conversationId) => api.delete(`/chat/conversations/${conversationId}`),
};

// ============ NOTIFICATION SERVICE ============
export const notificationService = {
  getAll: () => api.get('/notifications'),
  // Notifications auto-archive after 24h (see backend's archiveStaleNotifications)
  // — this fetches that archived list instead of the active one, same shape.
  getArchived: () => api.get('/notifications', { params: { archived: true } }),
  markAsRead: (id) => api.put(`/notifications/${id}/read`),
  markAllAsRead: () => api.put('/notifications/read-all'),
  delete: (id) => api.delete(`/notifications/${id}`),
};

// ============ VERIFICATION ASSIGNMENT SERVICE ============
// Chairperson delegates a pending student's Approve/Reject decision to one or
// more verifiers (Faculty, or another already-Active Student).
export const verificationService = {
  assign: (studentId, verifierIds) => api.post('/verification-assignments', { student_id: studentId, verifier_ids: verifierIds }),
  unassign: (assignmentId) => api.delete(`/verification-assignments/${assignmentId}`),
  getMine: () => api.get('/verification-assignments/mine'),
  getMyCount: () => api.get('/verification-assignments/mine/count'),
  decide: (studentId, status) => api.post(`/verification-assignments/${studentId}/decide`, { status }),
};