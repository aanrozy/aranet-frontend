import Cookies from 'js-cookie';

const TOKEN_KEY = 'aranet_token';
const USER_KEY = 'aranet_user';

export const auth = {
  // Set token dan user data
  setAuth: (token, user) => {
    Cookies.set(TOKEN_KEY, token, { expires: 7 }); // 7 days
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  // Get token
  getToken: () => {
    return Cookies.get(TOKEN_KEY);
  },

  // Get user data
  getUser: () => {
    if (typeof window !== 'undefined') {
      const user = localStorage.getItem(USER_KEY);
      return user ? JSON.parse(user) : null;
    }
    return null;
  },

  // Check if user is authenticated
  isAuthenticated: () => {
    return !!auth.getToken();
  },

  // Clear auth data
  clearAuth: () => {
    Cookies.remove(TOKEN_KEY);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(USER_KEY);
    }
  },

  // Update user data
  updateUser: (userData) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(USER_KEY, JSON.stringify(userData));
    }
  }
};

