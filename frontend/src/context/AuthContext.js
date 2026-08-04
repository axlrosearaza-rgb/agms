import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services';
import socket from '../services/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('agms_token'));
  const [loading, setLoading] = useState(true);

  // 🔥 LOAD USER FROM API USING TOKEN
  const loadUser = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await authService.getMe();

      // ✅ IMPORTANT: always extract properly
      const userData = res.data?.user;

      setUser(userData);
      localStorage.setItem('agms_user', JSON.stringify(userData));
      socket.connect();
    } catch (error) {
      console.error('Load user failed:', error);

      // ❌ clear invalid session
      localStorage.removeItem('agms_token');
      localStorage.removeItem('agms_user');

      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // 🔥 LOGIN (SAFE VERSION)
  const login = async (identifier, password) => {
    try {
      const res = await authService.login(identifier, password);

      // ✅ VERY IMPORTANT FIX
      const userData = res.data?.user;
      const tokenData = res.data?.token;

      if (!userData || !tokenData) {
        throw new Error('Invalid login response');
      }

      // Save
      localStorage.setItem('agms_token', tokenData);
      localStorage.setItem('agms_user', JSON.stringify(userData));

      setToken(tokenData);
      setUser(userData);
      socket.connect();

      return userData; // ✅ RETURN CLEAN OBJECT ONLY
    } catch (error) {
      console.error('Login error:', error);

      // 🔥 ensure error is string (prevents React crash)
      const message =
        error.response?.data?.message ||
        error.message ||
        'Login failed';

      throw new Error(message);
    }
  };

  // 🔥 LOGOUT
  const logout = () => {
    localStorage.removeItem('agms_token');
    localStorage.removeItem('agms_user');

    setToken(null);
    setUser(null);
    socket.disconnect();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {!loading && children}
    </AuthContext.Provider>
  );
}

// 🔥 HOOK
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};