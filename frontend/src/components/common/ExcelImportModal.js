import React, { useState, useEffect } from 'react';
import { Icons, Badge, formatPersonName, useEscapeToClose, closeAllModals } from './index';
import toast from 'react-hot-toast';

export default function ExcelImportModal({
  isOpen,
  onClose,
  importResult,
  onApplyScores,
  onReupload,
}) {
  useEscapeToClose(onClose, !!isOpen);
  const [activePeriod, setActivePeriod] = useState('All'); // 'All' | 'Midterm' | 'Finals'
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'issues_only'
  const [editableScores, setEditableScores] = useState({}); // { [studentId]: { [itemId]: value } }
  const [cellIssues, setCellIssues] = useState({}); // { [studentId]: { [itemId]: { error, warning } } }

  // Sync state whenever importResult changes
  useEffect(() => {
    if (!importResult) return;

    const scores = {};
    const issues = {};

    importResult.students.forEach((sv) => {
      const studentId = sv.student.id;
      scores[studentId] = {};
      issues[studentId] = {};

      Object.entries(sv.items).forEach(([itemId, it]) => {
        scores[studentId][itemId] = it.value !== null && it.value !== undefined ? it.value : '';
        issues[studentId][itemId] = {
          error: it.error,
          warning: it.warning,
        };
      });
    });

    setEditableScores(scores);
    setCellIssues(issues);
  }, [importResult]);

  if (!isOpen || !importResult) return null;

  const { items = [], summary = {}, unenrolledStudents = [], fileName = '' } = importResult;

  // Filter items by period
  const filteredItems = items.filter((it) => {
    if (activePeriod === 'All') return true;
    return it.period === activePeriod;
  });

  // Calculate live errors and warnings based on user edits
  let liveErrorCount = 0;
  let liveWarningCount = 0;
  let liveScoresCount = 0;

  importResult.students.forEach((sv) => {
    const studentId = sv.student.id;
    filteredItems.forEach((it) => {
      const val = editableScores[studentId]?.[it.id];
      const issue = cellIssues[studentId]?.[it.id];
      if (issue?.error) liveErrorCount++;
      if (issue?.warning && (val === '' || val === null || val === undefined)) liveWarningCount++;
      if (val !== '' && val !== null && val !== undefined && !isNaN(parseFloat(val))) {
        liveScoresCount++;
      }
    });
  });

  // Handle cell edit and re-evaluate validity live
  const handleScoreChange = (studentId, item, rawValue) => {
    const nextScores = {
      ...editableScores,
      [studentId]: {
        ...(editableScores[studentId] || {}),
        [item.id]: rawValue,
      },
    };
    setEditableScores(nextScores);

    // Live validation
    let error = null;
    let warning = null;
    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      warning = 'Blank score in spreadsheet.';
    } else {
      const num = parseFloat(rawValue);
      const max = parseFloat(item.max_score) || 100;
      if (isNaN(num)) {
        error = 'Value must be a valid number.';
      } else if (num < 0) {
        error = 'Score cannot be negative.';
      } else if (num > max) {
        error = `Score (${num}) exceeds maximum of ${max}.`;
      }
    }

    setCellIssues((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || {}),
        [item.id]: { error, warning },
      },
    }));
  };

  // Filter students based on filterMode
  const displayedStudents = importResult.students.filter((sv) => {
    if (filterMode === 'all') return true;
    const studentId = sv.student.id;
    return filteredItems.some((it) => {
      const issue = cellIssues[studentId]?.[it.id];
      return issue?.error || issue?.warning;
    });
  });

  // Apply scores
  const handleApply = () => {
    if (liveErrorCount > 0) {
      toast.error('Please fix all red error scores before applying.');
      return;
    }

    if (liveScoresCount === 0) {
      toast.error('No scores found to apply.');
      return;
    }

    // Convert scores to numbers
    const cleanScores = {};
    Object.entries(editableScores).forEach(([studentId, itemObj]) => {
      cleanScores[studentId] = {};
      Object.entries(itemObj || {}).forEach(([itemId, val]) => {
        if (val !== '' && val !== null && val !== undefined) {
          const num = parseFloat(val);
          if (!isNaN(num)) {
            cleanScores[studentId][itemId] = num;
          }
        }
      });
    });

    const activeItemIds = filteredItems.map((it) => it.id);
    onApplyScores(cleanScores, activeItemIds, activePeriod === 'All' ? null : activePeriod);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-3 sm:p-5 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-[96vw] xl:max-w-7xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden border border-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-[#14532d] to-[#15803d] text-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-emerald-300">
              <Icons.FileText className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold">Import Class Record from Excel</h3>
                <span className="text-[11px] font-semibold bg-emerald-400 text-emerald-950 px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                  <Icons.Check className="w-3 h-3" /> Smart Mistake Validator
                </span>
              </div>
              <p className="text-xs text-emerald-100/90">
                Uploaded: <span className="font-mono underline">{fileName}</span> — Reviewed and checked for mistakes before applying.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose?.();
            }}
            title="Close"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>

        {/* Validation Status Banner & Metrics */}
        <div className="px-6 py-3.5 bg-slate-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-4 flex-shrink-0">
          {/* Main Validation Result Message */}
          <div className="flex items-center gap-3">
            {liveErrorCount > 0 ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-100/80 border border-red-300 text-red-800 text-xs font-semibold">
                <Icons.AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <span>Found {liveErrorCount} mistake(s) in spreadsheet. You can correct the red boxes below.</span>
              </div>
            ) : liveWarningCount > 0 ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-100/80 border border-amber-300 text-amber-800 text-xs font-semibold">
                <Icons.AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span>Spreadsheet verified with {liveWarningCount} blank/empty score warnings. Ready to apply.</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-100/80 border border-emerald-300 text-emerald-800 text-xs font-semibold">
                <Icons.Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>All scores verified cleanly with zero mistakes! Ready to apply.</span>
              </div>
            )}
          </div>

          {/* Metric Badges */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="px-2.5 py-1 rounded-md bg-white border border-gray-200 font-medium text-gray-700 shadow-xs">
              Students Matched: <strong className="text-navy">{summary.matchedStudents}/{summary.totalEnrolled}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-md bg-white border border-gray-200 font-medium text-gray-700 shadow-xs">
              Scores Parsed: <strong className="text-emerald-700">{liveScoresCount}</strong>
            </span>
            {liveErrorCount > 0 && (
              <span className="px-2.5 py-1 rounded-md bg-red-50 border border-red-200 font-bold text-red-700 shadow-xs flex items-center gap-1">
                Errors: {liveErrorCount}
              </span>
            )}
            {liveWarningCount > 0 && (
              <span className="px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 font-semibold text-amber-700 shadow-xs">
                Blanks: {liveWarningCount}
              </span>
            )}
          </div>
        </div>

        {/* Toolbar: Period Filter & Issues-Only Toggle */}
        <div className="px-6 py-2.5 bg-white border-b border-gray-100 flex items-center justify-between flex-wrap gap-3 flex-shrink-0 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-gray-500 font-bold uppercase tracking-wider text-[11px]">Period View:</span>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 shadow-xs">
              {['All', 'Midterm', 'Finals'].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setActivePeriod(p)}
                  className={`px-3 py-1 font-semibold rounded-md transition-all ${
                    activePeriod === p ? 'bg-navy text-white shadow-xs' : 'text-gray-600 hover:text-navy'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-gray-200" />

            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 shadow-xs">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1 font-semibold rounded-md transition-all ${
                  filterMode === 'all' ? 'bg-white text-navy shadow-xs border border-gray-200' : 'text-gray-600 hover:text-navy'
                }`}
              >
                All Students ({importResult.students.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('issues_only')}
                className={`px-3 py-1 font-semibold rounded-md transition-all ${
                  filterMode === 'issues_only' ? 'bg-amber-100 text-amber-900 shadow-xs font-bold' : 'text-gray-600 hover:text-navy'
                }`}
              >
                Mistakes &amp; Blanks Only
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onReupload}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium underline flex items-center gap-1"
          >
            <Icons.Upload className="w-3.5 h-3.5" /> Choose different Excel file
          </button>
        </div>

        {/* Unenrolled Students Notice (if spreadsheet has stranger rows) */}
        {unenrolledStudents.length > 0 && (
          <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800 flex items-center gap-2">
            <Icons.AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>
              <strong>Note:</strong> Found {unenrolledStudents.length} student row(s) in Excel that are not enrolled in this section (e.g. {unenrolledStudents[0].name || unenrolledStudents[0].studentNo}). They are skipped automatically.
            </span>
          </div>
        )}

        {/* Main Data Table */}
        <div className="flex-1 overflow-auto p-6 bg-slate-50/50">
          <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 text-gray-700 font-semibold border-b border-gray-200 sticky top-0 z-20 shadow-xs">
                  <tr>
                    <th className="py-3 px-3 text-center w-10 bg-slate-100 sticky left-0 z-30 shadow-r">#</th>
                    <th className="py-3 px-3 w-28 bg-slate-100 sticky left-10 z-30 shadow-r">Student No.</th>
                    <th className="py-3 px-4 min-w-[160px] bg-slate-100 sticky left-38 z-30 shadow-r">Student Name</th>

                    {filteredItems.map((it) => (
                      <th
                        key={it.id}
                        className="py-2.5 px-3 text-center min-w-[125px] bg-slate-100 border-l border-gray-200"
                      >
                        <div className="text-[10px] text-gray-400 uppercase tracking-tight truncate max-w-[130px]">
                          {it.period} · {it.compName}
                        </div>
                        <div className="font-bold text-navy truncate max-w-[130px]" title={it.name}>
                          {it.name}
                        </div>
                        <span className="text-[10px] font-mono font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 inline-block mt-0.5">
                          Max: {it.is_rate_direct ? 'Rate (50-95)' : it.max_score}
                        </span>
                      </th>
                    ))}

                    <th className="py-3 px-3 text-center w-24 bg-slate-100 border-l border-gray-200">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-sans">
                  {displayedStudents.map((sv, idx) => {
                    const studentId = sv.student.id;
                    const rowScores = editableScores[studentId] || {};
                    const rowIssues = cellIssues[studentId] || {};

                    const rowHasError = filteredItems.some((it) => rowIssues[it.id]?.error);
                    const rowHasWarning = filteredItems.some((it) => rowIssues[it.id]?.warning);

                    return (
                      <tr
                        key={studentId}
                        className={`hover:bg-blue-50/30 transition-colors ${
                          rowHasError ? 'bg-red-50/40' : rowHasWarning ? 'bg-amber-50/20' : ''
                        }`}
                      >
                        <td className="py-2 px-3 text-center text-gray-400 sticky left-0 bg-white z-10">{idx + 1}</td>
                        <td className="py-2 px-3 font-mono text-gray-600 font-medium sticky left-10 bg-white z-10">
                          {sv.student.student_no}
                        </td>
                        <td className="py-2 px-4 font-medium text-navy sticky left-38 bg-white z-10">
                          {formatPersonName(sv.student.name)}
                          {sv.isMissingFromSpreadsheet && (
                            <span className="block text-[10px] text-amber-600 font-normal">
                              Missing from Excel file
                            </span>
                          )}
                        </td>

                        {/* Item Score Inputs */}
                        {filteredItems.map((it) => {
                          const val = rowScores[it.id] ?? '';
                          const issue = rowIssues[it.id];
                          const hasErr = !!issue?.error;
                          const hasWarn = !hasErr && !!issue?.warning && val === '';

                          return (
                            <td key={it.id} className="py-1.5 px-2 text-center border-l border-gray-100">
                              <div className="relative">
                                <input
                                  type="number"
                                  step="any"
                                  value={val}
                                  placeholder="—"
                                  onChange={(e) => handleScoreChange(studentId, it, e.target.value)}
                                  className={`form-input text-center py-1 px-1.5 w-24 text-xs font-bold rounded-md border transition-all ${
                                    hasErr
                                      ? 'border-red-400 bg-red-50 text-red-700 focus:ring-2 focus:ring-red-300'
                                      : hasWarn
                                      ? 'border-gray-200 bg-gray-50 text-gray-400'
                                      : 'border-emerald-300 bg-white text-emerald-800'
                                  }`}
                                  title={issue?.error || issue?.warning || 'Score valid'}
                                />
                                {hasErr && (
                                  <span className="block text-[9.5px] text-red-600 font-medium mt-0.5 truncate max-w-[110px]" title={issue.error}>
                                    {issue.error}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}

                        <td className="py-2 px-3 text-center border-l border-gray-100">
                          {rowHasError ? (
                            <Badge variant="red" className="text-[10px]">
                              Mistake
                            </Badge>
                          ) : rowHasWarning ? (
                            <Badge variant="yellow" className="text-[10px]">
                              Blank
                            </Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                              <Icons.Check className="w-3.5 h-3.5" /> Ready
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-gray-200 flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-gray-500">
            {liveErrorCount > 0 ? (
              <span className="text-red-600 font-semibold flex items-center gap-1">
                <Icons.AlertTriangle className="w-4 h-4" /> Please correct {liveErrorCount} mistake(s) before applying.
              </span>
            ) : (
              <span>
                Ready to apply <strong>{liveScoresCount} scores</strong> across {filteredItems.length} assessment column{filteredItems.length !== 1 ? 's' : ''}.
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button type="button" className="btn btn-outline text-xs px-4 py-2" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              disabled={liveErrorCount > 0 || liveScoresCount === 0}
              onClick={handleApply}
              className={`btn text-xs px-5 py-2 flex items-center gap-2 text-white font-bold rounded-lg transition-all ${
                liveErrorCount > 0 || liveScoresCount === 0
                  ? 'bg-gray-300 opacity-60 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 shadow-md hover:shadow-lg'
              }`}
            >
              <Icons.Check className="w-4 h-4" />
              Apply {liveScoresCount} Scores to Class Record
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
