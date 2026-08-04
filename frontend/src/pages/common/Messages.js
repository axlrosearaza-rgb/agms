import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Icons, Avatar, Badge, LoadingSpinner, Modal, roleLabel } from '../../components/common';
import { chatService } from '../../services';
import socket from '../../services/socket';
import toast from 'react-hot-toast';

export default function Messages() {
  const { user } = useAuth();
  const location = useLocation();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactSearch, setContactSearch] = useState('');
  const bottomRef = useRef(null);
  // Pre-filled when arriving from a "Forward to Messages" action elsewhere (e.g.
  // Grade Approval) — carries who to message and what to say once the conversation opens.
  const prefill = location.state || null;

  const active = conversations.find((c) => c.id === activeId) || null;

  const loadConversations = useCallback(async () => {
    try {
      const { data } = await chatService.getConversations();
      setConversations(data.conversations || []);
    } catch (err) {
      toast.error('Failed to load conversations');
    } finally {
      setLoading(false);
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
      loadConversations();
    };
    const handleUpdate = () => loadConversations();

    socket.on('chat:message', handleMessage);
    socket.on('chat:conversationUpdate', handleUpdate);
    return () => {
      socket.off('chat:message', handleMessage);
      socket.off('chat:conversationUpdate', handleUpdate);
    };
  }, [activeId, loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!body.trim() || !activeId) return;
    const text = body.trim();
    setBody('');
    try {
      setSending(true);
      const { data } = await chatService.sendMessage(activeId, text);
      setMessages((prev) => [...prev, data.message]);
      loadConversations();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send message');
    } finally {
      setSending(false);
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

  // Arriving from "Forward to Messages" (e.g. Grade Approval) — jump straight into
  // the contact picker, pre-searched to the relevant person, rather than a blank list.
  useEffect(() => {
    if (prefill?.prefillContactName) {
      openContacts(prefill.prefillContactName);
    }
  }, []);

  const filteredContacts = contacts.filter((c) => {
    if (!contactSearch) return true;
    const q = contactSearch.toLowerCase();
    return c.name?.toLowerCase().includes(q) || roleLabel(c.role)?.toLowerCase().includes(q) || c.program?.toLowerCase().includes(q) || c.programs?.some((p) => p.toLowerCase().includes(q));
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

  const timeShort = (d) => d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

  if (loading) return <LoadingSpinner />;

  return (
    <>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-navy">Messages</h2>
        <p className="text-[13px] text-gray-500">Direct messages with staff and faculty</p>
      </div>

      <div className="card overflow-hidden" style={{ height: '70vh' }}>
        <div className="flex h-full">
          {/* Conversation list */}
          <div className="w-full sm:w-80 flex-shrink-0 border-r border-gray-100 flex flex-col">
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
                  <button
                    key={c.id}
                    onClick={() => openConversation(c.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-3 border-none border-b border-gray-50 cursor-pointer text-left font-sans transition-colors ${activeId === c.id ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}
                  >
                    <Avatar letter={c.other_user?.avatar || c.other_user?.name?.[0]} className="bg-navy text-white" size="w-9 h-9 text-sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-semibold truncate">{c.other_user?.name}</p>
                        {c.last_message_at && <span className="text-[10px] text-gray-400 flex-shrink-0">{timeShort(c.last_message_at)}</span>}
                      </div>
                      <p className="text-[11px] text-gray-500 truncate">{c.last_message?.body || 'No messages yet'}</p>
                    </div>
                    {c.is_muted && <Icons.VolumeX className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />}
                    {!c.is_muted && c.unread_count > 0 && (
                      <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center flex-shrink-0">
                        {c.unread_count}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Thread */}
          <div className="hidden sm:flex flex-1 flex-col">
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
                    <Avatar letter={active.other_user?.avatar || active.other_user?.name?.[0]} className="bg-navy text-white" size="w-8 h-8 text-xs" />
                    <div>
                      <p className="text-[13px] font-semibold">{active.other_user?.name}</p>
                      <Badge variant="blue">{roleLabel(active.other_user?.role)}</Badge>
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
                      return (
                        <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[70%] px-3.5 py-2 rounded-2xl text-sm ${mine ? 'bg-navy text-white' : 'bg-gray-100 text-gray-800'}`}>
                            <p>{m.body}</p>
                            <p className={`text-[10px] mt-0.5 ${mine ? 'text-white/60' : 'text-gray-400'}`}>{timeShort(m.created_at)}</p>
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
                  <button type="submit" className="btn btn-gold" disabled={sending || !body.trim()}>
                    <Icons.Send className="w-4 h-4" />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      {/* CONTACT PICKER MODAL */}
      {showContacts && (
        <Modal title="New Message" onClose={() => setShowContacts(false)}>
          <div className="mb-3">
            <input
              className="form-input w-full"
              placeholder="Search by name, role, or program..."
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
                  onClick={() => startConversation(c)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border-none bg-white hover:bg-gray-50 cursor-pointer text-left font-sans transition-colors"
                >
                  <Avatar letter={c.avatar || c.name?.[0]} className="bg-blue-500 text-white" size="w-8 h-8 text-xs" />
                  <div>
                    <p className="text-[13px] font-semibold">{c.name}</p>
                    <p className="text-[11px] text-gray-500">{roleLabel(c.role)}{(c.programs?.length ? ` · ${c.programs.join(', ')}` : c.program ? ` · ${c.program}` : '')}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
