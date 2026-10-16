import { useRef, useState, useLayoutEffect } from 'react';

// A small window that floats over the page and can be dragged anywhere by its
// title bar. It has no dark backdrop and blocks nothing behind it, so whatever
// is underneath (a Class Record or Grade Sheet being reviewed) stays visible
// and usable while the person types in it.
//
// Sits above a Modal (z 1000). Starts at the lower right of the window.
export default function FloatingPanel({ title, onClose, children, footer, width = 420 }) {
  const boxRef = useRef(null);
  const drag = useRef(null);
  const [pos, setPos] = useState(null); // { left, top } once measured

  // Keep the whole panel inside the window.
  const clamp = (left, top) => {
    const el = boxRef.current;
    const w = el ? el.offsetWidth : width;
    const h = el ? el.offsetHeight : 200;
    return {
      left: Math.min(Math.max(8, left), Math.max(8, window.innerWidth - w - 8)),
      top: Math.min(Math.max(8, top), Math.max(8, window.innerHeight - h - 8)),
    };
  };

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    setPos(clamp(window.innerWidth - el.offsetWidth - 28, window.innerHeight - el.offsetHeight - 96));
    const onResize = () => setPos((p) => (p ? clamp(p.left, p.top) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Pointer capture keeps the drag going even when the cursor crosses the
  // document preview underneath (an iframe would otherwise swallow the moves).
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const el = boxRef.current;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
  };
  const onPointerUp = (e) => {
    if (!drag.current) return;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  };

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label={typeof title === 'string' ? title : undefined}
      className="fixed z-[1001] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col"
      style={{ width, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)', left: pos ? pos.left : -9999, top: pos ? pos.top : -9999 }}
    >
      <div
        className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 rounded-t-xl bg-gray-50 select-none"
        style={{ cursor: 'move', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title="Drag to move"
      >
        <h3 className="text-sm font-semibold text-gray-800 truncate">{title}</h3>
        <button type="button" className="btn-icon" onClick={onClose} title="Close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="px-4 py-3 overflow-y-auto">{children}</div>
      {footer && <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-end gap-2">{footer}</div>}
    </div>
  );
}
