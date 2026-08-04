import api from './api';

// ================================
// 🎯 GRADE SERVICE (ALL GRADE APIs)
// ================================

const gradeService = {

  // ✅ Get student grades (dynamic)
  getStudentGrades: (studentId, params = {}) => {
    return api.get(`/grades/student/${studentId}`, {
      params,
    });
  },

  // ✅ Get grades by class (for instructors/admin)
  getGradesByClass: (classId) => {
    return api.get(`/grades/class/${classId}`);
  },

  // ✅ Alias used by GradeEncoding.js
  getByClass: (classId) => {
    return api.get(`/grades/class/${classId}`);
  },

  // ✅ Encode grades (Instructor)
  encodeGrades: (payload) => {
    return api.post('/grades/encode', payload);
  },

  // ✅ Submit grades (Instructor)
  submitGrades: (payload) => {
    return api.post('/grades/submit', payload);
  },

  // ✅ Get grade distribution (Admin Dashboard)
  getDistribution: (params = {}) => {
    return api.get('/grades/distribution', {
      params,
    });
  },

  // ✅ Get recent submissions (Admin/Instructor)
  getRecentSubmissions: () => {
    return api.get('/grades/recent');
  },

};

export default gradeService;