// Floating − / % / + / Fit controls for the document previews (Class Record,
// Grade Sheet). Sits outside the zoomed document so it stays the same size,
// and is left out when the page is printed.
export const ZOOM_MIN = 30;
export const ZOOM_MAX = 200;

// The next 10% step up or down from wherever the zoom is now ("fit" can be any
// value, e.g. 66%).
export const nextZoom = (currentPct, dir) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (dir > 0 ? Math.floor(currentPct / 10) + 1 : Math.ceil(currentPct / 10) - 1) * 10));

export default function ZoomControls({ pct, isFit, onOut, onIn, onFit }) {
  const btn = { width: 30, height: 30, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: '#1a3a5c', borderRadius: 6, lineHeight: 1 };
  return (
    <div className="no-print" style={{ position: 'fixed', top: 10, right: 14, zIndex: 50, display: 'flex', alignItems: 'center', gap: 2, background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: 3, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', fontFamily: 'sans-serif' }}>
      <button type="button" style={{ ...btn, opacity: pct <= ZOOM_MIN ? 0.35 : 1 }} disabled={pct <= ZOOM_MIN} onClick={onOut} title="Zoom out" aria-label="Zoom out">−</button>
      <span style={{ minWidth: 46, textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#374151' }}>{pct}%</span>
      <button type="button" style={{ ...btn, opacity: pct >= ZOOM_MAX ? 0.35 : 1 }} disabled={pct >= ZOOM_MAX} onClick={onIn} title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" style={{ ...btn, width: 'auto', padding: '0 10px', fontSize: 12, fontWeight: 600, background: isFit ? '#e8eef5' : 'transparent' }} onClick={onFit} title="Fit the whole width">Fit</button>
    </div>
  );
}
