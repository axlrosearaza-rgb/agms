import { Link, useNavigate } from 'react-router-dom';
import { Icons } from '../../components/common';
import Footer from '../../components/common/Footer';

// Shared chrome for standalone, no-login-required pages (Privacy Policy, Terms,
// Contact Us) — reachable from the footer whether or not the visitor is signed in.
export default function PublicPageShell({ title, subtitle, children }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      <header className="bg-navy text-white">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 no-underline text-white">
            <img src="/assets/logos/cas-logo.png" alt="CAS" className="w-8 h-8 rounded-md object-contain flex-shrink-0" />
            <span className="font-semibold text-[14px]">AGMS · College of Arts and Sciences</span>
          </Link>
          <button className="btn-icon !text-white hover:!bg-white/10" onClick={() => navigate(-1)} title="Go back">
            <Icons.ArrowLeft />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-5 py-8">
        <h1 className="font-display text-2xl font-bold text-navy mb-1">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mb-6">{subtitle}</p>}
        <div className="card p-6 sm:p-8">{children}</div>
      </main>

      <div className="max-w-4xl w-full mx-auto px-5">
        <Footer />
      </div>
    </div>
  );
}
