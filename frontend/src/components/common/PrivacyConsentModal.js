import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icons } from './index';
import toast from 'react-hot-toast';

// Data Privacy Act of 2012 (RA 10173) — first-login consent modal. Intentionally
// NOT dismissible by clicking the backdrop or an X button; the only way past it
// is Accept, since consent has to be an affirmative, unambiguous action.
export default function PrivacyConsentModal({ onAccept }) {
  const [accepting, setAccepting] = useState(false);

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

          <div>
            <h4 className="text-[13px] font-bold text-navy mb-1.5 flex items-center gap-1.5">
              <Icons.AlertCircle className="w-4 h-4 text-gold" /> Why we collect your data
            </h4>
            <p className="text-gray-600">
              AGMS collects personal data to identify you, manage your academic or professional records, and
              deliver the University's grading, enrollment, and communication functions accurately and securely.
            </p>
          </div>

          <div>
            <h4 className="text-[13px] font-bold text-navy mb-1.5 flex items-center gap-1.5">
              <Icons.Users className="w-4 h-4 text-gold" /> Types of data collected
            </h4>
            <ul className="list-disc pl-5 text-gray-600 space-y-0.5">
              <li>Student information (name, student number, program, year level, section)</li>
              <li>Faculty and Chairperson information (name, employee number, program, position)</li>
              <li>Grades, class records, and other academic records</li>
              <li>Account credentials (username/student number, encrypted password)</li>
            </ul>
          </div>

          <div>
            <h4 className="text-[13px] font-bold text-navy mb-1.5 flex items-center gap-1.5">
              <Icons.Check className="w-4 h-4 text-gold" /> Purpose of processing
            </h4>
            <p className="text-gray-600">
              Your data is processed solely to enroll and verify students, encode and release grades, generate
              official academic records and reports, endorse and promote students, and enable communication
              between students, faculty, chairpersons, and administrators within the system.
            </p>
          </div>

          <div>
            <h4 className="text-[13px] font-bold text-navy mb-1.5 flex items-center gap-1.5">
              <Icons.Award className="w-4 h-4 text-gold" /> How your data is protected
            </h4>
            <p className="text-gray-600">
              Passwords are encrypted, access is restricted by role (only authorized Admin, Chairperson, and
              Faculty accounts can view or edit records relevant to their function), and all account activity is
              logged. Data is stored on secured University-managed infrastructure.
            </p>
          </div>

          <div>
            <h4 className="text-[13px] font-bold text-navy mb-1.5 flex items-center gap-1.5">
              <Icons.Flag className="w-4 h-4 text-gold" /> Your rights under RA 10173
            </h4>
            <p className="text-gray-600">
              You have the right to be informed, to access your own data, to correct inaccurate data, to object
              to certain processing, to data portability, and to file a complaint with the National Privacy
              Commission. See our full Privacy Policy for details on exercising these rights.
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-[12.5px] text-blue-800">
            By clicking <strong>Accept</strong>, you acknowledge that you have read and understood this notice
            and consent to the collection, processing, and storage of your personal information in accordance
            with the Data Privacy Act of 2012 (RA 10173).
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 sticky bottom-0 bg-white rounded-b-2xl">
          <Link to="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-[13px] text-gray-500 hover:text-navy underline">
            View Full Privacy Policy
          </Link>
          <button className="btn btn-gold w-full sm:w-auto" onClick={handleAccept} disabled={accepting}>
            {accepting ? 'Saving...' : <><Icons.Check className="w-4 h-4" /> Accept</>}
          </button>
        </div>
      </div>
    </div>
  );
}
