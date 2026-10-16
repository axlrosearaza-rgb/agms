import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { gradeService } from '../../services';
import API from '../../services/api';
import { LoadingSpinner } from '../../components/common';
import ZoomControls, { nextZoom } from '../../components/common/ZoomControls';
import { buildClassRecordWorkbook, formatGrade } from '../../utils/classRecordExcel';
import { renderWorksheet, applyShrinkToFit } from '../../utils/excelSheetPreview';
import toast from 'react-hot-toast';

// The Class Record, shown as the actual exported spreadsheet.
//
// This page does not lay the record out itself. It builds the same workbook
// the Export button saves (utils/classRecordExcel.js) and draws that workbook
// on screen (utils/excelSheetPreview.js) — every column width, colour, merged
// heading, rotated label, seal and number is read from the file. A change to
// the export therefore shows up here on its own, and the two cannot differ.

// Legal paper, landscape, with the export's own margins: the printable width.
const PRINT_WIDTH_PX = (14 - 0.5) * 96;

export default function ClassRecordView() {
  const { classId } = useParams();
  // Embedded as an iframe preview (e.g. /class-record/123?preview=1) instead
  // of opened as its own tab — the auto-print below would otherwise pop a
  // print dialog *inside* that preview, which makes no sense there.
  const [searchParams] = useSearchParams();
  const isPreview = searchParams.get('preview') === '1';
  const [loading, setLoading] = useState(true);
  // 'ready' | 'empty' (no components yet) | 'missing' (class not found) | 'error'
  const [state, setState] = useState('ready');
  const [sheet, setSheet] = useState(null); // { element, width, height, release }
  const hasAutoPrinted = useRef(false);
  const rootRef = useRef(null);
  const sheetHostRef = useRef(null);
  // Preview zoom: null = fit to width (default), else a percentage.
  const [zoomPct, setZoomPct] = useState(null);
  const [fitScale, setFitScale] = useState(1);

  useEffect(() => {
    let drawn = null;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await gradeService.getByClass(classId);
        if (!data?.class) { setState('missing'); return; }
        // The same shape the Export buttons hand to the workbook builder.
        const studentGrades = (data.student_grades || []).map((sg) => ({
          student: sg.student,
          midterm: sg.grade?.midterm ? formatGrade(sg.grade.midterm) : '',
          finals: sg.grade?.finals ? formatGrade(sg.grade.finals) : '',
          average: sg.grade?.average ?? null,
          status: sg.grade?.status || 'Pending',
          inc_remarks: sg.grade?.inc_remarks || '',
          inc_deadline: sg.grade?.inc_deadline || null,
          inc_resolved_date: sg.grade?.inc_resolved_date || null,
          inc_lapsed_at: sg.grade?.inc_lapsed_at || null,
          inc_lapsed_period: sg.grade?.inc_lapsed_period || null,
          inc_midterm: !!sg.grade?.inc_midterm,
          inc_finals: !!sg.grade?.inc_finals,
        }));
        const [compRes, scoreRes] = await Promise.all([
          API.get(`/grade-components/${classId}/components`),
          API.get(`/grade-components/${classId}/scores`),
        ]);
        const workbook = await buildClassRecordWorkbook({
          classData: data.class,
          components: compRes.data.components || [],
          studentGrades,
          componentScores: scoreRes.data.scores || {},
        });
        if (!workbook) { setState('empty'); return; }
        drawn = renderWorksheet(workbook, workbook.worksheets[0]);
        if (cancelled) { drawn.release(); return; }
        setSheet(drawn);
        setState('ready');
      } catch (err) {
        if (err?.response?.status === 404) setState('missing');
        else { setState('error'); toast.error('Failed to load class record'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; if (drawn) drawn.release(); };
  }, [classId]);

  // Put the drawn sheet on the page.
  useLayoutEffect(() => {
    const host = sheetHostRef.current;
    if (!host || !sheet) return;
    host.replaceChildren(sheet.element);
    applyShrinkToFit(host);
  }, [sheet]);

  // Opened in its own tab, this page prints itself once the sheet (and its
  // seals) is drawn. Guarded to fire only once per visit.
  useEffect(() => {
    if (isPreview || !sheet || hasAutoPrinted.current) return undefined;
    hasAutoPrinted.current = true;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [isPreview, sheet]);

  // Preview (inside a pop-up): the Midterm + Finals halves side by side are
  // far wider than the pop-up, so by default the whole record is shrunk to
  // fit its width — everything visible at once, scrolling only downward.
  // Re-fitted whenever the pop-up is resized. The zoom buttons override it
  // (zoomPct); "Fit" goes back. Printing is unaffected.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!isPreview || !el || !sheet) return undefined;
    const apply = () => {
      const natural = sheet.width + 28; // the sheet plus this page's side padding
      const available = document.documentElement.clientWidth;
      // A few px of slack so rounding never leaves a sliver of sideways scroll.
      const fit = natural > available ? (available - 4) / natural : 1;
      setFitScale(fit);
      el.style.zoom = String(zoomPct ? zoomPct / 100 : fit);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [isPreview, sheet, zoomPct]);
  const currentPct = Math.round((zoomPct ? zoomPct / 100 : fitScale) * 100);
  // Steps of 10% from wherever it is now (fit can be any value, e.g. 66%).
  const zoomBy = (dir) => setZoomPct(nextZoom(currentPct, dir));

  if (loading) return <LoadingSpinner />;
  if (state === 'missing') return <p className="p-10 text-center text-gray-400">Class not found.</p>;
  if (state === 'error') return <p className="p-10 text-center text-gray-400">The class record could not be loaded.</p>;

  // On paper the sheet is scaled to one page wide, as the exported file's own
  // "fit to 1 page wide" print setting does.
  const printZoom = sheet ? Math.min(1, PRINT_WIDTH_PX / sheet.width) : 1;

  return (
    <>
      {isPreview && sheet && (
        <ZoomControls
          pct={currentPct}
          isFit={!zoomPct}
          onOut={() => zoomBy(-1)}
          onIn={() => zoomBy(1)}
          onFit={() => setZoomPct(null)}
        />
      )}
      <div ref={rootRef} className="cr-print-root" style={{ color: '#111', margin: '0 auto', padding: '12px 14px', width: 'max-content', minWidth: isPreview ? '100%' : undefined, boxSizing: 'border-box' }}>
        <style>{`
          @page { size: 14in 8.5in; margin: 0.3in 0.25in; }
          @media print {
            .no-print { display: none !important; }
            body { margin: 0; }
            .cr-print-root { padding: 0 !important; zoom: 1 !important; }
            .cr-sheet-host { zoom: ${printZoom}; }
            .xl-sheet td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        `}</style>

        {/* Hidden in preview mode (embedded read-only inside a pop-up):
            there is no auto-print to explain there. */}
        {!isPreview && (
          <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 16, fontFamily: 'Arial, sans-serif' }}>
            <p style={{ fontSize: 12, color: '#888', margin: 0 }}>Print dialog opens automatically — use this if it didn't, or to print again.</p>
            <button onClick={() => window.print()} style={{ padding: '8px 16px', background: '#c9a84c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              Print
            </button>
          </div>
        )}

        {state === 'empty' ? (
          <p className="p-10 text-center text-gray-400">This class has no Class Record components set up yet.</p>
        ) : (
          <div ref={sheetHostRef} className="cr-sheet-host" />
        )}
      </div>
    </>
  );
}
