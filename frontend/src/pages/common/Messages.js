import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Icons, Avatar, Badge, LoadingSpinner, Modal, ConfirmDialog, roleLabel, ProgramDot, programShortLabel, PresenceDot, PresenceLabel } from '../../components/common';
import { chatService } from '../../services';
import socket from '../../services/socket';
import { usePresence } from '../../hooks/usePresence';
import toast from 'react-hot-toast';
import { useDraftState } from '../../hooks/useDraftState';

// System messages (e.g. a returned Class Record/Grade Sheet) embed real
// in-app links using plain markdown-link syntax — "[label](/path)" — so the
// same message body works both here (rendered as a clickable jump straight
// to the document) and anywhere else that only shows the raw text.
const MESSAGE_LINK_RE = /\[([^\]]+)\]\((\/[a-zA-Z0-9\-_/?=&]+)\)/g;

// Renders a message body with any embedded [label](/path) links turned into
// clickable in-app navigation instead of literal bracket text.
function renderMessageBody(text, navigate, mine) {
  const parts = [];
  let lastIndex = 0;
  let match;
  let key = 0;
  const re = new RegExp(MESSAGE_LINK_RE);
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const [, label, path] = match;
    parts.push(
      <button
        key={`link-${key++}`}
        type="button"
        onClick={() => navigate(path)}
        className={`underline font-semibold cursor-pointer bg-transparent border-none p-0 font-sans ${mine ? 'text-white' : 'text-navy'} hover:opacity-80`}
      >
        {label}
      </button>
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

// Plain-text fallback (conversation list preview, forward preview) — same
// links read as their label only, no brackets/paths.
const stripMessageLinks = (text) => (text || '').replace(new RegExp(MESSAGE_LINK_RE), '$1');

// Same cap the sidebar's own unread badges use (AppLayout.js's navBadge) —
// a double-digit-plus count in a tiny round pill reads worse than it's worth
// and can overflow the badge itself, so anything past 9 just reads "9+".
const unreadLabel = (n) => (n > 9 ? '9+' : n);

export default function Messages() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  // Draft-persisted per conversation — switching conversations (or the key
  // changing at all) re-reads that conversation's own draft automatically
  // (see useDraftState), so a half-typed reply someone was interrupted
  // writing survives a refresh instead of just vanishing. handleSend's own
  // setBody('') below already writes the cleared value back out, so a sent
  // message never leaves a stale draft behind either.
  const [body, setBody] = useDraftState(`Messages.draft.${user?.id}.${activeId}`, '');
  const [showContacts, setShowContacts] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactSearch, setContactSearch] = useState('');
  // Editing a sent message in place — the bubble itself turns into a small
  // textarea instead of a separate modal, same as most chat apps.
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  // Confirm-before-delete — unlike edit, this can't be undone. The message
  // being considered; deciding WHAT clicking Delete actually offers (a
  // single "Delete" on someone else's message, or a choice between
  // "Delete for me" and "Unsend for everyone" on your own) happens in the
  // render below, off whether the caller sent it.
  const [deleteMsgTarget, setDeleteMsgTarget] = useState(null);
  const [unsending, setUnsending] = useState(false);
  // Reuses the exact same contact-picker Modal as "New Message" below — set
  // while forwarding, this message's own contacts click forwards TO them
  // instead of just opening a fresh conversation.
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const [forwarding, setForwarding] = useState(false);
  const bottomRef = useRef(null);
  // Live connection state, visible right on the page instead of only in the
  // browser console (see socket.js's own connect/connect_error/disconnect
  // logging) — the polling fallback elsewhere on this page means messages
  // still arrive within a few seconds either way, but "why does this feel
  // slow" is unanswerable without knowing whether the live socket path is
  // actually up.
  const [socketConnected, setSocketConnected] = useState(socket.connected);
  // Pre-filled when arriving from a "Forward to Messages" action elsewhere (e.g.
  // Grade Approval) — carries who to message and what to say once the conversation opens.
  const prefill = location.state || null;

  const active = conversations.find((c) => c.id === activeId) || null;

  // Everyone this page could plausibly show a name/avatar for right now —
  // conversation list, the open thread's own header, and the "New Message"
  // contact picker alike — tracked live via one shared hook (usePresence.js).
  const presence = usePresence([
    ...conversations.map((c) => c.other_user?.id),
    ...contacts.map((c) => c.id),
  ]);

  // Every incoming message fires loadConversations() at least once
  // (chat:conversationUpdate — see the socket effect below), so two
  // messages arriving close together kick off two overlapping REST
  // requests. Nothing guaranteed they'd resolve in the order they were
  // sent — a slower first response landing AFTER the second one would
  // silently overwrite the newer, correct state with stale data, making it
  // look like the second message's update never happened. This sequence
  // guard discards any response that isn't from the most recently fired
  // request, so a late straggler can never clobber a newer one.
  const conversationsRequestId = useRef(0);
  // The silent flag is for the fast background poll below — it must never toast,
  // or a brief backend hiccup would pop an error every couple of seconds.
  const loadConversations = useCallback(async (silent = false) => {
    const requestId = ++conversationsRequestId.current;
    try {
      const { data } = await chatService.getConversations();
      if (requestId !== conversationsRequestId.current) return;
      setConversations(data.conversations || []);
    } catch (err) {
      if (!silent && requestId === conversationsRequestId.current) toast.error('Failed to load conversations');
    } finally {
      if (requestId === conversationsRequestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const openConversation = useCallback(async (id) => {
    setActiveId(id);
    setLoadingMessages(true);
    try {
      const { data } = await chatService.getMessages(id);
      setMessages(data.messages || []);
      await chatService.markRead(id);
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
    } catch (err) {
      toast.error('Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    const handleMessage = ({ conversationId, message }) => {
      if (conversationId === activeId) {
        setMessages((prev) => [...prev, message]);
        chatService.markRead(conversationId).catch(() => {});
      }
      // Bumping unread_count/last_message locally here (instead of the
      // loadConversations() reload below) used to make the very first
      // message feel instant, but every message ALSO fires a separate
      // 'chat:conversationUpdate' (see handleUpdate) that reloads for real —
      // two messages arriving close together meant two of these local
      // bumps racing two REST reloads, and whichever REST response (from
      // either message) happened to resolve LAST won, regardless of which
      // one actually reflected more messages. That's what made the badge
      // look stuck at 1 no matter how many more came in. loadConversations()
      // is already guarded against a stale response clobbering a newer one
      // (see its own comment) — reusing that single path here instead of a
      // second, ungated local computation removes the second race outright.
      loadConversations();
    };
    const handleUpdate = () => loadConversations();

    // An edit on an existing message — same payload shape as chat:message
    // (conversationId + the full updated message), just replacing an
    // existing bubble in place instead of appending a new one.
    const handleMessageUpdated = ({ conversationId, message }) => {
      if (conversationId === activeId) {
        setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
      }
      loadConversations();
    };

    // A "delete for me" from one of the caller's OWN other tabs/devices
    // (see chatController.deleteMessageForMe) — the other participant never
    // gets this event, since nothing changed on their side.
    const handleMessageDeleted = ({ conversationId, messageId }) => {
      if (conversationId === activeId) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
      loadConversations();
    };

    socket.on('chat:message', handleMessage);
    socket.on('chat:conversationUpdate', handleUpdate);
    socket.on('chat:messageUpdated', handleMessageUpdated);
    socket.on('chat:messageDeleted', handleMessageDeleted);
    return () => {
      socket.off('chat:message', handleMessage);
      socket.off('chat:conversationUpdate', handleUpdate);
      socket.off('chat:messageUpdated', handleMessageUpdated);
      socket.off('chat:messageDeleted', handleMessageDeleted);
    };
  }, [activeId, loadConversations]);

  // Socket.io's targeted `io.to(room).emit(...)` chat delivery only reaches
  // a socket that's actually connected at that exact instant — a backgrounded
  // tab (browsers throttle/suspend those, which can drop the connection) or
  // any brief network blip means whatever arrived during that gap is gone
  // for good as far as the live handlers above are concerned, with nothing
  // to ever re-sync it. socket.io-client auto-reconnects on its own, but
  // reconnecting doesn't replay what was missed — so re-pull from the real
  // REST endpoints the moment a (re)connection lands, catching both a
  // fresh mount and any prior gap in one place.
  useEffect(() => {
    const handleConnect = () => {
      loadConversations();
      if (activeId) {
        chatService.getMessages(activeId)
          .then(({ data }) => setMessages(data.messages || []))
          .catch(() => {});
      }
    };
    socket.on('connect', handleConnect);
    return () => { socket.off('connect', handleConnect); };
  }, [activeId, loadConversations]);

  // Browsers throttle timers (setInterval/setTimeout) hard in a backgrounded
  // or unfocused tab — after a while, even the 5-second polling fallback
  // below can be clamped to once a minute or slower, which is invisible to
  // the app itself (the interval is still "running", just not firing on
  // schedule). Re-syncing the moment the tab becomes visible again — after
  // being minimized, switched away from, or the laptop waking from sleep —
  // catches up immediately instead of waiting on a throttled timer to
  // eventually fire, same reasoning as the reconnect handler just above.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      loadConversations();
      if (activeId) {
        chatService.getMessages(activeId)
          .then(({ data }) => setMessages(data.messages || []))
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [activeId, loadConversations]);

  useEffect(() => {
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // Polling safety net, on top of the socket push above — not a replacement
  // for it (the socket path is what makes this feel instant when it's
  // working), but a guarantee that a message shows up within a few seconds
  // regardless of *why* the WebSocket isn't delivering for a given browser
  // (a corporate proxy or extension blocking WS entirely, a dropped
  // connection socket.io hasn't finished reconnecting yet, etc.) — those
  // failure modes are invisible to the app itself, so rather than trying to
  // detect and react to each one, this just always keeps both the
  // conversation list and any open thread correct on its own.
  useEffect(() => {
    // Messenger-fast safety net: 1.5s while the tab is actually visible
    // (hidden tabs are skipped — the visibilitychange handler above catches
    // them up the moment they come back). Silent so failures never toast.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadConversations(true);
    }, 1500);
    return () => clearInterval(interval);
  }, [loadConversations]);

  useEffect(() => {
    if (!activeId) return undefined;
    const interval = setInterval(() => {
      chatService.getMessages(activeId).then(({ data }) => {
        const next = data.messages || [];
        setMessages((prev) => {
          // Skip the update (and the scroll-into-view it'd trigger) when
          // polling didn't actually find anything the socket path hadn't
          // already delivered — the common case once the socket is healthy.
          if (prev.length === next.length && prev.every((m, i) => m.id === next[i]?.id)) return prev;
          return next;
        });
        if (next.some((m) => m.sender_id !== user.id && !m.is_read)) {
          chatService.markRead(activeId).catch(() => {});
        }
      }).catch(() => {});
    }, 1200);
    return () => clearInterval(interval);
  }, [activeId, user.id]);

  // Depends on loadingMessages too, not just messages — openConversation
  // sets the new thread's messages WHILE loadingMessages is still true (the
  // LoadingSpinner branch is still what's on screen at that point), so a
  // scroll fired off that messages-only dependency landed on the spinner's
  // own near-empty container, not the real message list. By the time
  // loadingMessages actually flips to false and the real (much taller)
  // message list mounts, nothing re-fired to scroll it — the thread just
  // sat wherever the browser's default scroll position happened to leave
  // it (the top), not at the bottom. Jumps instantly (no smooth animation)
  // right when a conversation first opens — animating through however many
  // messages it holds looks worse than useful — and only scrolls smoothly
  // for a message arriving while the thread's already open.
  const openedRef = useRef(false);
  useEffect(() => {
    if (loadingMessages) { openedRef.current = true; return; }
    const behavior = openedRef.current ? 'auto' : 'smooth';
    openedRef.current = false;
    bottomRef.current?.scrollIntoView({ behavior });
  }, [messages, loadingMessages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!body.trim() || !activeId) return;
    const text = body.trim();
    setBody('');
    try {
      const { data } = await chatService.sendMessage(activeId, text);
      setMessages((prev) => [...prev, data.message]);
      loadConversations();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send message');
    }
  };

  const openContacts = async (initialSearch = '') => {
    setContactSearch(initialSearch);
    setShowContacts(true);
    try {
      const { data } = await chatService.getContacts();
      setContacts(data.contacts || []);
    } catch (err) {
      toast.error('Failed to load contacts');
    }
  };

  const startConversation = async (contact) => {
    try {
      const { data } = await chatService.startConversation(contact.id);
      setShowContacts(false);
      await loadConversations();
      await openConversation(data.conversation.id);
      if (prefill?.prefillText) setBody(prefill.prefillText);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to start conversation');
    }
  };

  // ====== Edit ======
  const startEdit = (m) => {
    setEditingId(m.id);
    setEditBody(m.body);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditBody('');
  };
  const saveEdit = async () => {
    if (!editBody.trim()) return;
    try {
      setSavingEdit(true);
      const { data } = await chatService.editMessage(editingId, editBody.trim());
      setMessages((prev) => prev.map((m) => (m.id === data.message.id ? data.message : m)));
      loadConversations();
      cancelEdit();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to edit message');
    } finally {
      setSavingEdit(false);
    }
  };

  // ====== Delete message (for me) ======
  // Removes the message from ONLY the caller's own view (see
  // chatController.deleteMessageForMe) — a real ConfirmDialog first, same
  // weight as deleting a whole conversation, since this can't be undone. The
  // other participant keeps their own copy untouched and never sees it go.
  const handleDeleteMessage = async () => {
    const target = deleteMsgTarget;
    setDeleteMsgTarget(null);
    if (!target) return;
    try {
      await chatService.deleteMessageForMe(target.id);
      setMessages((prev) => prev.filter((m) => m.id !== target.id));
      loadConversations();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete message');
    }
  };

  // ====== Unsend (for everyone) ======
  // Sender-only — pulls the SAME target message back for the OTHER
  // participant too, not just the caller's own view (see
  // chatController.unsendMessage). The recipient's own bubble flips to
  // "This message was unsent" live via the same 'chat:messageUpdated'
  // socket event editing already uses (handleMessageUpdated below), so no
  // separate handler is needed for that.
  const handleUnsendMessage = async () => {
    const target = deleteMsgTarget;
    if (!target) return;
    try {
      setUnsending(true);
      const { data } = await chatService.unsendMessage(target.id);
      setMessages((prev) => prev.map((m) => (m.id === target.id ? data.message : m)));
      loadConversations();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to unsend message');
    } finally {
      setUnsending(false);
      setDeleteMsgTarget(null);
    }
  };

  // ====== Forward ======
  const startForward = async (m) => {
    setForwardingMessage(m);
    setContactSearch('');
    setShowContacts(true);
    try {
      const { data } = await chatService.getContacts();
      setContacts(data.contacts || []);
    } catch (err) {
      toast.error('Failed to load contacts');
    }
  };
  const forwardToContact = async (contact) => {
    if (!forwardingMessage) return;
    try {
      setForwarding(true);
      await chatService.forwardMessage(forwardingMessage.id, contact.id);
      toast.success(`Forwarded to ${contact.name}`);
      setShowContacts(false);
      setForwardingMessage(null);
      loadConversations();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to forward message');
    } finally {
      setForwarding(false);
    }
  };

  // Arriving from "Forward to Messages" (e.g. Grade Approval) — jump straight into
  // the contact picker, pre-searched to the relevant person, rather than a blank list.
  useEffect(() => {
    if (prefill?.prefillContactName) {
      openContacts(prefill.prefillContactName);
    }
  }, []);

  const filteredContacts = contacts.filter((c) => {
    if (!contactSearch) return true;
    return c.name?.toLowerCase().includes(contactSearch.toLowerCase());
  });

  const toggleMute = async () => {
    if (!active) return;
    try {
      await chatService.toggleMute(active.id, !active.is_muted);
      setConversations((prev) => prev.map((c) => (c.id === active.id ? { ...c, is_muted: !c.is_muted } : c)));
    } catch (err) {
      toast.error('Failed to update mute setting');
    }
  };

  // Deleting only hides it from your own list — the other person's copy, and
  // the messages themselves, are untouched, and a new message from either
  // side brings it back (see chatController.deleteConversation).
  const [deleteTarget, setDeleteTarget] = useState(null);
  const handleDeleteConversation = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    try {
      await chatService.deleteConversation(target.id);
      setConversations((prev) => prev.filter((c) => c.id !== target.id));
      if (activeId === target.id) {
        setActiveId(null);
        setMessages([]);
      }
      toast.success('Conversation deleted');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete conversation');
    }
  };

  const timeShort = (d) => d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

  if (loading) return <LoadingSpinner />;

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-navy">Messages</h2>
          <p className="text-[13px] text-gray-500">Direct messages with staff and faculty</p>
        </div>
        {/* Live/offline readout for the realtime connection — messages still
            arrive either way (see the polling fallback above), just
            instantly when this is green instead of within a few seconds. */}
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
            socketConnected ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
          }`}
          title={socketConnected ? 'Realtime connection is up — new messages arrive instantly.' : 'Realtime connection is down — messages still arrive, just within a few seconds via periodic refresh.'}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${socketConnected ? 'bg-green-500' : 'bg-amber-500'}`} />
          {socketConnected ? 'Live' : 'Reconnecting…'}
        </span>
      </div>

      <div className="card overflow-hidden" style={{ height: '70vh' }}>
        <div className="flex h-full">
          {/* Conversation list — on mobile this and the thread pane are two
              separate full-width "screens" (only one visible at a time,
              swapped by whether a conversation is active); side by side from
              sm: up, same as before. Without this, the thread pane below
              being unconditionally `hidden` under sm: meant there was no way
              to actually read a conversation on a phone at all. */}
          <div className={`${active ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 flex-shrink-0 border-r border-gray-100 flex-col`}>
            <div className="p-3 border-b border-gray-100">
              <button className="btn btn-gold w-full text-sm" onClick={() => openContacts()}>
                <Icons.Plus className="w-4 h-4" /> New Message
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-10 px-4">
                  <Icons.MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No conversations yet.
                </div>
              ) : (
                conversations.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => openConversation(c.id)}
                    className={`group w-full flex items-center gap-2.5 px-3 py-3 border-b border-gray-50 cursor-pointer text-left font-sans transition-colors ${activeId === c.id ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}
                  >
                    <div className="relative flex-shrink-0">
                      <Avatar letter={c.other_user?.avatar || c.other_user?.name?.[0]} className="bg-navy text-white" size="w-9 h-9 text-sm" />
                      <PresenceDot presence={presence[c.other_user?.id]} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-semibold truncate">{c.other_user?.name}</p>
                        {c.last_message_at && <span className="text-[10px] text-gray-400 flex-shrink-0">{timeShort(c.last_message_at)}</span>}
                      </div>
                      <p className={`text-[11px] text-gray-500 truncate ${c.last_message?.deleted_at ? 'italic' : ''}`}>
                        {c.last_message ? (c.last_message.deleted_at ? 'Message was unsent' : stripMessageLinks(c.last_message.body)) : 'No messages yet'}
                      </p>
                    </div>
                    {c.is_muted && <Icons.VolumeX className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />}
                    {!c.is_muted && c.unread_count > 0 && (
                      // key={c.unread_count} restarts the pop animation
                      // every time this conversation's own count changes
                      // (another message, not just the first), so it stays
                      // noticeable in a list of conversations at a glance.
                      <span key={c.unread_count} className="badge-pop animate-pulse bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center flex-shrink-0">
                        {unreadLabel(c.unread_count)}
                      </span>
                    )}
                    <button
                      className="btn-icon flex-shrink-0 opacity-0 group-hover:opacity-100 hover:!bg-red-50 hover:!text-red-500"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }}
                      title="Delete conversation"
                    >
                      <Icons.Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Thread */}
          <div className={`${active ? 'flex' : 'hidden'} sm:flex flex-1 flex-col`}>
            {!active ? (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <Icons.MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">Select a conversation to start messaging</p>
                </div>
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-2.5">
                    {/* Back to the conversation list — only ever visible on
                        mobile, where the two panes are separate screens; from
                        sm: up both panes already show at once so there's
                        nothing to "go back" to. */}
                    <button
                      className="sm:hidden btn-icon flex-shrink-0 -ml-1"
                      onClick={() => setActiveId(null)}
                      title="Back to conversations"
                    >
                      <Icons.ArrowLeft className="w-4 h-4" />
                    </button>
                    <div className="relative flex-shrink-0">
                      <Avatar letter={active.other_user?.avatar || active.other_user?.name?.[0]} className="bg-navy text-white" size="w-8 h-8 text-xs" />
                      <PresenceDot presence={presence[active.other_user?.id]} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-white" />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold">{active.other_user?.name}</p>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="blue">{roleLabel(active.other_user?.role)}</Badge>
                        <PresenceLabel presence={presence[active.other_user?.id]} />
                      </div>
                    </div>
                  </div>
                  <button className="btn-icon" onClick={toggleMute} title={active.is_muted ? 'Unmute' : 'Mute'}>
                    {active.is_muted ? <Icons.VolumeX /> : <Icons.Volume2 />}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {loadingMessages ? (
                    <LoadingSpinner />
                  ) : messages.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 mt-8">No messages yet. Say hello!</p>
                  ) : (
                    messages.map((m) => {
                      const mine = m.sender_id === user.id;
                      const unsent = !!m.deleted_at;
                      const editing = editingId === m.id;
                      return (
                        <div key={m.id} className={`message-pop group flex items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                          {/* Hover-revealed actions — Forward on any real
                              (non-unsent) message from either side, Edit
                              only on your own. One Delete button either way
                              — what it actually offers is decided in the
                              dialog below, off whether the caller sent it:
                              a single "Delete" on someone else's message, a
                              choice between "Delete for me" and "Unsend for
                              everyone" on your own. Sits before the bubble
                              on your own messages (mirrors the bubble's own
                              right alignment) so it doesn't get clipped by
                              the thread's edge. */}
                          {!unsent && !editing && (
                            <div className={`flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ${mine ? 'order-first' : ''}`}>
                              {mine && (
                                <button className="btn-icon !w-6 !h-6" title="Edit" onClick={() => startEdit(m)}>
                                  <Icons.Edit className="w-3 h-3" />
                                </button>
                              )}
                              <button className="btn-icon !w-6 !h-6 hover:!bg-red-50 hover:!text-red-500" title="Delete" onClick={() => setDeleteMsgTarget(m)}>
                                <Icons.Trash className="w-3 h-3" />
                              </button>
                              <button className="btn-icon !w-6 !h-6" title="Forward" onClick={() => startForward(m)}>
                                <Icons.Forward className="w-3 h-3" />
                              </button>
                            </div>
                          )}

                          <div className={`${editing ? 'w-full max-w-[420px]' : 'max-w-[70%]'} px-3.5 py-2 rounded-2xl text-sm ${unsent ? `italic ${mine ? 'bg-navy/40 text-white/70' : 'bg-gray-100 text-gray-400'}` : mine ? 'bg-navy text-white' : 'bg-gray-100 text-gray-800'}`}>
                            {unsent ? (
                              <p>{mine ? 'You unsent a message' : 'This message was unsent'}</p>
                            ) : editing ? (
                              <div className="w-full min-w-[280px]">
                                <textarea
                                  className="form-input text-sm !text-navy w-full resize-y"
                                  rows={4}
                                  value={editBody}
                                  onChange={(e) => setEditBody(e.target.value)}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                                    if (e.key === 'Escape') cancelEdit();
                                  }}
                                />
                                <div className="flex justify-end gap-1.5 mt-1.5">
                                  <button className="text-[11px] px-2 py-1 rounded-md font-semibold border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 cursor-pointer font-sans" onClick={cancelEdit}>Cancel</button>
                                  <button className="text-[11px] px-2 py-1 rounded-md font-semibold border-none bg-gold text-white cursor-pointer font-sans disabled:opacity-50" onClick={saveEdit} disabled={savingEdit || !editBody.trim()}>
                                    {savingEdit ? 'Saving...' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {m.is_forwarded && (
                                  <p className={`text-[10px] italic flex items-center gap-1 mb-0.5 ${mine ? 'text-white/60' : 'text-gray-400'}`}>
                                    <Icons.Forward className="w-2.5 h-2.5" /> Forwarded
                                  </p>
                                )}
                                <p className="whitespace-pre-wrap">{renderMessageBody(m.body, navigate, mine)}</p>
                              </>
                            )}
                            {!editing && (
                              <p className={`text-[10px] mt-0.5 ${mine ? 'text-white/60' : 'text-gray-400'}`}>
                                {timeShort(m.created_at)}{!unsent && m.edited_at && ' · edited'}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>

                <form onSubmit={handleSend} className="p-3 border-t border-gray-100 flex gap-2 flex-shrink-0">
                  <input
                    className="form-input flex-1"
                    placeholder="Type a message..."
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                  {/* Not gated on `sending` — that used to disable Send
                      until the PREVIOUS message's own round trip finished,
                      so firing off several messages quickly meant each one
                      waited in line behind the last before it could even
                      leave this browser, adding real, avoidable delay
                      before the other person saw any of them. Each send
                      below already runs independently (own try/catch), so
                      nothing requires them to be serialized like that. */}
                  <button type="submit" className="btn btn-gold" disabled={!body.trim()}>
                    <Icons.Send className="w-4 h-4" />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      {/* CONTACT PICKER MODAL — doubles as the Forward target picker when
          forwardingMessage is set (see startForward), same list/search,
          just a different action once a contact is actually clicked. */}
      {showContacts && (
        <Modal
          title={forwardingMessage ? 'Forward Message' : 'New Message'}
          onClose={() => { setShowContacts(false); setForwardingMessage(null); }}
        >
          {forwardingMessage && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Forwarding</p>
              <p className="text-[13px] text-gray-700 truncate">{stripMessageLinks(forwardingMessage.body)}</p>
            </div>
          )}
          <div className="mb-3">
            <input
              className="form-input w-full"
              placeholder="Search by name..."
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              autoFocus
            />
          </div>
          {filteredContacts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              {contacts.length === 0 ? 'No contacts available.' : 'No contacts match your search.'}
            </p>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {filteredContacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => (forwardingMessage ? forwardToContact(c) : startConversation(c))}
                  disabled={forwarding}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border-none bg-white hover:bg-gray-50 cursor-pointer text-left font-sans transition-colors disabled:opacity-50"
                >
                  <div className="relative flex-shrink-0">
                    <Avatar letter={c.avatar || c.name?.[0]} className="bg-blue-500 text-white" size="w-8 h-8 text-xs" />
                    <PresenceDot presence={presence[c.id]} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-white" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold">{c.name}</p>
                    <p className="text-[11px] text-gray-500 flex items-center gap-1.5 flex-wrap">
                      <span>{roleLabel(c.role)}</span>
                      {c.employment_type === 'Part Time' ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full flex-shrink-0 inline-block bg-amber-400" />Part Timer
                        </span>
                      ) : (c.programs?.length ? c.programs : c.program ? [c.program] : []).map((p) => (
                        <span key={p} className="inline-flex items-center gap-1">
                          <ProgramDot program={p} />{programShortLabel(p)}
                        </span>
                      ))}
                      <PresenceLabel presence={presence[c.id]} />
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Conversation"
          message={`Delete your conversation with ${deleteTarget.other_user?.name || 'this person'}? It'll only be removed from your own list — they'll still see it, and it'll come back if either of you sends a new message.`}
          confirmText="Delete"
          variant="red"
          onConfirm={handleDeleteConversation}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* On your OWN message, Delete offers an actual choice — "Delete for
          me" (only your own view changes) vs "Unsend for everyone" (the
          other person's copy changes too) — instead of picking one
          automatically. On a message you RECEIVED, there's nothing to
          choose: only your own view can ever change, so it's the plain
          single-button confirm below. */}
      {deleteMsgTarget && deleteMsgTarget.sender_id === user.id ? (
        <Modal title="Delete Message" onClose={() => setDeleteMsgTarget(null)} footer={
          <>
            <button className="btn btn-outline" onClick={() => setDeleteMsgTarget(null)} disabled={unsending}>Cancel</button>
            <button className="btn btn-outline !text-red-600 !border-red-200 hover:!bg-red-50" onClick={handleDeleteMessage} disabled={unsending}>Delete for me</button>
            <button className="btn btn-red" onClick={handleUnsendMessage} disabled={unsending}>{unsending ? 'Unsending...' : 'Unsend for everyone'}</button>
          </>
        }>
          <p className="text-sm text-gray-600">
            <strong>Delete for me</strong> only removes it from your own view — {active?.other_user?.name || 'the other person'} keeps their copy.{' '}
            <strong>Unsend for everyone</strong> actually replaces it with "This message was unsent" for both of you. Neither can be undone.
          </p>
        </Modal>
      ) : deleteMsgTarget && (
        <ConfirmDialog
          title="Delete Message"
          message="Delete this message? It'll only be removed from your own view — the other person keeps their copy and won't see anything change. This cannot be undone."
          confirmText="Delete"
          variant="red"
          onConfirm={handleDeleteMessage}
          onCancel={() => setDeleteMsgTarget(null)}
        />
      )}
    </>
  );
}
