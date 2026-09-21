  import { useState, useEffect, useCallback, useRef } from 'react';
  import { Link, useLocation, useNavigate } from 'react-router-dom';
  import { useAuth } from '../../context/AuthContext';
  import { Avatar, Icons, roleLabel, ConfirmDialog } from '../common';
  import PrivacyConsentModal from '../common/PrivacyConsentModal';
  import Footer from '../common/Footer';
  import { notificationService, userService, classService, chatService, verificationService, authService } from '../../services';
  import socket from '../../services/socket';
  import { playNotificationSound } from '../../utils/notificationSound';
  import { getLastActivity, markActivity, isLockedState, setLockedState } from '../../services/authStorage';

  const ROLE_HOME = {
    Admin: '/admin',
    Chairperson: '/chairperson',
    Faculty: '/faculty',
    Student: '/student',
  };

  export default function AppLayout({ children, navItems }) {
    const { user, logout, needsPrivacyConsent, acceptPrivacyPolicy } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const INACTIVITY_LOCK_MS = 5 * 60 * 1000;
    const autoLockRoles = new Set(['Admin', 'Chairperson', 'Faculty']);
    const shouldAutoLock = !!user && autoLockRoles.has(user.role);
    const [isLocked, setIsLocked] = useState(shouldAutoLock && isLockedState());
    const [unlockPassword, setUnlockPassword] = useState('');
    const [unlockError, setUnlockError] = useState('');
    const [unlocking, setUnlocking] = useState(false);

    useEffect(() => {
      if (!shouldAutoLock) {
        setLockedState(false);
        return;
      }

      const lastActivity = getLastActivity();
      if (Date.now() - lastActivity >= INACTIVITY_LOCK_MS) {
        setLockedState(true);
        setIsLocked(true);
      } else {
        setLockedState(false);
        setIsLocked(false);
      }
    }, [shouldAutoLock, user?.id]);

    const resetInactivityTimer = useCallback(() => {
      if (!shouldAutoLock || isLocked) return;
      markActivity();
    }, [shouldAutoLock, isLocked]);

    useEffect(() => {
      if (!shouldAutoLock || isLocked) return undefined;

      const activityEvents = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'];
      const handleActivity = () => {
        resetInactivityTimer();
      };

      activityEvents.forEach((eventName) => {
        window.addEventListener(eventName, handleActivity, true);
      });

      const timerId = window.setInterval(() => {
        const lastActivity = getLastActivity();
        if (Date.now() - lastActivity >= INACTIVITY_LOCK_MS) {
          setLockedState(true);
          setIsLocked(true);
          setUnlockPassword('');
          setUnlockError('');
        }
      }, 1000);

      return () => {
        activityEvents.forEach((eventName) => {
          window.removeEventListener(eventName, handleActivity, true);
        });
        window.clearInterval(timerId);
      };
    }, [shouldAutoLock, isLocked, resetInactivityTimer]);

    const handleUnlock = async (event) => {
      event.preventDefault();
      if (!unlockPassword.trim()) {
        setUnlockError('Enter your password to continue.');
        return;
      }

      setUnlocking(true);
      setUnlockError('');

      try {
        await authService.verifyPassword(unlockPassword);
        markActivity();
        setLockedState(false);
        setIsLocked(false);
        setUnlockPassword('');
        setUnlockError('');
      } catch (error) {
        setUnlockError(error?.response?.data?.message || 'Incorrect password.');
      } finally {
        setUnlocking(false);
      }
    };

    // navigator.onLine flips the moment the connection actually drops/returns
    // (no polling needed) — surfaced as a banner so "is it still working?" has
    // a visible answer instead of only showing up as failed actions/toasts
    // scattered across whatever page happens to be open.
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    useEffect(() => {
      const goOnline = () => setIsOnline(true);
      const goOffline = () => setIsOnline(false);
      window.addEventListener('online', goOnline);
      window.addEventListener('offline', goOffline);
      return () => {
        window.removeEventListener('online', goOnline);
        window.removeEventListener('offline', goOffline);
      };
    }, []);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [notifOpen, setNotifOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    // Notifications auto-archive after 24h server-side — this is the "view
    // what fell off the active list" toggle inside the same dropdown, rather
    // than a whole separate page. Fetched lazily (only the first time it's
    // opened) since most visits never need it.
    const [showArchived, setShowArchived] = useState(false);
    const [archivedNotifications, setArchivedNotifications] = useState(null);
    const [loadingArchived, setLoadingArchived] = useState(false);
    const [pendingStudents, setPendingStudents] = useState(0);
    // "Grade Approval" badge — Admin's own queue (/admin/grade-approval) and
    // Chairperson's (/chairperson/grading-sheets) are two different counts
    // under the same nav label, both from the one pending-approval-count
    // endpoint (it branches by role server-side).
    const [pendingApprovals, setPendingApprovals] = useState(0);
    // "Messages" badge — total unread across every conversation, any role.
    const [unreadMessages, setUnreadMessages] = useState(0);
    // "Assigned Work" badge (Faculty/Student) — how many pending
    // registrations a Chairperson delegated to THIS person specifically to
    // verify (verificationAssignmentController.assignVerifiers already
    // notifies them the moment they're assigned; this is the standing count
    // so it's visible in the sidebar too, not just a one-time notification).
    const [assignedWork, setAssignedWork] = useState(0);

    // `matchAlso` lets a nav item claim a sibling route that isn't nested
    // under its own path — e.g. Grade Encoding (/faculty/encode/:classId)
    // belongs to "My Classes" (/faculty/classes) but isn't a sub-path of it,
    // so it would otherwise match nothing here and silently fall back to
    // showing "Dashboard" in the header/breadcrumb while on it.
    const isActive = (path, matchAlso) => {
      const roleHome = ROLE_HOME[user?.role];
      if (path === roleHome) return location.pathname === path;
      if (location.pathname.startsWith(path)) return true;
      return (matchAlso || []).some((p) => location.pathname.startsWith(p));
    };

    const currentNav = navItems.find((n) => isActive(n.path, n.matchAlso)) || navItems[0];

    const [confirmLogout, setConfirmLogout] = useState(false);
    const handleLogout = () => {
      logout();
      navigate('/login');
    };

    const loadNotifications = useCallback(async () => {
      try {
        const { data } = await notificationService.getAll();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      } catch (err) {}
    }, []);

    // Pending-registration badge belongs to the Chairperson's nav item — they
    // approve/reject registrations directly (see PendingRegistrations.js). Once
    // Active, Faculty find those students by Year/Section when enrolling them
    // into a class (see InstructorClasses.js), no separate verification step.
    const loadPendingCount = useCallback(async () => {
      if (user?.role !== 'Chairperson') return;
      try {
        const { data } = await userService.getPending();
        setPendingStudents(data.users?.length || 0);
      } catch (err) {}
    }, [user?.role]);

    const loadPendingApprovals = useCallback(async () => {
      if (user?.role !== 'Admin' && user?.role !== 'Chairperson') return;
      try {
        const { data } = await classService.getPendingApprovalCount();
        setPendingApprovals(data.count || 0);
      } catch (err) {}
    }, [user?.role]);

    // A new socket 'chat:message' event fires this on every single incoming
    // message (see the effect below) — several messages arriving close
    // together kick off several overlapping GET requests with no guarantee
    // they resolve in the order they were sent. Without a guard, a slower
    // response from an EARLIER message landing AFTER a later one's already-
    // correct response would silently overwrite it with a smaller, stale
    // count — this is exactly what made the badge look stuck at 1 instead
    // of climbing with each new message. Same fix as Messages.js's own
    // loadConversations: tag each request, discard any response that isn't
    // from the most recently fired one.
    const unreadMessagesRequestId = useRef(0);
    const loadUnreadMessages = useCallback(async () => {
      const requestId = ++unreadMessagesRequestId.current;
      try {
        const { data } = await chatService.getUnreadCount();
        if (requestId !== unreadMessagesRequestId.current) return;
        setUnreadMessages(data.count || 0);
      } catch (err) {}
    }, []);

    const loadAssignedWork = useCallback(async () => {
      if (user?.role !== 'Faculty' && user?.role !== 'Student') return;
      try {
        const { data } = await verificationService.getMyCount();
        setAssignedWork(data.count || 0);
      } catch (err) {}
    }, [user?.role]);

    useEffect(() => {
      if (user) {
        loadNotifications();
        loadPendingCount();
        loadPendingApprovals();
        loadUnreadMessages();
        loadAssignedWork();
      }
    }, [user, loadNotifications, loadPendingCount, loadPendingApprovals, loadUnreadMessages, loadAssignedWork]);

    useEffect(() => {
      if (user?.role === 'Chairperson') {
        loadPendingCount();
      }
    }, [location.pathname, user?.role, loadPendingCount]);

    // Re-syncs both badges on every navigation — cheap COUNT-only endpoints,
    // and this is what catches "read some messages / approved a class,
    // then left that page" without needing every single action on those
    // pages to individually know to refresh the sidebar too.
    useEffect(() => {
      loadUnreadMessages();
      if (user?.role === 'Admin' || user?.role === 'Chairperson') loadPendingApprovals();
      if (user?.role === 'Faculty' || user?.role === 'Student') loadAssignedWork();
    }, [location.pathname, user?.role, loadUnreadMessages, loadPendingApprovals, loadAssignedWork]);

    // Same reasoning as Messages.js's own polling fallback — the socket
    // event that normally bumps this badge live can silently miss (dropped
    // connection, blocked WebSocket, backgrounded tab), and unlike a page
    // the user might reopen, the sidebar badge is otherwise only as fresh
    // as the last navigation. A cheap periodic re-check keeps it honest
    // even if nothing "live" ever reaches it.
    useEffect(() => {
      if (!user) return undefined;
      const interval = setInterval(() => { if (document.visibilityState === 'visible') loadUnreadMessages(); }, 2500);
      return () => clearInterval(interval);
    }, [user, loadUnreadMessages]);

    useEffect(() => {
      if (!user) return;
      const handleNewNotification = (notif) => {
        setNotifications(prev => [notif, ...prev]);
        setUnreadCount(prev => prev + 1);
        // Every real-time notification across the whole system funnels
        // through this one socket event (controllers/notificationController.js's
        // createNotification, which every other controller now routes
        // through too) — so this single sound hook covers all of them:
        // grades released/approved, registrations, endorsements,
        // promotions, regularization, chat, etc.
        playNotificationSound();
        if (user.role === 'Chairperson') loadPendingCount();
        if (user.role === 'Admin' || user.role === 'Chairperson') loadPendingApprovals();
        if (user.role === 'Faculty' || user.role === 'Student') loadAssignedWork();
        loadUnreadMessages();
      };
      // Room-scoped server-side (`user:${id}`, joined on connect) rather than
      // a userId-specific event name broadcast to every socket — matches
      // notificationController.js's createNotification.
      socket.on('notification:new', handleNewNotification);
      return () => { socket.off('notification:new', handleNewNotification); };
    }, [user, loadPendingCount, loadPendingApprovals, loadUnreadMessages, loadAssignedWork]);

    // The Messages badge was only ever refreshing off 'notification:new' —
    // one hop slower than the bell it's sitting right next to, since a chat
    // notification is created (its own DB insert + a SEPARATE emit) only
    // AFTER the message itself has already gone out over 'chat:message'
    // (see chatController.deliverMessage — that notification is explicitly
    // fire-and-forget, running after the response, not before). Listening
    // for 'chat:message' directly reacts at the same moment the bell does,
    // instead of waiting on that extra round trip.
    useEffect(() => {
      if (!user) return undefined;
      const handleChatMessage = () => loadUnreadMessages();
      socket.on('chat:message', handleChatMessage);
      return () => socket.off('chat:message', handleChatMessage);
    }, [user, loadUnreadMessages]);

    // The sidebar's own Grade Approval / Assigned Work badges were only
    // refreshing off a notification actually landing for THIS viewer — but
    // several of the actions that change these counts (a Chairperson
    // forwarding a class to Admin, a class getting sent back, etc.) don't
    // necessarily fire a notification at every viewer whose own badge count
    // just changed. 'gradesUpdated' is the same broad, class-submission-
    // lifecycle socket event GradingSheets.js/GradeApproval.js/the
    // dashboards already key their own live refresh off of — listening for
    // it here directly closes that gap instead of depending on a
    // notification as a proxy for "something this badge cares about
    // happened".
    useEffect(() => {
      if (!user) return undefined;
      const handler = () => {
        if (user.role === 'Chairperson') loadPendingCount();
        if (user.role === 'Admin' || user.role === 'Chairperson') loadPendingApprovals();
        if (user.role === 'Faculty' || user.role === 'Student') loadAssignedWork();
      };
      socket.on('gradesUpdated', handler);
      return () => socket.off('gradesUpdated', handler);
    }, [user, loadPendingCount, loadPendingApprovals, loadAssignedWork]);

    // Every live-update path above only reacts to an event that arrives
    // WHILE the socket is connected — this is what "worked for a second,
    // then stopped" was actually describing: a background tab, a network
    // blip, a laptop waking from sleep, etc. drops the connection, and
    // whatever happened during that gap (another Faculty submitting,
    // another class getting approved) never reaches this browser at all.
    // socket.io-client reconnects on its own, but reconnecting doesn't
    // replay what was missed — so the moment a (re)connection actually
    // lands, re-pull every badge from the real REST endpoints once, the
    // same "catch up on reconnect" fix Messages.js already applies to its
    // own conversation list.
    useEffect(() => {
      if (!user) return undefined;
      const handleConnect = () => {
        loadNotifications();
        loadPendingCount();
        loadPendingApprovals();
        loadUnreadMessages();
        loadAssignedWork();
      };
      socket.on('connect', handleConnect);
      return () => socket.off('connect', handleConnect);
    }, [user, loadNotifications, loadPendingCount, loadPendingApprovals, loadUnreadMessages, loadAssignedWork]);

    // Browsers throttle timers hard in a backgrounded/unfocused tab — the
    // 8-second unread-messages poll below can end up firing far less often
    // than every 8 seconds once a tab's been hidden a while, invisibly (the
    // interval is still "running", just not on schedule). Re-syncing every
    // badge the moment this tab becomes visible again — switched back to,
    // un-minimized, the laptop waking up — catches up immediately instead
    // of waiting on a throttled timer, same reasoning as the reconnect
    // handler just above.
    useEffect(() => {
      if (!user) return undefined;
      const handleVisibility = () => {
        if (document.visibilityState !== 'visible') return;
        loadNotifications();
        loadPendingCount();
        loadPendingApprovals();
        loadUnreadMessages();
        loadAssignedWork();
      };
      document.addEventListener('visibilitychange', handleVisibility);
      return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [user, loadNotifications, loadPendingCount, loadPendingApprovals, loadUnreadMessages, loadAssignedWork]);

    const handleMarkAsRead = async (id) => {
      try {
        await notificationService.markAsRead(id);
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (err) {}
    };

    const handleMarkAllRead = async () => {
      try {
        await notificationService.markAllAsRead();
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
        setUnreadCount(0);
      } catch (err) {}
    };

    const loadArchivedNotifications = async () => {
      setLoadingArchived(true);
      try {
        const { data } = await notificationService.getArchived();
        setArchivedNotifications(data.notifications || []);
      } catch (err) {
        setArchivedNotifications([]);
      } finally {
        setLoadingArchived(false);
      }
    };

    const toggleArchivedView = () => {
      const next = !showArchived;
      setShowArchived(next);
      if (next && archivedNotifications === null) loadArchivedNotifications();
    };

    const closeNotifDropdown = () => {
      setNotifOpen(false);
      // Always reopen to the active list next time, not wherever it was left.
      setShowArchived(false);
    };

    // Escape closes whichever transient panel is open — the notification
    // dropdown, the profile dropdown, or the mobile sidebar drawer — same as
    // clicking outside it. Deliberately NOT wired to the session-lock screen
    // (isLocked) or the privacy-consent modal: those are meant to be
    // un-dismissable until the user actually acts on them.
    useEffect(() => {
      if (!notifOpen && !dropdownOpen && !sidebarOpen) return undefined;
      const onKeyDown = (e) => {
        if (e.key !== 'Escape') return;
        if (notifOpen) closeNotifDropdown();
        if (dropdownOpen) setDropdownOpen(false);
        if (sidebarOpen) setSidebarOpen(false);
      };
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    }, [notifOpen, dropdownOpen, sidebarOpen]);

    const handleBellClick = () => {
      const nextOpen = !notifOpen;
      setNotifOpen(nextOpen);
      setDropdownOpen(false);

      // Automatically remove the notification number badge once clicked for all users
      if (nextOpen && unreadCount > 0) {
        setUnreadCount(0);
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
        notificationService.markAllAsRead().catch(() => {});
      }
    };

    const handleNotifClick = (notif) => {
      if (!notif.is_read) {
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
        notificationService.markAsRead(notif.id).catch(() => {});
      }
      if (notif.link) navigate(notif.link);
      closeNotifDropdown();
    };

    const timeSince = (date) => {
      if (!date) return '';
      const seconds = Math.floor((new Date() - new Date(date)) / 1000);
      if (seconds < 60) return 'just now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      return `${Math.floor(hours / 24)}d ago`;
    };

    // Sidebar nav badges (Pending Registrations, Grade Approval, Messages) —
    // capped at "9+" instead of ever growing arbitrarily wide (a real
    // Part-Timer-scale program can genuinely hit 40+ pending). A tiny pill
    // badge showing "43" reads worse than it's worth and can even overflow
    // its own circle — "9+" says "it's a lot, go look" just as well.
    const navBadge = (n) => (n > 9 ? '9+' : n);

    const notifIcon = (type) => {
      switch (type) {
        case 'registration': return <Icons.Users className="w-4 h-4 text-blue-500" />;
        case 'grade':        return <Icons.FileText className="w-4 h-4 text-green-500" />;
        case 'endorsement':  return <Icons.Award className="w-4 h-4 text-purple-500" />;
        case 'promotion':    return <Icons.Award className="w-4 h-4 text-gold" />;
        // Username/password/email changed on THIS account — a self-notice,
        // not an announcement about someone else, so it gets its own
        // visually distinct (red) icon to stand out from the routine ones.
        case 'security':     return <Icons.Shield className="w-4 h-4 text-red-500" />;
        default:             return <Icons.Bell className="w-4 h-4 text-gray-400" />;
      }
    };

    const roleBase = ROLE_HOME[user?.role] || '/';
    const sidebarWidth = sidebarCollapsed ? 'w-[72px]' : 'w-[260px]';
    const mainMargin = sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[260px]';

    return (
      <>
      <div className="min-h-screen bg-gray-50/50 theme-scope">
        {isLocked && shouldAutoLock && (
          <div className="fixed inset-0 z-[2000] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center px-4">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white shadow-2xl p-6">
              <div className="flex items-center justify-center mb-4">
                <span className="w-14 h-14 rounded-full bg-navy text-white flex items-center justify-center">
                  <Icons.Shield className="w-7 h-7" />
                </span>
              </div>
              <div className="text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">Session Locked</p>
                <h2 className="mt-2 text-2xl font-bold text-navy">Enter your password</h2>
                <p className="mt-2 text-sm text-gray-500">You were inactive for 5 minutes. Sign in again to continue.</p>
              </div>

              <form className="mt-6" onSubmit={handleUnlock}>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  autoFocus
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-gold focus:ring-2 focus:ring-gold/30 text-sm"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  placeholder="Enter your password"
                />
                {unlockError && <p className="mt-2 text-xs font-medium text-red-600">{unlockError}</p>}
                <div className="mt-4 flex gap-2">
                  <button
                    type="submit"
                    disabled={unlocking}
                    className="flex-1 rounded-lg bg-navy text-white px-4 py-2.5 font-semibold text-sm hover:bg-navy/90 disabled:opacity-70"
                  >
                    {unlocking ? 'Unlocking...' : 'Unlock'}
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="rounded-lg border border-gray-200 px-4 py-2.5 font-semibold text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Logout
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/40 z-[99] lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar */}
        <aside className={`${sidebarWidth} bg-white border-r border-gray-100 fixed top-0 left-0 h-screen z-[100] flex flex-col transition-all duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
          {/* Logo + Collapse toggle */}
          <div className={`p-5 flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'} border-b border-gray-100`}>
            {/* ── Clickable logo → navigates to dashboard ── */}
            <Link
              to={roleBase}
              className="flex items-center gap-3 no-underline group"
              title="Go to Dashboard"
              onClick={() => setSidebarOpen(false)}
            >
              <img
                src="/assets/logos/cas-logo.png"
                alt="CAS"
                className="w-10 h-10 rounded-[10px] object-contain flex-shrink-0 group-hover:opacity-80 transition-opacity"
              />
              {!sidebarCollapsed && (
                <div>
                  <p className="font-semibold text-[14px] leading-tight text-gray-900 group-hover:text-gold transition-colors">College of Arts</p>
                  <p className="font-semibold text-[14px] leading-tight text-gray-900 group-hover:text-gold transition-colors">and Sciences</p>
                </div>
              )}
            </Link>

            {!sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="hidden lg:flex w-7 h-7 rounded-md items-center justify-center bg-transparent border-none cursor-pointer hover:bg-gray-100 transition-colors"
                title="Collapse sidebar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="9" y2="18"/>
                </svg>
              </button>
            )}
          </div>

          {sidebarCollapsed && (
            <div className="hidden lg:flex justify-center pt-3 pb-1">
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="w-8 h-8 rounded-md flex items-center justify-center bg-transparent border-none cursor-pointer hover:bg-gray-100 transition-colors"
                title="Expand sidebar"
              >
                <Icons.Menu className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          )}

          {/* Nav */}
          <nav className="flex-1 p-3 flex flex-col gap-0.5 overflow-y-auto">
            {!sidebarCollapsed && (
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold px-3 pt-3 pb-1.5">Main Menu</p>
            )}
            {sidebarCollapsed && <div className="pt-2" />}
            {navItems.map((item, i) => {
              // A teaching Chairperson's "My Classes" etc. are appended at the
              // end (see App.js's getNavItems) — flagged with `section` so they
              // get their own divider here instead of blending into the
              // Chairperson's own duties above them.
              const startsNewSection = item.section && navItems[i - 1]?.section !== item.section;
              return (
                <div key={item.path}>
                  {startsNewSection && (
                    <div className={`border-t border-gray-100 mt-2 mb-1.5 ${sidebarCollapsed ? '' : 'pt-2'}`}>
                      {!sidebarCollapsed && (
                        <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold px-3 pb-1.5">Teaching</p>
                      )}
                    </div>
                  )}
                  <Link
                    to={item.path}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`nav-item no-underline relative ${isActive(item.path, item.matchAlso) ? 'active' : ''} ${sidebarCollapsed ? '!justify-center !px-0' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    {item.icon}
                    {!sidebarCollapsed && (
                      <span className="flex-1">{item.label}</span>
                    )}
                    {(() => {
                      // Pending Registrations (Chairperson), Grade Approval
                      // (Admin's /admin/grade-approval AND Chairperson's own
                      // /chairperson/grading-sheets under the same nav
                      // label), Messages (every role), and Assigned Work
                      // (Faculty/Student) each get the same badge treatment
                      // off whichever count actually applies to this nav item.
                      const count =
                        item.path === '/chairperson/pending-students' ? pendingStudents :
                        (item.path === '/admin/grade-approval' || item.path === '/chairperson/grading-sheets') ? pendingApprovals :
                        item.path.endsWith('/messages') ? unreadMessages :
                        item.path.endsWith('/assigned-students') ? assignedWork :
                        0;
                      if (count <= 0) return null;
                      // key={count} restarts the pop animation from scratch
                      // every time the count itself changes (a new message,
                      // one more pending approval, ...) — not just the first
                      // time the badge appears — plus a continuous pulse so
                      // it keeps catching the eye until actually read.
                      return sidebarCollapsed ? (
                        <span key={count} className="badge-pop animate-pulse absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />
                      ) : (
                        <span key={count} className="badge-pop animate-pulse bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
                          {navBadge(count)}
                        </span>
                      );
                    })()}
                  </Link>
                </div>
              );
            })}
          </nav>

          {/* User info */}
          <div className={`p-4 border-t border-gray-100 ${sidebarCollapsed ? 'flex flex-col items-center' : ''}`}>
            {sidebarCollapsed ? (
              <Avatar letter={user?.avatar || user?.name?.[0]} className="bg-gold text-white" size="w-8 h-8 text-xs" />
            ) : (
              <div className="flex items-center gap-2.5">
                <Avatar letter={user?.avatar || user?.name?.[0]} className="bg-gold text-white" size="w-8 h-8 text-xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate">{user?.name}</p>
                  <p className="text-[11px] text-gold font-medium">{roleLabel(user?.role)}</p>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <div className={`flex-1 ${mainMargin} flex flex-col min-h-screen transition-all duration-300 overflow-x-hidden`}>
          {/* Topbar */}
          <header className="bg-navy text-white px-4 lg:px-7 h-14 flex items-center justify-between sticky top-0 z-[90] min-w-0">
            <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
              <button className="lg:hidden bg-transparent border-none text-white cursor-pointer p-1" onClick={() => setSidebarOpen(true)}>
                <Icons.Menu />
              </button>
              <h1 className="text-[15px] font-semibold truncate">{currentNav?.label || 'Dashboard'}</h1>
            </div>
            <p className="text-[13px] opacity-80 hidden lg:block truncate mx-4 flex-shrink">Academic Grade Management System</p>
            <div className="flex items-center gap-4 flex-shrink-0">
              {/* Notification Bell */}
              <div className="relative">
                <button
                  onClick={handleBellClick}
                  className="relative bg-transparent border-none text-white cursor-pointer opacity-80 hover:opacity-100 p-1"
                >
                  <Icons.Bell />
                  {unreadCount > 0 && (
                    <span key={unreadCount} className="badge-pop absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 leading-none animate-pulse">
                      {navBadge(unreadCount)}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-[998]" onClick={closeNotifDropdown} />
                    {/* fixed + right-4, not absolute + right-0 — `absolute`
                        anchored the panel to the bell BUTTON's own position,
                        not the viewport's actual right edge, so on a narrow
                        screen (bell sitting well left of the true edge, with
                        the avatar/chevron still further right of it) a panel
                        sized to nearly the full viewport width overflowed off
                        the LEFT edge instead of ever fitting on screen. Same
                        `fixed ... right-4 lg:right-7` the profile dropdown
                        below already uses, which pins correctly to the
                        viewport regardless of where the bell itself sits. */}
                    <div className="fixed right-4 lg:right-7 top-[52px] w-[calc(100vw-2rem)] max-w-[340px] bg-white rounded-xl shadow-2xl z-[999] border border-gray-100 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {showArchived && (
                            <button
                              onClick={() => setShowArchived(false)}
                              className="bg-transparent border-none cursor-pointer p-0 text-gray-400 hover:text-gray-600 flex items-center"
                              title="Back to active notifications"
                            >
                              <Icons.ChevronDown className="w-4 h-4 rotate-90" />
                            </button>
                          )}
                          <h3 className="text-sm font-semibold text-navy">{showArchived ? 'Archived' : 'Notifications'}</h3>
                        </div>
                        {!showArchived && (
                          <div className="flex items-center gap-3">
                            {unreadCount > 0 && (
                              <button onClick={handleMarkAllRead} className="text-[11px] text-blue-500 font-medium bg-transparent border-none cursor-pointer font-sans hover:text-blue-700">
                                Mark all as read
                              </button>
                            )}
                            {/* Notifications auto-archive after 24h — this is
                                the only way to reach that history from here. */}
                            <button onClick={toggleArchivedView} className="text-[11px] text-gray-400 font-medium bg-transparent border-none cursor-pointer font-sans hover:text-gray-600 flex items-center gap-1">
                              <Icons.Archive className="w-3 h-3" /> Archived
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="max-h-[360px] overflow-y-auto">
                        {showArchived ? (
                          loadingArchived ? (
                            <div className="py-10 text-center text-gray-400">
                              <p className="text-sm">Loading...</p>
                            </div>
                          ) : !archivedNotifications || archivedNotifications.length === 0 ? (
                            <div className="py-10 text-center text-gray-400">
                              <Icons.Archive className="w-8 h-8 mx-auto mb-2 opacity-30" />
                              <p className="text-sm">Nothing archived yet</p>
                              <p className="text-[11px] mt-1">Notifications move here 24h after they arrive.</p>
                            </div>
                          ) : (
                            archivedNotifications.slice(0, 20).map(n => (
                              <button
                                key={n.id}
                                onClick={() => handleNotifClick(n)}
                                className="w-full flex items-start gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer border-x-0 border-t-0 font-sans text-left hover:bg-gray-50 transition-colors bg-white opacity-70"
                              >
                                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                  {notifIcon(n.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[13px] font-medium text-gray-600">{n.title}</p>
                                  <p className="text-[12px] text-gray-500 line-clamp-2">{n.message}</p>
                                  <p className="text-[11px] text-gray-400 mt-0.5">{timeSince(n.created_at || n.createdAt)}</p>
                                </div>
                              </button>
                            ))
                          )
                        ) : notifications.length === 0 ? (
                          <div className="py-10 text-center text-gray-400">
                            <Icons.Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">No notifications yet</p>
                          </div>
                        ) : (
                          notifications.slice(0, 20).map(n => (
                            <button
                              key={n.id}
                              onClick={() => handleNotifClick(n)}
                              className={`w-full flex items-start gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer border-x-0 border-t-0 font-sans text-left hover:bg-gray-50 transition-colors ${!n.is_read ? 'bg-blue-50/50' : 'bg-white'}`}
                            >
                              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                {notifIcon(n.type)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-[13px] ${!n.is_read ? 'font-semibold text-gray-900' : 'font-medium text-gray-600'}`}>
                                  {n.title}
                                </p>
                                <p className="text-[12px] text-gray-500 line-clamp-2">{n.message}</p>
                                <p className="text-[11px] text-gray-400 mt-0.5">{timeSince(n.created_at || n.createdAt)}</p>
                              </div>
                              {!n.is_read && (
                                <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-2" />
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* User dropdown */}
              <div className="relative">
                <button
                  className="flex items-center gap-2.5 bg-transparent border-none text-white cursor-pointer font-sans"
                  onClick={() => { setDropdownOpen(!dropdownOpen); setNotifOpen(false); }}
                >
                  <div className="text-right hidden sm:block">
                    <p className="text-[13px] font-medium">{user?.name}</p>
                    <p className="text-[11px] opacity-70">{roleLabel(user?.role)}</p>
                  </div>
                  <Avatar letter={user?.avatar || user?.name?.[0]} className="bg-gold text-white" size="w-8 h-8 text-xs" />
                  <Icons.ChevronDown />
                </button>
              </div>
            </div>
          </header>

          {/* Offline banner — the page you're already on keeps working (data
              already loaded stays on screen; grade-encoding drafts keep
              saving locally, see useDraftState), but anything needing the
              server (loading a new page, submitting, refreshing) won't
              until this clears. */}
          {!isOnline && (
            <div className="bg-amber-50 text-amber-800 text-[12.5px] px-4 lg:px-7 py-2 flex items-center gap-2 border-b border-amber-100 sticky top-14 z-[80]">
              <Icons.AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              You're offline — showing the last loaded data. Some actions won't work until your connection is back.
            </div>
          )}

          {/* Dropdown menu */}
          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-[998]" onClick={() => setDropdownOpen(false)} />
              <div className="fixed top-[52px] right-4 lg:right-7 bg-white rounded-lg shadow-xl min-w-[200px] p-2 z-[999] border border-gray-100">
                <div className="px-3 py-2.5 border-b border-gray-100 mb-1">
                  <p className="text-sm font-semibold text-gray-900">{user?.name}</p>
                  <p className="text-xs text-gray-500">{user?.email}</p>
                </div>
                <button
                  onClick={() => { setDropdownOpen(false); navigate(`${roleBase}/profile`); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-gray-700 bg-transparent border-none cursor-pointer hover:bg-gray-50 font-sans"
                >
                  <Icons.User className="w-4 h-4" /> My Profile
                </button>
                <button
                  onClick={() => { setDropdownOpen(false); navigate(`${roleBase}/settings`); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-gray-700 bg-transparent border-none cursor-pointer hover:bg-gray-50 font-sans"
                >
                  <Icons.Settings className="w-4 h-4" /> Settings
                </button>
                <button onClick={() => { setDropdownOpen(false); setConfirmLogout(true); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-red-500 bg-transparent border-none cursor-pointer hover:bg-red-50 font-sans">
                  <Icons.LogOut className="w-4 h-4" /> Logout
                </button>
              </div>
            </>
          )}

          {/* Breadcrumb */}
          <div className="px-4 lg:px-7 py-3 text-[13px] text-gray-500 flex items-center gap-1.5">
            <span>Home</span>
            <Icons.ChevronRight className="w-3 h-3" />
            <span className="text-gold font-medium">{currentNav?.label}</span>
          </div>

          {/* Page content */}
          <main className="flex-1 px-4 lg:px-7 pb-7">
            {children}
          </main>

          <Footer />
        </div>

        {/* Data Privacy Act (RA 10173) — shown once, blocks nothing else once accepted.
            Rendered inside .theme-scope (fixed positioning means nesting depth
            doesn't affect its on-screen placement) so it also picks up dark mode. */}
        {needsPrivacyConsent && <PrivacyConsentModal onAccept={acceptPrivacyPolicy} />}
        {confirmLogout && (
          <ConfirmDialog
            title="Log out?"
            message="You'll need to sign in again to continue."
            confirmText="Log out"
            variant="red"
            onConfirm={() => { setConfirmLogout(false); handleLogout(); }}
            onCancel={() => setConfirmLogout(false)}
          />
        )}
      </div>
    </>
    );
  }