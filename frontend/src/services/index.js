import api from './api';

// ============ AUTH SERVICE ============
export const authService = {
  login: (identifier, password) => api.post('/auth/login', { identifier, password }),
  register: (data) => api.post('/auth/register', data),
  getMe: () => api.get('/auth/me'),
  changePassword: (data) => api.put('/auth/password', data),
};

// ============ USER SERVICE ============
export const userService = {
  getAll: (params) => api.get('/users', { params }),
  getById: (id) => api.get(`/users/${id}`),
  getPending: () => api.get('/users/pending'),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  deactivate: (id) => api.delete(`/users/${id}`),
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
  delete: (id) => api.delete(`/classes/${id}`),
  enroll: (id, studentIds) => api.post(`/classes/${id}/enroll`, { student_ids: studentIds }),
};

// ============ GRADE SERVICE ============
export const gradeService = {
  getByClass: (classId) => api.get(`/grades/class/${classId}`),
  getGradesByClass: (classId) => api.get(`/grades/class/${classId}`),
  getStudentGrades: (studentId, params = {}) => api.get(`/grades/student/${studentId}`, { params }),
  encodeGrades: (payload) => api.post('/grades/encode', payload),
  submitGrades: (payload) => api.post('/grades/submit', payload),
  getDistribution: (params = {}) => api.get('/grades/distribution', { params }),
  getRecentSubmissions: () => api.get('/grades/recent'),
  approveClass: (classId) => api.post(`/grades/class/${classId}/approve`),
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
  getInstructor: () => api.get('/dashboard/instructor'),
  getStudent: () => api.get('/dashboard/student'),
  getChairpersonFacultyReview: () => api.get('/dashboard/chairperson-faculty-review'),
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
  getChairpersonReport: () => api.get('/reports/chairperson'),
};

// ============ CHAT SERVICE ============
export const chatService = {
  getContacts: () => api.get('/chat/contacts'),
  getConversations: () => api.get('/chat/conversations'),
  startConversation: (targetUserId) => api.post('/chat/conversations', { targetUserId }),
  getMessages: (conversationId, before) => api.get(`/chat/conversations/${conversationId}/messages`, { params: before ? { before } : {} }),
  sendMessage: (conversationId, body) => api.post(`/chat/conversations/${conversationId}/messages`, { body }),
  markRead: (conversationId) => api.put(`/chat/conversations/${conversationId}/read`),
  toggleMute: (conversationId, muted) => api.put(`/chat/conversations/${conversationId}/mute`, { muted }),
};

// ============ NOTIFICATION SERVICE ============
export const notificationService = {
  getAll: () => api.get('/notifications'),
  markAsRead: (id) => api.put(`/notifications/${id}/read`),
  markAllAsRead: () => api.put('/notifications/read-all'),
  delete: (id) => api.delete(`/notifications/${id}`),
};