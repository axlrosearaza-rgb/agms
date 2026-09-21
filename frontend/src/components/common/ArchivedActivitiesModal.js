import { useState, useEffect, useCallback } from 'react';
import { dashboardService } from '../../services';
import { Avatar, Badge, LoadingSpinner, Modal } from '../common';

// Shared by the Admin Dashboard's "View Archived" (Activity + Login History)
// and the Chairperson Dashboard's own Activity Log — all three are the same
// paginated, aged-out slice of ActivityLog, just scoped differently server-
// side (see dashboardController.getActivities) and captioned with whatever
// window actually applies to that caller (`windowLabel`: Admin's is 7 days —
// 24h for promotion/regularization entries specifically — a Chairperson's own
// feed is a flat 24h for every action type).
export default function ArchivedActivitiesModal({ onClose, action, title = 'Archived Activities', emptyText = 'Nothing archived yet.', windowLabel = '7 days' }) {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const load = useCallback(async (p, q) => {
    try {
      setLoading(true);
      const { data } = await dashboardService.getActivities({ archived: true, page: p, limit: 20, ...(action ? { action } : {}), ...(q ? { search: q } : {}) });
      setRows(data?.activities || []);
      setPages(data?.pagination?.pages || 1);
      setTotal(data?.pagination?.total || 0);
    } catch (err) {
      // leave whatever was already loaded on screen
    } finally {
      setLoading(false);
    }
  }, [action]);

  useEffect(() => { load(page, search); }, [page, search, load]);

  // Debounce the search box so every keystroke doesn't fire a request —
  // resets to page 1 once the query actually changes.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const roleBadge = (role) => {
    const map = { Student: 'blue', Faculty: 'purple', Chairperson: 'orange', Admin: 'green' };
    return <Badge variant={map[role] || 'blue'}>{role}</Badge>;
  };

  const formatDateTime = (date) => {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    <Modal title={title} onClose={onClose} size="max-w-2xl">
      <p className="text-xs text-gray-500 -mt-2 mb-3">
        {action ? 'Logins' : 'Activity'} older than {windowLabel} — {total} record{total !== 1 ? 's' : ''} total.
      </p>
      <input
        type="text"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search by name or action..."
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy"
      />
      {loading ? (
        <LoadingSpinner />
      ) : rows.length === 0 ? (
        <p className="text-center py-8 text-gray-400 text-sm">
          {search ? `No activity matches "${search}".` : emptyText}
        </p>
      ) : (
        <div className="space-y-0 max-h-[50vh] overflow-y-auto">
          {rows.map((a) => {
            const userName = a.user?.name;
            const actionText = (userName && a.action?.toLowerCase().startsWith(userName.toLowerCase()))
              ? a.action.slice(userName.length).trim()
              : a.action;
            return (
              <div key={a.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                <Avatar letter={a.user?.avatar || userName?.[0] || '?'} className="bg-gray-400 text-white" size="w-7 h-7 text-xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px]">
                    <span className="font-semibold text-navy">{userName || 'System'}</span>{' '}
                    <span className="text-gray-600">{actionText}</span>
                  </p>
                  <p className="text-[11px] text-gray-400">{formatDateTime(a.created_at || a.createdAt)}</p>
                </div>
                {roleBadge(a.user?.role)}
              </div>
            );
          })}
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
          <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Previous
          </button>
          <span className="text-xs text-gray-500">Page {page} of {pages}</span>
          <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}
    </Modal>
  );
}
