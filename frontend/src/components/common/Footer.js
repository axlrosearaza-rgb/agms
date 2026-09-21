import { Link } from 'react-router-dom';

// Shared footer — required on every page per the Data Privacy Act (RA 10173)
// compliance requirements: Privacy Policy, Terms and Conditions, and Contact Us
// must always be reachable, not buried behind a login.
export default function Footer() {
  return (
    <footer className="mt-8 pt-5 pb-6 border-t border-gray-100 text-center">
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[12.5px] text-gray-500 mb-2">
        <Link to="/privacy-policy" className="hover:text-navy hover:underline">Privacy Policy</Link>
        <span className="text-gray-300">·</span>
        <Link to="/terms" className="hover:text-navy hover:underline">Terms and Conditions</Link>
        <span className="text-gray-300">·</span>
        <Link to="/contact" className="hover:text-navy hover:underline">Contact Us</Link>
      </div>
      <p className="text-[11px] text-gray-400">
        © {new Date().getFullYear()} Samar State University · College of Arts and Sciences · All Rights Reserved
      </p>
    </footer>
  );
}
