  import { useState, useEffect, useCallback } from 'react';
  import { Link, useLocation, useNavigate } from 'react-router-dom';
  import { useAuth } from '../../context/AuthContext';
  import { Avatar, Icons, roleLabel } from '../common';
  import { notificationService, userService } from '../../services';
  import socket from '../../services/socket';

  const ROLE_HOME = {
    Admin: '/admin',
    Chairperson: '/chairperson',
    Instructor: '/instructor',
    Student: '/student',
  };

  export default function AppLayout({ children, navItems }) {
    const { user, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [notifOpen, setNotifOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [pendingStudents, setPendingStudents] = useState(0);

    const isActive = (path) => {
      const roleHome = ROLE_HOME[user?.role];
      if (path === roleHome) return location.pathname === path;
      return location.pathname.startsWith(path);
    };

    const currentNav = navItems.find((n) => isActive(n.path)) || navItems[0];

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

    const loadPendingCount = useCallback(async () => {
      if (user?.role !== 'Instructor') return;
      try {
        const { data } = await userService.getPending();
        setPendingStudents(data.users?.length || 0);
      } catch (err) {}
    }, [user?.role]);

    useEffect(() => {
      if (user) {
        loadNotifications();
        loadPendingCount();
      }
    }, [user, loadNotifications, loadPendingCount]);

    useEffect(() => {
      if (user?.role === 'Instructor') {
        loadPendingCount();
      }
    }, [location.pathname, user?.role, loadPendingCount]);

    useEffect(() => {
      if (!user) return;
      const handleNewNotification = (notif) => {
        setNotifications(prev => [notif, ...prev]);
        setUnreadCount(prev => prev + 1);
        if (user.role === 'Instructor') loadPendingCount();
      };
      socket.on(`notification:${user.id}`, handleNewNotification);
      return () => { socket.off(`notification:${user.id}`, handleNewNotification); };
    }, [user, loadPendingCount]);

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

    const handleNotifClick = (notif) => {
      if (!notif.is_read) handleMarkAsRead(notif.id);
      if (notif.link) navigate(notif.link);
      setNotifOpen(false);
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

    const notifIcon = (type) => {
      switch (type) {
        case 'registration': return <Icons.Users className="w-4 h-4 text-blue-500" />;
        case 'grade':        return <Icons.FileText className="w-4 h-4 text-green-500" />;
        case 'endorsement':  return <Icons.Award className="w-4 h-4 text-purple-500" />;
        case 'promotion':    return <Icons.Award className="w-4 h-4 text-gold" />;
        default:             return <Icons.Bell className="w-4 h-4 text-gray-400" />;
      }
    };

    const roleBase = ROLE_HOME[user?.role] || '/';
    const sidebarWidth = sidebarCollapsed ? 'w-[72px]' : 'w-[260px]';
    const mainMargin = sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[260px]';

    return (
      <div className="min-h-screen bg-gray-50/50">
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
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                title={sidebarCollapsed ? item.label : undefined}
                className={`nav-item no-underline relative ${isActive(item.path) ? 'active' : ''} ${sidebarCollapsed ? '!justify-center !px-0' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                {item.icon}
                {!sidebarCollapsed && (
                  <span className="flex-1">{item.label}</span>
                )}
                {!sidebarCollapsed && item.path === '/instructor/verify' && pendingStudents > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
                    {pendingStudents}
                  </span>
                )}
                {sidebarCollapsed && item.path === '/instructor/verify' && pendingStudents > 0 && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />
                )}
              </Link>
            ))}
          </nav>

          {/* User info + sign out */}
          <div className={`p-4 border-t border-gray-100 ${sidebarCollapsed ? 'flex flex-col items-center' : ''}`}>
            {sidebarCollapsed ? (
              <>
                <Avatar letter={user?.avatar || user?.name?.[0]} className="bg-gold text-white mb-2" size="w-8 h-8 text-xs" />
                <button onClick={handleLogout} className="w-8 h-8 flex items-center justify-center border border-red-400 text-red-500 bg-transparent rounded-lg cursor-pointer hover:bg-red-50 transition-colors" title="Sign Out">
                  <Icons.LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5 mb-3">
                  <Avatar letter={user?.avatar || user?.name?.[0]} className="bg-gold text-white" size="w-8 h-8 text-xs" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate">{user?.name}</p>
                    <p className="text-[11px] text-gold font-medium">{roleLabel(user?.role)}</p>
                  </div>
                </div>
                <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 py-2.5 border border-red-400 text-red-500 bg-transparent rounded-lg cursor-pointer text-[13px] font-medium font-sans hover:bg-red-50 transition-colors">
                  <Icons.LogOut className="w-4 h-4" /> Sign Out
                </button>
              </>
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
                  onClick={() => { setNotifOpen(!notifOpen); setDropdownOpen(false); }}
                  className="relative bg-transparent border-none text-white cursor-pointer opacity-80 hover:opacity-100 p-1"
                >
                  <Icons.Bell />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 leading-none animate-pulse">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-[998]" onClick={() => setNotifOpen(false)} />
                    <div className="absolute right-0 top-[42px] w-[340px] bg-white rounded-xl shadow-2xl z-[999] border border-gray-100 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-navy">Notifications</h3>
                        {unreadCount > 0 && (
                          <button onClick={handleMarkAllRead} className="text-[11px] text-blue-500 font-medium bg-transparent border-none cursor-pointer font-sans hover:text-blue-700">
                            Mark all as read
                          </button>
                        )}
                      </div>
                      <div className="max-h-[360px] overflow-y-auto">
                        {notifications.length === 0 ? (
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
                <button onClick={() => { setDropdownOpen(false); handleLogout(); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-red-500 bg-transparent border-none cursor-pointer hover:bg-red-50 font-sans">
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
        </div>
      </div>
    );
  }