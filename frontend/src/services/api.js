import axios from 'axios';

// ✅ Base URL (from .env or fallback)
const API_BASE_URL =
  process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// ✅ Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ✅ Attach token to every request
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('agms_token');

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// ✅ Global response handler
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Unauthorized → logout
    if (error.response?.status === 401) {
      localStorage.removeItem('agms_token');
      localStorage.removeItem('agms_user');

      window.location.href = '/login';
    }

    // Optional: log other errors
    console.error('API Error:', error.response?.data || error.message);

    return Promise.reject(error);
  }
);

export default api;