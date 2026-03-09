import axios from 'axios';
import { auth } from './auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

// Create axios instance
const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = auth.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      auth.clearAuth();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  register: (userData) => api.post('/auth/register', userData),
  login: (credentials) => api.post('/auth/login', credentials),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
};

// Users API
export const usersAPI = {
  getUsers: (search = '') => api.get(`/users?search=${search}`),
  getUser: (id) => api.get(`/users/${id}`),
  updateProfile: (data) => api.put('/users/profile', data),
};

// Conversations API
export const conversationsAPI = {
  getConversations: () => api.get('/conversations'),
  getOrCreateConversation: (userId) => api.post(`/conversations/with/${userId}`),
  getMessages: (conversationId, page = 1, limit = 50) => 
    api.get(`/conversations/${conversationId}/messages?page=${page}&limit=${limit}`),
  deleteConversation: (conversationId) => api.delete(`/conversations/${conversationId}`),
  forwardMessage: (conversationId, messageId, targetUserIds, additionalText) => 
    api.post(`/conversations/${conversationId}/forward`, {
      messageId,
      targetUserIds,
      additionalText
    }),
};

export default api;

