import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { gradeService } from '../../services';
import { LoadingSpinner } from '../../components/common';
import ZoomControls, { nextZoom } from '../../components/common/ZoomControls';
import { buildGradingSheetDocx, normalizeStudentGrades } from '../../utils/gradingSheetDocx';
import { renderDocxInto } from '../../utils/docxToPdf';
import toast from 'react-hot-toast';

// The Grading Sheet, shown as the actual exported document.
//
// This page does not lay the sheet out itself. It builds the same .docx the
// Export button saves (utils/gradingSheetDocx.js, from the official SSU
// template) and draws that file on screen with the renderer the PDF exports
// use (utils/docxToPdf.js) — letterhead, form number, signature block, footer
// and all. A change to the export therefore shows up here on its own, and the
// two cannot differ.

export default function GradingSheet() {
  const { classId } = useParams();
  // Embedded as an iframe preview instead of opened in its own tab —
  // auto-print would pop a print dialog inside that preview otherwise, same
  // reasoning as ClassRecordView's isPreview.
  const [searchParams] = useSearchParams();
  const isPreview = searchParams.get('preview') === '1';
  const [loading, setLoading] = useState(true);
  const [docx, setDocx] = useState(null); // the built .docx, as a Blob
  const [missing, setMissing] = useState(false);
  const [drawn, setDrawn] = useState(null); // { width, height } of one page once it is on screen
  // Zoom: null = fit to the width (never larger than actual size), else a percentage.
  const [zoomPct, setZoomPct] = useState(null);
  const [fitScale, setFitScale] = useState(1);
  const hasAutoPrinted = useRef(false);
  const hostRef = useRef(null);
  const frameRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await gradeService.getByClass(classId);
        if (!data?.class) { if (!cancelled) setMissing(true); return; }
        const { blob } = await buildGradingSheetDocx({
          classData: data.class,
          studentGrades: normalizeStudentGrades(data.student_grades),
        });
        if (!cancelled) setDocx(blob);
      } catch (err) {
        if (!cancelled) { setMissing(true); toast.error('Failed to load grading sheet'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [classId]);

  // Draw the document once it is built.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !docx) return undefined;
    let cleanup = null;
    let cancelled = false;
    (async () => {
      try {
        cleanup = await renderDocxInto(host, docx);
        if (cancelled) return;
        const page = host.querySelector('section.docx');
        if (page) {
          const cs = getComputedStyle(page);
          setDrawn({ width: page.offsetWidth, height: parseFloat(cs.minHeight) || page.offsetHeight });
        }
      } catch (err) {
        console.error(err);
        toast.error('The grading sheet could not be displayed');
      }
    })();
    return () => { cancelled = true; if (cleanup) cleanup(); };
  }, [docx]);

  // Narrower than the page (a small pop-up, a phone): by default the page is
  // shrunk to fit the width instead of scrolling sideways. The zoom buttons
  // override that (zoomPct); "Fit" goes back. Printing is unaffected.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || !drawn) return undefined;
    const apply = () => {
      const available = document.documentElement.clientWidth - 24;
      const fit = Math.min(1, available / drawn.width);
      setFitScale(fit);
      frame.style.zoom = String(zoomPct ? zoomPct / 100 : fit);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [drawn, zoomPct]);
  const currentPct = Math.round((zoomPct ? zoomPct / 100 : fitScale) * 100);
  const zoomBy = (dir) => setZoomPct(nextZoom(currentPct, dir));

  // Opened in its own tab, this page prints itself once the document is drawn.
  useEffect(() => {
    if (isPreview || !drawn || hasAutoPrinted.current) return undefined;
    hasAutoPrinted.current = true;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [isPreview, drawn]);

  if (loading) return <LoadingSpinner />;
  if (missing || !docx) return <p className="p-10 text-center text-gray-400">Class not found.</p>;

  return (
    <div style={{ background: '#e9ecf1', minHeight: '100vh', padding: '12px', minWidth: 'max-content', boxSizing: 'border-box' }} className="gs-backdrop">
      <style>{`
        ${drawn ? `@page { size: ${drawn.width}px ${drawn.height}px; margin: 0; }` : ''}
        .gs-pages section.docx { margin: 0 auto 14px; box-shadow: 0 1px 6px rgba(0,0,0,0.18); }
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
          .gs-backdrop { background: #fff !important; padding: 0 !important; }
          .gs-frame { zoom: 1 !important; }
          .gs-pages section.docx { margin: 0 !important; box-shadow: none !important; break-after: page; }
          .gs-pages section.docx:last-child { break-after: auto; }
          .gs-pages * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {drawn && (
        <ZoomControls
          pct={currentPct}
          isFit={!zoomPct}
          onOut={() => zoomBy(-1)}
          onIn={() => zoomBy(1)}
          onFit={() => setZoomPct(null)}
        />
      )}

      {/* Hidden in preview mode (embedded inside a pop-up). */}
      {!isPreview && (
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, margin: '34px 0 12px', fontFamily: 'Arial, sans-serif' }}>
          <p style={{ fontSize: 12, color: '#666', margin: 0 }}>Print dialog opens automatically — use this if it didn't, or to print again.</p>
          <button onClick={() => window.print()} style={{ padding: '8px 16px', background: '#c9a84c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            Print
          </button>
        </div>
      )}

      <div ref={frameRef} className="gs-frame" style={{ width: 'max-content', margin: '0 auto' }}>
        <div ref={hostRef} className="gs-pages" />
      </div>
    </div>
  );
}
