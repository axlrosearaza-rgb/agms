import React, { useState, useEffect, useRef, useCallback } from 'react';
import Tesseract from 'tesseract.js';
import { Icons, Badge, formatPersonName, useEscapeToClose, closeAllModals } from './index';
import toast from 'react-hot-toast';

/**
 * Preprocesses an image on an offscreen HTML5 canvas to improve Tesseract OCR accuracy.
 * Applies optional rotation and high-contrast / binarization filter.
 */
function preprocessImage(imgElement, rotation = 0, enhance = true) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const rad = (rotation * Math.PI) / 180;
  const isPerpendicular = rotation === 90 || rotation === 270;
  canvas.width = isPerpendicular ? imgElement.naturalHeight : imgElement.naturalWidth;
  canvas.height = isPerpendicular ? imgElement.naturalWidth : imgElement.naturalHeight;

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(imgElement, -imgElement.naturalWidth / 2, -imgElement.naturalHeight / 2);

  if (enhance) {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    // Grayscale + Adaptive contrast enhancement
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // Contrast stretch: pushes dark ink to near black and pale paper to pure white
      const contrast = gray < 128 ? Math.max(0, gray * 0.7) : Math.min(255, gray * 1.25);
      d[i] = contrast;
      d[i + 1] = contrast;
      d[i + 2] = contrast;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  return canvas;
}

/**
 * Extracts student surname and clean search tokens
 */
function getStudentTokens(student) {
  const fullName = (student.name || '').toLowerCase().trim();
  const studentNo = (student.student_no || '').replace(/\D/g, '');

  const formatted = formatPersonName(student.name || '');
  const surname = formatted.includes(',') ? formatted.split(',')[0].trim() : (student.name || '');

  return {
    studentNo,
    surname: surname.replace(/[^a-z]/g, ''),
    fullNameTokens: fullName.replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(p => p.length >= 2),
  };
}

export default function PhotoScoreScannerModal({
  isOpen,
  onClose,
  components = [],
  studentGrades = [],
  initialPeriod = 'Midterm',
  onApplyScores,
}) {
  useEscapeToClose(onClose, !!isOpen);
  // Period and Target Item(s) selection
  const [period, setPeriod] = useState(initialPeriod);
  const [selectedItemIds, setSelectedItemIds] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Image source state
  const [imageSrc, setImageSrc] = useState(null);
  const [imageFileName, setImageFileName] = useState('');
  const [rotation, setRotation] = useState(0);
  const [enhanceContrast, setEnhanceContrast] = useState(true);
  const [zoom, setZoom] = useState(1);

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);

  // OCR state
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ status: '', progress: 0 });
  const [rawOcrText, setRawOcrText] = useState('');
  const [showRawText, setShowRawText] = useState(false);

  // Scores state: { [studentId]: { [itemId]: scoreNumberOrString } }
  const [extractedScores, setExtractedScores] = useState({});
  const [matchDetails, setMatchDetails] = useState({}); // { [studentId]: 'student_no' | 'name' | 'manual' }
  const [unassignedNumbers, setUnassignedNumbers] = useState([]);

  const imgRef = useRef(null);
  const fileInputRef = useRef(null);

  // Filter components by period
  const periodComponents = components.filter(c => c.period === period);
  const allPeriodItems = periodComponents.flatMap(c =>
    (c.items || []).map(it => ({ ...it, compName: c.name, compWeight: c.weight }))
  );

  // Auto-initialize selected items when period or components change
  useEffect(() => {
    if (allPeriodItems.length > 0) {
      // Keep only items that still belong to this period
      const validCurrentIds = selectedItemIds.filter(id => allPeriodItems.some(it => String(it.id) === String(id)));
      if (validCurrentIds.length === 0) {
        // Default to all items of this period or at least the first item
        setSelectedItemIds(allPeriodItems.map(it => String(it.id)));
      } else {
        setSelectedItemIds(validCurrentIds);
      }
    } else {
      setSelectedItemIds([]);
    }
  }, [period, components]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeSelectedItems = allPeriodItems.filter(it => selectedItemIds.includes(String(it.id)));

  // Toggle item selection
  const toggleItemSelection = (itemIdStr) => {
    setSelectedItemIds(prev => {
      if (prev.includes(itemIdStr)) {
        if (prev.length === 1) {
          toast.error('At least one target item must be selected.');
          return prev;
        }
        return prev.filter(id => id !== itemIdStr);
      } else {
        return [...prev, itemIdStr];
      }
    });
  };

  const selectAllItems = () => {
    setSelectedItemIds(allPeriodItems.map(it => String(it.id)));
  };

  const deselectAllItems = () => {
    if (allPeriodItems.length > 0) {
      setSelectedItemIds([String(allPeriodItems[0].id)]);
      toast('Kept the first item selected (at least one is required).');
    }
  };

  // Cleanup camera stream
  const stopCamera = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Clipboard paste listener (Ctrl+V)
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          const reader = new FileReader();
          reader.onload = (event) => {
            setImageSrc(event.target.result);
            setImageFileName('Pasted_Image_' + new Date().toLocaleTimeString() + '.png');
            stopCamera();
            toast.success('Image pasted from clipboard!');
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, stopCamera]);

  // Handle file upload
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setImageSrc(event.target.result);
      setImageFileName(file.name);
      stopCamera();
      setRotation(0);
      setExtractedScores({});
      setMatchDetails({});
      setRawOcrText('');
    };
    reader.readAsDataURL(file);
  };

  // Start webcam
  const startCamera = async () => {
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsCameraActive(true);
    } catch (err) {
      toast.error('Unable to access camera: ' + (err.message || 'Permission denied'));
    }
  };

  // Capture photo from webcam
  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    setImageSrc(dataUrl);
    setImageFileName('Camera_Snap_' + new Date().toLocaleTimeString() + '.jpg');
    stopCamera();
    setRotation(0);
    toast.success('Photo captured!');
  };

  // Multi-column sample scoresheet generator for testing
  const generateSampleScoresheet = () => {
    const targetItems = activeSelectedItems.length > 0 ? activeSelectedItems : allPeriodItems.slice(0, 3);
    const colCount = targetItems.length;

    const canvas = document.createElement('canvas');
    canvas.width = 750 + colCount * 130;
    canvas.height = 680;
    const ctx = canvas.getContext('2d');

    // Paper background
    ctx.fillStyle = '#fcfcfc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Header
    ctx.fillStyle = '#0f2a4a';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(`SAMAR STATE UNIVERSITY — ${period.toUpperCase()} CLASS SCORESHEET`, 40, 50);

    ctx.fillStyle = '#555';
    ctx.font = '14px sans-serif';
    ctx.fillText(`Multi-Assessment Record | Items Included: ${targetItems.map(it => it.name).join(', ')}`, 40, 80);
    ctx.fillText(`Date: ${new Date().toLocaleDateString()}`, 40, 102);

    // Table Header
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(40, 125, canvas.width - 80, 40);
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('#', 55, 150);
    ctx.fillText('STUDENT ID', 100, 150);
    ctx.fillText('STUDENT NAME', 240, 150);

    // Header for each target item
    const baseColX = 520;
    targetItems.forEach((it, i) => {
      const colX = baseColX + i * 140;
      ctx.fillText(`${it.name.slice(0, 14)} (/${Math.round(it.max_score || 100)})`, colX, 150);
    });

    // Rows
    const students = studentGrades.slice(0, 10);
    students.forEach((g, idx) => {
      const y = 195 + idx * 42;
      ctx.fillStyle = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      ctx.fillRect(40, y - 25, canvas.width - 80, 38);

      ctx.fillStyle = '#64748b';
      ctx.font = '14px sans-serif';
      ctx.fillText(String(idx + 1), 55, y);
      ctx.fillText(g.student.student_no, 100, y);

      ctx.fillStyle = '#0f172a';
      ctx.font = '14px sans-serif';
      ctx.fillText(formatPersonName(g.student.name), 240, y);

      // Random realistic scores across columns
      targetItems.forEach((it, i) => {
        const colX = baseColX + i * 140;
        const max = it.max_score || 100;
        const simScore = Math.min(max, Math.max(it.is_rate_direct ? 75 : 60, Math.floor(max * (0.75 + Math.random() * 0.22))));
        ctx.fillStyle = '#0284c7';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText(String(simScore), colX + 25, y);
      });
    });

    const dataUrl = canvas.toDataURL('image/png');
    setImageSrc(dataUrl);
    setImageFileName(`SSU_${period}_MultiColumn_Scoresheet.png`);
    stopCamera();
    setRotation(0);
    toast.success(`Generated demo scoresheet with ${colCount} assessment column${colCount !== 1 ? 's' : ''}!`);
  };

  // Run Tesseract OCR on current image and map multi-column scores
  const runOcr = async () => {
    if (!imageSrc) {
      toast.error('Please upload or snap a photo first.');
      return;
    }
    if (activeSelectedItems.length === 0) {
      toast.error('Please select at least one target assessment item.');
      return;
    }

    setIsScanning(true);
    setScanProgress({ status: 'Preparing image...', progress: 0 });

    try {
      // 1. Preprocess on canvas
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = imageSrc;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
      });

      const processedCanvas = preprocessImage(img, rotation, enhanceContrast);

      // 2. Run Tesseract recognition
      const result = await Tesseract.recognize(processedCanvas, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setScanProgress({
              status: 'Recognizing characters...',
              progress: Math.round((m.progress || 0) * 100),
            });
          } else {
            setScanProgress({
              status: m.status || 'Loading OCR worker...',
              progress: Math.round((m.progress || 0) * 50),
            });
          }
        },
      });

      const fullText = result.data.text || '';
      setRawOcrText(fullText);

      // 3. Smart Multi-Column Matching Algorithm
      const lines = result.data.lines || fullText.split('\n').map(t => ({ text: t }));
      const newScores = {};
      const newMatchDetails = {};

      // Pre-compute token representations for enrolled students
      const studentsMeta = studentGrades.map(g => ({
        student: g.student,
        tokens: getStudentTokens(g.student),
      }));

      // Find all numbers in the entire document for fallback/picker
      const globalNumberMatches = fullText.match(/\b\d+(?:\.\d+)?\b/g) || [];
      const highestMaxScore = Math.max(...activeSelectedItems.map(it => parseFloat(it.max_score) || 100));
      const validGlobalNumbers = globalNumberMatches
        .map(n => parseFloat(n))
        .filter(n => !isNaN(n) && n >= 0 && n <= highestMaxScore && !studentsMeta.some(s => s.tokens.studentNo === String(Math.floor(n))));
      setUnassignedNumbers([...new Set(validGlobalNumbers)].slice(0, 24));

      // Scan line by line
      for (const lineObj of lines) {
        const rawLine = (lineObj.text || '').trim();
        if (!rawLine) continue;

        const cleanLine = rawLine.toLowerCase();

        // Extract candidate numbers from this line
        const matches = rawLine.match(/\b\d+(?:\.\d+)?\b/g) || [];
        const lineNumbers = matches.map(n => parseFloat(n)).filter(n => !isNaN(n));

        // Check each student
        for (const meta of studentsMeta) {
          const { student, tokens } = meta;
          if (newScores[student.id] !== undefined) continue; // Already matched

          let matched = false;
          let matchType = '';

          // A. Check Student Number match
          if (tokens.studentNo && tokens.studentNo.length >= 4 && cleanLine.includes(tokens.studentNo.toLowerCase())) {
            matched = true;
            matchType = 'student_no';
          }
          // B. Check Surname match (minimum 3 characters to avoid false positives)
          else if (tokens.surname && tokens.surname.length >= 3 && cleanLine.includes(tokens.surname)) {
            matched = true;
            matchType = 'name';
          }
          // C. Check first name tokens match
          else if (tokens.fullNameTokens.length >= 2) {
            const hitCount = tokens.fullNameTokens.filter(tok => tok.length >= 3 && cleanLine.includes(tok)).length;
            if (hitCount >= 2) {
              matched = true;
              matchType = 'name';
            }
          }

          if (matched) {
            // Find candidate score numbers on this line
            const candidateScores = lineNumbers.filter(num => {
              if (tokens.studentNo && String(Math.floor(num)) === tokens.studentNo) return false;
              return num >= 0 && num <= highestMaxScore;
            });

            if (candidateScores.length > 0) {
              const studentRowScores = {};

              // If multiple target items are selected, map available candidate numbers column-by-column
              // Usually the numbers appear in the same left-to-right order as the sheet columns
              const itemsToMap = activeSelectedItems;
              // If candidate numbers match or exceed the number of items, map each
              if (candidateScores.length >= itemsToMap.length) {
                // Take the rightmost N candidate scores matching the items count
                const rightmostScores = candidateScores.slice(-itemsToMap.length);
                itemsToMap.forEach((it, idx) => {
                  studentRowScores[it.id] = rightmostScores[idx];
                });
              } else {
                // Map as many as found from left to right
                itemsToMap.forEach((it, idx) => {
                  if (idx < candidateScores.length) {
                    studentRowScores[it.id] = candidateScores[idx];
                  }
                });
              }

              newScores[student.id] = studentRowScores;
              newMatchDetails[student.id] = matchType;
            }
          }
        }
      }

      setExtractedScores(newScores);
      setMatchDetails(newMatchDetails);

      const matchedCount = Object.keys(newScores).length;
      if (matchedCount > 0) {
        toast.success(`OCR Complete! Matched ${matchedCount} student${matchedCount !== 1 ? 's' : ''} across ${activeSelectedItems.length} column${activeSelectedItems.length !== 1 ? 's' : ''}.`);
      } else {
        toast('OCR processed, but no student names/IDs were automatically matched. You can use "Map by Order" or type scores directly.', {
          icon: 'ℹ️',
          duration: 6000,
        });
      }
    } catch (err) {
      console.error('OCR Error:', err);
      toast.error('OCR scanning encountered an error: ' + (err.message || 'Worker failed'));
    } finally {
      setIsScanning(false);
    }
  };

  // Fallback: Map all detected numbers sequentially by roster order across multiple columns
  const handleMapByOrder = () => {
    if (!unassignedNumbers.length && !rawOcrText) {
      toast.error('No detected numbers found. Please scan an image first.');
      return;
    }

    const highestMaxScore = Math.max(...activeSelectedItems.map(it => parseFloat(it.max_score) || 100));
    const allMatches = (rawOcrText.match(/\b\d+(?:\.\d+)?\b/g) || [])
      .map(n => parseFloat(n))
      .filter(n => !isNaN(n) && n >= 0 && n <= highestMaxScore && n > 5);

    if (allMatches.length === 0) {
      toast.error('No suitable score numbers found in OCR text.');
      return;
    }

    const newScores = { ...extractedScores };
    const newDetails = { ...matchDetails };
    const colCount = activeSelectedItems.length;

    let numIndex = 0;
    studentGrades.forEach(g => {
      const studentRowScores = { ...(newScores[g.student.id] || {}) };
      activeSelectedItems.forEach(it => {
        if (numIndex < allMatches.length) {
          studentRowScores[it.id] = allMatches[numIndex++];
        }
      });
      newScores[g.student.id] = studentRowScores;
      newDetails[g.student.id] = 'order';
    });

    setExtractedScores(newScores);
    setMatchDetails(newDetails);
    toast.success(`Mapped scores in roster order across ${colCount} column${colCount !== 1 ? 's' : ''}!`);
  };

  // Change single score cell
  const handleScoreInput = (studentId, itemId, value) => {
    setExtractedScores(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || {}),
        [itemId]: value,
      },
    }));
    setMatchDetails(prev => ({
      ...prev,
      [studentId]: 'manual',
    }));
  };

  // Fill all remaining blank fields with 0 across all active target items
  const handleFillBlanksWithZero = () => {
    const updated = { ...extractedScores };
    studentGrades.forEach(g => {
      const rowScores = { ...(updated[g.student.id] || {}) };
      activeSelectedItems.forEach(it => {
        if (rowScores[it.id] === undefined || rowScores[it.id] === '' || rowScores[it.id] === null) {
          rowScores[it.id] = 0;
        }
      });
      updated[g.student.id] = rowScores;
    });
    setExtractedScores(updated);
    toast.success('Filled remaining empty score cells with 0.');
  };

  // Clear all scores
  const handleClearAll = () => {
    setExtractedScores({});
    setMatchDetails({});
  };

  // Confirm and apply to Class Record
  const handleApply = () => {
    // Count valid entered scores
    let totalEntries = 0;
    let hasOutOfRange = false;

    Object.entries(extractedScores).forEach(([, rowScores]) => {
      if (!rowScores) return;
      Object.entries(rowScores).forEach(([itemId, val]) => {
        if (val !== undefined && val !== null && val !== '' && !isNaN(parseFloat(val))) {
          totalEntries++;
          const it = allPeriodItems.find(item => String(item.id) === String(itemId));
          const max = it ? parseFloat(it.max_score) || 100 : 100;
          if (parseFloat(val) < 0 || parseFloat(val) > max) {
            hasOutOfRange = true;
          }
        }
      });
    });

    if (totalEntries === 0) {
      toast.error('No scores to apply.');
      return;
    }

    if (hasOutOfRange) {
      toast.error('One or more scores exceed the maximum allowable score. Please correct them before applying.');
      return;
    }

    onApplyScores(extractedScores, selectedItemIds, period);
    onClose();
  };

  if (!isOpen) return null;

  const totalStudents = studentGrades.length;
  // Count how many students have at least one score
  const scoredStudentsCount = Object.values(extractedScores).filter(row =>
    row && Object.values(row).some(v => v !== undefined && v !== '' && v !== null)
  ).length;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-3 sm:p-5 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-[96vw] xl:max-w-7xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden border border-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-navy to-[#1a3a60] text-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-amber-300">
              <Icons.Camera className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold">Scan Scores from Photo</h3>
                <span className="text-[11px] font-semibold bg-amber-400 text-navy px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Icons.Sparkles className="w-3 h-3" /> Multi-Item OCR
                </span>
              </div>
              <p className="text-xs text-blue-100/80">
                Extract scores for single or multiple assessment columns from your physical scoresheet or photos.
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

        {/* Target Assessment Scope Bar with Multi-Item Dropdown */}
        <div className="px-6 py-3 bg-slate-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Period Selector */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Period:</label>
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
                {['Midterm', 'Finals'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                      period === p ? 'bg-navy text-white shadow-sm' : 'text-gray-600 hover:text-navy'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Multi-Target Item Selector Dropdown */}
            <div className="flex items-center gap-2 relative" ref={dropdownRef}>
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Target Items:</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-semibold border border-gray-300 rounded-lg bg-white shadow-sm hover:border-navy transition-all min-w-[260px] text-left"
                >
                  <span className="truncate max-w-[280px]">
                    {activeSelectedItems.length === 0
                      ? 'Select Target Items...'
                      : activeSelectedItems.length === 1
                      ? `${activeSelectedItems[0].compName} — ${activeSelectedItems[0].name}`
                      : `${activeSelectedItems.length} Target Items Selected`}
                  </span>
                  <Icons.ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                </button>

                {/* Dropdown Menu */}
                {isDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1.5 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 p-2 animate-slideUp">
                    <div className="px-2 py-1.5 border-b border-gray-100 flex items-center justify-between text-xs font-semibold">
                      <span className="text-gray-600">Select Assessment Items:</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={selectAllItems}
                          className="text-[11px] text-blue-600 hover:underline"
                        >
                          Select All
                        </button>
                        <span className="text-gray-300">|</span>
                        <button
                          type="button"
                          onClick={deselectAllItems}
                          className="text-[11px] text-gray-500 hover:underline"
                        >
                          Reset
                        </button>
                      </div>
                    </div>

                    <div className="max-h-60 overflow-y-auto py-1 divide-y divide-gray-50">
                      {periodComponents.length === 0 ? (
                        <p className="p-3 text-xs text-gray-400 text-center">No components setup for {period}.</p>
                      ) : (
                        periodComponents.map((c) => (
                          <div key={c.id || c.name} className="py-1.5 px-2">
                            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                              {c.name} ({c.weight}%)
                            </p>
                            <div className="space-y-1">
                              {(c.items || []).map((it) => {
                                const idStr = String(it.id);
                                const isChecked = selectedItemIds.includes(idStr);
                                return (
                                  <label
                                    key={it.id}
                                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors ${
                                      isChecked ? 'bg-blue-50/70 text-navy font-semibold' : 'hover:bg-gray-50 text-gray-700'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => toggleItemSelection(idStr)}
                                      className="rounded text-navy focus:ring-navy h-3.5 w-3.5"
                                    />
                                    <span className="flex-1 truncate">{it.name}</span>
                                    <span className="text-[10px] text-gray-400 font-mono">
                                      /{it.is_rate_direct ? 'Rate' : it.max_score}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Selected Items Badges / Pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeSelectedItems.map((it) => (
                <span
                  key={it.id}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold bg-white border border-gray-200 text-navy px-2 py-0.5 rounded-md shadow-xs"
                >
                  <span className="truncate max-w-[140px]" title={`${it.compName} - ${it.name}`}>
                    {it.compName.slice(0, 12)}: {it.name}
                  </span>
                  <span className="text-gray-400 text-[10px]">/{it.max_score}</span>
                  {activeSelectedItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => toggleItemSelection(String(it.id))}
                      className="text-gray-400 hover:text-red-500 ml-0.5"
                      title="Remove this item"
                    >
                      <Icons.X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500 font-medium">
            <span>Columns to encode:</span>
            <span className="font-bold text-navy bg-white px-2 py-0.5 rounded border border-gray-200">
              {activeSelectedItems.length}
            </span>
          </div>
        </div>

        {/* Modal Main Content (Split Screen) */}
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[420px]">
          {/* LEFT: Image Upload / Camera / Preview (4 cols) */}
          <div className="lg:col-span-4 flex flex-col gap-3">
            {/* Input Action Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="btn btn-outline text-xs py-1.5 px-2.5 flex items-center gap-1.5"
                onClick={() => fileInputRef.current?.click()}
              >
                <Icons.Upload className="w-3.5 h-3.5" /> Browse Photo
              </button>

              <button
                type="button"
                className={`btn text-xs py-1.5 px-2.5 flex items-center gap-1.5 ${
                  isCameraActive ? 'btn-red' : 'btn-outline'
                }`}
                onClick={isCameraActive ? stopCamera : startCamera}
              >
                <Icons.Camera className="w-3.5 h-3.5" /> {isCameraActive ? 'Cancel' : 'Camera'}
              </button>

              <button
                type="button"
                className="text-xs text-navy/70 hover:text-navy underline ml-auto font-medium"
                onClick={generateSampleScoresheet}
                title="Generates a sample scoresheet with multiple columns to test OCR"
              >
                Try Sample Sheet
              </button>
            </div>

            {/* Camera Viewfinder */}
            {isCameraActive && (
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center border border-gray-200 shadow-md">
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={capturePhoto}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-amber-400 hover:bg-amber-500 text-navy font-bold text-xs shadow-lg flex items-center gap-1.5 transition-transform hover:scale-105"
                >
                  <Icons.Camera className="w-4 h-4" /> Snap Photo
                </button>
              </div>
            )}

            {/* Photo Preview Container */}
            {!isCameraActive && (
              <div className="flex-1 flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-slate-100 min-h-[280px]">
                {imageSrc ? (
                  <>
                    {/* Image Viewer Toolbar */}
                    <div className="px-3 py-1.5 bg-white border-b border-gray-200 flex items-center justify-between text-xs">
                      <span className="text-gray-500 truncate max-w-[130px]" title={imageFileName}>
                        {imageFileName || 'Photo'}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-gray-100 text-gray-600"
                          onClick={() => setRotation((r) => (r + 90) % 360)}
                          title="Rotate 90°"
                        >
                          <Icons.RotateCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-gray-100 text-gray-600"
                          onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
                          title="Zoom Out"
                        >
                          <Icons.ZoomOut className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[11px] font-mono w-8 text-center text-gray-500">
                          {Math.round(zoom * 100)}%
                        </span>
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-gray-100 text-gray-600"
                          onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                          title="Zoom In"
                        >
                          <Icons.ZoomIn className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Image Canvas / View */}
                    <div className="flex-1 overflow-auto p-3 flex items-center justify-center bg-gray-900/5 relative min-h-[220px]">
                      <img
                        ref={imgRef}
                        src={imageSrc}
                        alt="Scoresheet"
                        className="transition-transform duration-200 rounded shadow-md max-w-full"
                        style={{
                          transform: `scale(${zoom}) rotate(${rotation}deg)`,
                          transformOrigin: 'center center',
                          filter: enhanceContrast ? 'contrast(130%) grayscale(80%)' : 'none',
                        }}
                      />
                    </div>

                    {/* Preprocessing Toggles */}
                    <div className="px-3 py-1.5 bg-white border-t border-gray-200 flex items-center justify-between text-xs">
                      <label className="flex items-center gap-1.5 cursor-pointer text-gray-700">
                        <input
                          type="checkbox"
                          checked={enhanceContrast}
                          onChange={(e) => setEnhanceContrast(e.target.checked)}
                          className="rounded text-navy focus:ring-navy h-3.5 w-3.5"
                        />
                        <span className="text-[11px] font-medium">Auto-Enhance Contrast</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setImageSrc(null);
                          setExtractedScores({});
                          setMatchDetails({});
                        }}
                        className="text-red-500 hover:text-red-700 text-[11px] font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  </>
                ) : (
                  /* Empty Upload Dropzone */
                  <div
                    className="flex-1 flex flex-col items-center justify-center p-6 text-center cursor-pointer hover:bg-slate-50 transition-colors border-2 border-dashed border-gray-300 m-2.5 rounded-lg"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <div className="w-12 h-12 rounded-xl bg-blue-50 text-navy flex items-center justify-center mb-2">
                      <Icons.Upload className="w-6 h-6" />
                    </div>
                    <p className="text-xs font-semibold text-gray-700">Click or Drag & Drop photo here</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Accepts JPG, PNG, or <kbd className="px-1 py-0.5 bg-gray-100 rounded border text-[9px]">Ctrl+V</kbd>
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Run OCR Button / Progress */}
            {imageSrc && (
              <div className="space-y-1.5">
                {isScanning ? (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-navy">
                      <span>{scanProgress.status}</span>
                      <span>{scanProgress.progress}%</span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-navy h-full transition-all duration-200"
                        style={{ width: `${scanProgress.progress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={runOcr}
                    className="w-full py-2 px-4 rounded-xl bg-gradient-to-r from-navy to-[#183a60] text-white font-bold text-xs shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                  >
                    <Icons.Sparkles className="w-4 h-4 text-amber-300" />
                    {Object.keys(extractedScores).length > 0 ? 'Re-scan Photo with OCR' : 'Scan Scores from Photo'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* RIGHT: Matched Students & Multi-Column Verification Table (8 cols) */}
          <div className="lg:col-span-8 flex flex-col gap-3">
            {/* Verification Header */}
            <div className="flex items-center justify-between flex-wrap gap-2 pb-1.5 border-b border-gray-100">
              <div>
                <h4 className="text-sm font-bold text-navy flex items-center gap-2">
                  <span>Student Scores Verification</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-navy border border-blue-200">
                    {scoredStudentsCount} of {totalStudents} students matched
                  </span>
                </h4>
                <p className="text-xs text-gray-400">
                  Scores map across {activeSelectedItems.length} selected target column{activeSelectedItems.length !== 1 ? 's' : ''}. You can freely edit any cell.
                </p>
              </div>

              {/* Table Quick Actions */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleMapByOrder}
                  className="px-2.5 py-1 text-xs font-medium rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 shadow-sm"
                  title="Maps detected scores sequentially row-by-row"
                >
                  Map by Order
                </button>
                <button
                  type="button"
                  onClick={handleFillBlanksWithZero}
                  className="px-2.5 py-1 text-xs font-medium rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 shadow-sm"
                >
                  Fill Blanks 0
                </button>
                {scoredStudentsCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="px-2.5 py-1 text-xs font-medium rounded text-red-600 hover:bg-red-50"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>

            {/* Unassigned Quick Pick Pills */}
            {unassignedNumbers.length > 0 && (
              <div className="p-2 bg-amber-50/70 border border-amber-200 rounded-lg text-xs">
                <span className="font-semibold text-amber-800 mr-2 text-[11.5px]">Detected Numbers:</span>
                <span className="text-gray-500 text-[10.5px] mr-2">Click to copy:</span>
                <div className="inline-flex flex-wrap gap-1 mt-0.5">
                  {unassignedNumbers.slice(0, 16).map((num, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(String(num));
                        toast.success(`Copied score ${num}!`);
                      }}
                      className="px-1.5 py-0.5 bg-white border border-amber-300 rounded text-navy font-bold hover:bg-amber-100 text-[10.5px] shadow-xs cursor-pointer"
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Dynamic Multi-Column Students Table */}
            <div className="flex-1 border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm flex flex-col">
              <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 text-gray-600 font-semibold border-b border-gray-200 sticky top-0 z-10 shadow-xs">
                    <tr>
                      <th className="py-2.5 px-2.5 text-center w-8 bg-slate-50">#</th>
                      <th className="py-2.5 px-3 w-24 bg-slate-50">Student No.</th>
                      <th className="py-2.5 px-3 min-w-[150px] bg-slate-50">Student Name</th>

                      {/* Header Column for each selected item */}
                      {activeSelectedItems.map((it) => (
                        <th key={it.id} className="py-2 px-2.5 text-center min-w-[110px] bg-slate-50 border-l border-gray-200">
                          <div className="text-[10px] text-gray-400 uppercase tracking-tight truncate max-w-[130px]" title={it.compName}>
                            {it.compName}
                          </div>
                          <div className="font-bold text-navy truncate max-w-[130px]" title={it.name}>
                            {it.name}
                          </div>
                          <span className="text-[10px] font-mono font-normal text-gray-500">
                            (Max: {it.max_score || 100})
                          </span>
                        </th>
                      ))}

                      <th className="py-2.5 px-3 text-center w-20 bg-slate-50 border-l border-gray-200">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-sans">
                    {studentGrades.map((g, idx) => {
                      const studentId = g.student.id;
                      const rowScores = extractedScores[studentId] || {};
                      const matchType = matchDetails[studentId];

                      // Check if student has any score
                      const filledCount = activeSelectedItems.filter(it => {
                        const val = rowScores[it.id];
                        return val !== undefined && val !== null && val !== '';
                      }).length;

                      // Check out of range
                      const hasOutOfRange = activeSelectedItems.some(it => {
                        const val = rowScores[it.id];
                        if (val === undefined || val === null || val === '') return false;
                        const num = parseFloat(val);
                        const max = it.max_score || 100;
                        return isNaN(num) || num < 0 || num > max;
                      });

                      return (
                        <tr
                          key={studentId}
                          className={`hover:bg-blue-50/40 transition-colors ${
                            hasOutOfRange ? 'bg-red-50/50' : filledCount > 0 ? 'bg-green-50/15' : ''
                          }`}
                        >
                          <td className="py-2 px-2.5 text-center text-gray-400">{idx + 1}</td>
                          <td className="py-2 px-3 font-mono text-gray-600 font-medium">
                            {g.student.student_no}
                          </td>
                          <td className="py-2 px-3 font-medium text-navy">
                            {formatPersonName(g.student.name)}
                          </td>

                          {/* Editable cell for each selected assessment item */}
                          {activeSelectedItems.map((it) => {
                            const val = rowScores[it.id];
                            const max = it.max_score || 100;
                            const isFilled = val !== undefined && val !== null && val !== '';
                            const num = parseFloat(val);
                            const cellInvalid = isFilled && (isNaN(num) || num < 0 || num > max);

                            return (
                              <td key={it.id} className="py-1.5 px-2 text-center border-l border-gray-100">
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  max={max}
                                  value={val ?? ''}
                                  placeholder="—"
                                  onChange={(e) => handleScoreInput(studentId, it.id, e.target.value)}
                                  className={`form-input text-center py-1 px-1 w-20 text-xs font-bold rounded-md border ${
                                    cellInvalid
                                      ? 'border-red-400 bg-red-50 text-red-600'
                                      : isFilled
                                      ? 'border-emerald-400 bg-white text-emerald-700'
                                      : 'border-gray-200 text-gray-700'
                                  }`}
                                />
                              </td>
                            );
                          })}

                          <td className="py-2 px-3 text-center border-l border-gray-100">
                            {hasOutOfRange ? (
                              <Badge variant="red" className="text-[10px]">
                                Error
                              </Badge>
                            ) : filledCount > 0 ? (
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"
                                title={`Matched by ${matchType || 'manual'}`}
                              >
                                <Icons.Check className="w-3 h-3" />
                                {filledCount}/{activeSelectedItems.length}
                              </span>
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Raw OCR Text Collapsible Viewer */}
            {rawOcrText && (
              <div className="text-xs">
                <button
                  type="button"
                  onClick={() => setShowRawText(!showRawText)}
                  className="text-gray-500 hover:text-navy flex items-center gap-1 font-medium"
                >
                  {showRawText ? <Icons.ChevronUp className="w-3.5 h-3.5" /> : <Icons.ChevronDown className="w-3.5 h-3.5" />}
                  {showRawText ? 'Hide' : 'View'} Raw OCR Extracted Text
                </button>
                {showRawText && (
                  <pre className="mt-1 p-2 bg-slate-100 text-slate-700 rounded-lg max-h-28 overflow-auto text-[11px] font-mono whitespace-pre-wrap border border-slate-200">
                    {rawOcrText}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-gray-200 flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>
              Targeting <strong>{activeSelectedItems.length} assessment item{activeSelectedItems.length !== 1 ? 's' : ''}</strong> ({period})
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn btn-outline text-xs px-4 py-2"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={scoredStudentsCount === 0}
              onClick={handleApply}
              className={`btn btn-gold text-xs px-5 py-2 flex items-center gap-2 ${
                scoredStudentsCount === 0 ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <Icons.Check className="w-4 h-4" />
              Apply Scores to Class Record ({scoredStudentsCount} students)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
