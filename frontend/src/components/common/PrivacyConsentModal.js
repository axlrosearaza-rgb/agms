import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icons } from './index';
import toast from 'react-hot-toast';

// Data Privacy Act of 2012 (RA 10173) — first-login consent modal. Intentionally
// NOT dismissible by clicking the backdrop or an X button; the only way past it
// is Accept, since consent has to be an affirmative, unambiguous action.
const SECTIONS = [
  {
    key: 'why', icon: 'AlertCircle', title: 'Why we collect your data',
    body: <p>AGMS collects personal data to identify you, manage your academic or professional records, and deliver the University's grading, enrollment, and communication functions accurately and securely.</p>,
  },
  {
    key: 'types', icon: 'Users', title: 'Types of data collected',
    body: (
      <ul className="list-disc pl-5 space-y-0.5">
        <li>Student information (name, student number, program, year level, section)</li>
        <li>Faculty and Chairperson information (name, employee number, program, position)</li>
        <li>Grades, class records, and other academic records</li>
        <li>Account credentials (username/student number, encrypted password)</li>
      </ul>
    ),
  },
  {
    key: 'purpose', icon: 'Check', title: 'Purpose of processing',
    body: <p>Your data is processed solely to enroll and verify students, encode and release grades, generate official academic records and reports, endorse and promote students, and enable communication between students, faculty, chairpersons, and administrators within the system.</p>,
  },
  {
    key: 'protected', icon: 'Award', title: 'How your data is protected',
    body: <p>Passwords are encrypted, access is restricted by role (only authorized Admin, Chairperson, and Faculty accounts can view or edit records relevant to their function), and all account activity is logged. Data is stored on secured University-managed infrastructure.</p>,
  },
  {
    key: 'rights', icon: 'Flag', title: 'Your rights under RA 10173',
    body: <p>You have the right to be informed, to access your own data, to correct inaccurate data, to object to certain processing, to data portability, and to file a complaint with the National Privacy Commission. See our full Privacy Policy for details on exercising these rights.</p>,
  },
];

export default function PrivacyConsentModal({ onAccept }) {
  const [accepting, setAccepting] = useState(false);
  // Consent takes deliberate steps: open (read) every section of the notice,
  // then tick "I have read and understood…" — only then can Accept be clicked.
  const [opened, setOpened] = useState(() => new Set());
  const [openKey, setOpenKey] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const toggleSection = (key) => {
    setOpenKey((k) => (k === key ? null : key));
    setOpened((prev) => new Set(prev).add(key));
  };
  const reachedEnd = SECTIONS.every((sec) => opened.has(sec.key));

  const handleAccept = async () => {
    try {
      setAccepting(true);
      await onAccept();
      toast.success('Privacy Notice accepted. Thank you.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record your acceptance. Please try again.');
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[2000] p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-slideUp">
        {/* Header */}
        <div className="px-6 py-5 bg-navy text-white rounded-t-2xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gold/20 flex items-center justify-center flex-shrink-0">
            <Icons.FileText className="w-5 h-5 text-gold" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Privacy Notice</h3>
            <p className="text-[12px] text-white/60">Data Privacy Act of 2012 (Republic Act No. 10173)</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5 text-sm text-gray-700">
          <p>
            The Academic Grade Management System (AGMS) of the College of Arts and Sciences, Samar State
            University, respects your right to privacy. Before you continue, please read and understand how
            we collect, use, and protect your personal information.
          </p>

          {/* Each section is a dropdown — all of them must be opened (read)
              before the "I have read" box can be ticked. */}
          <div className="space-y-2">
            {SECTIONS.map((sec) => {
              const isOpen = openKey === sec.key;
              const read = opened.has(sec.key);
              const Icon = Icons[sec.icon];
              return (
                <div key={sec.key} className={`rounded-lg border ${isOpen ? 'border-navy/30 bg-white' : 'border-gray-200 bg-gray-50/60'}`}>
                  <button
                    type="button"
                    onClick={() => toggleSection(sec.key)}
                    className="w-full flex items-center gap-2 px-4 py-3 bg-transparent border-none cursor-pointer font-sans text-left"
                    aria-expanded={isOpen}
                  >
                    <Icon className="w-4 h-4 text-gold flex-shrink-0" />
                    <span className="flex-1 text-[13px] font-bold text-navy">{sec.title}</span>
                    {read
                      ? <span className="text-[11px] font-semibold text-green-600 flex items-center gap-1"><Icons.Check className="w-3.5 h-3.5" /> Read</span>
                      : <span className="text-[11px] text-gray-400">Click to read</span>}
                    {isOpen ? <Icons.ChevronUp className="w-4 h-4 text-gray-400" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>
                  {isOpen && <div className="px-4 pb-3 -mt-1 text-gray-600">{sec.body}</div>}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-500">
            {reachedEnd ? 'All sections read.' : `Open every section to read it — ${opened.size} of ${SECTIONS.length} read.`}
          </p>

          <label
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-[12.5px] transition-colors ${
              !reachedEnd ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                : agreed ? 'bg-green-50 border-green-200 text-green-900 cursor-pointer'
                  : 'bg-blue-50 border-blue-200 text-blue-900 cursor-pointer'
            }`}
            title={reachedEnd ? '' : 'Open and read every section first'}
          >
            <input
              type="checkbox"
              className="mt-0.5 w-4 h-4 flex-shrink-0 accent-[#1B3A5C]"
              checked={agreed}
              disabled={!reachedEnd}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              <strong>I have read and understood this Privacy Notice</strong>, and I consent to the collection,
              processing, and storage of my personal information in accordance with the Data Privacy Act of
              2012 (RA 10173).
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 sticky bottom-0 bg-white rounded-b-2xl">
          <div className="flex flex-col items-center sm:items-start">
            <Link to="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-[13px] text-gray-500 hover:text-navy underline">
              View Full Privacy Policy
            </Link>
            {!agreed && (
              <span className="text-[11px] text-amber-700 mt-0.5">
                {reachedEnd ? 'Tick the box above to continue.' : 'Open every section above to continue.'}
              </span>
            )}
          </div>
          <button
            className={`btn btn-gold w-full sm:w-auto ${!agreed ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={() => {
              if (!reachedEnd) return toast.error('Please open and read every section of the notice first.');
              if (!agreed) return toast.error('Tick "I have read and understood this Privacy Notice" first.');
              handleAccept();
            }}
            disabled={accepting}
          >
            {accepting ? 'Saving...' : <><Icons.Check className="w-4 h-4" /> Accept</>}
          </button>
        </div>
      </div>
    </div>
  );
}
