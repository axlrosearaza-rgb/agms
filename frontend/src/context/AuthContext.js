import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services';
import socket from '../services/socket';
import toast from 'react-hot-toast';
import { getToken, setAuth, setUser as persistUser, clearAuth, markActivity, setLockedState } from '../services/authStorage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(getToken());
  const [loading, setLoading] = useState(true);
  // Data Privacy Act (RA 10173) — whether the first-login Privacy Notice modal
  // still needs to be shown (never accepted, or the policy version changed).
  const [needsPrivacyConsent, setNeedsPrivacyConsent] = useState(false);

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
      setNeedsPrivacyConsent(!!res.data?.needs_privacy_consent);
      persistUser(userData);
      socket.connect();
    } catch (error) {
      console.error('Load user failed:', error);

      // ❌ clear invalid session
      clearAuth();

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
  // `remember` controls WHERE the session is saved, not whether it's saved:
  // true (the checkbox default) → localStorage, survives closing the
  // browser entirely; false → sessionStorage, gone as soon as this tab/
  // browser closes.
  const login = async (identifier, password, remember = true) => {
    try {
      const res = await authService.login(identifier, password);

      // ✅ VERY IMPORTANT FIX
      const userData = res.data?.user;
      const tokenData = res.data?.token;

      if (!userData || !tokenData) {
        throw new Error('Invalid login response');
      }

      // Save
      setAuth(remember, tokenData, userData);

      setToken(tokenData);
      setUser(userData);
      setNeedsPrivacyConsent(!!res.data?.needs_privacy_consent);
      markActivity();
      setLockedState(false);
      socket.connect();

      // The 8-character minimum only applies to new registrations/resets
      // going forward — this account predates it. A warning (not a block)
      // pointing them at Settings, shown on every login until they actually
      // update it — once they do, the backend stops reporting
      // password_too_short at all, so this naturally stops firing on its own.
      if (res.data?.password_too_short) {
        toast('Your password is shorter than our current 8-character minimum. Please update it in Settings.', { icon: '⚠️', duration: 8000 });
      }

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
    clearAuth();
    setLockedState(false);

    setToken(null);
    setUser(null);
    setNeedsPrivacyConsent(false);
    socket.disconnect();
  };

  // Data Privacy Act (RA 10173) — records acceptance of the current Privacy
  // Notice and immediately dismisses the modal (no page reload needed).
  const acceptPrivacyPolicy = async () => {
    const res = await authService.acceptPrivacyPolicy();
    const userData = res.data?.user;
    if (userData) {
      setUser(userData);
      persistUser(userData);
    }
    setNeedsPrivacyConsent(false);
  };

  // Patches the locally-held user object without a full reload — e.g. after
  // the student picks their own regularization subjects (StudentDashboard.js),
  // so the hero card and any status badges reflect it immediately.
  const updateUser = (partial) => {
    setUser((prev) => {
      const next = { ...prev, ...partial };
      persistUser(next);
      return next;
    });
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
        needsPrivacyConsent,
        acceptPrivacyPolicy,
        updateUser,
        // Re-pulls the full user record from the server — e.g. after a grade
        // release that might've flipped the student's own status server-side
        // (gradeController.checkAndRegularizeStudent auto-regularizing them),
        // something a local updateUser() patch can't know to do on its own.
        refreshUser: loadUser,
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