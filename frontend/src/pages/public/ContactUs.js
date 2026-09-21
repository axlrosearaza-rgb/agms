import { Icons } from '../../components/common';
import PublicPageShell from './PublicPageShell';

const ROWS = [
  { icon: 'MapPin', label: 'Address', value: 'Samar State University, Arteche Blvd., Catbalogan City, Philippines 6700' },
  { icon: 'Mail', label: 'Email', value: 'agms.ssu@gmail.com' },
];

export default function ContactUs() {
  return (
    <PublicPageShell
      title="Contact Us"
      subtitle="College of Arts and Sciences — Samar State University"
    >
      <p className="text-[13.5px] text-gray-600 mb-6">
        For questions about the Academic Grade Management System (AGMS), your account, or how your personal
        data is handled under the Data Privacy Act of 2012 (RA 10173), please reach out through any of the
        channels below.
      </p>

      <div className="space-y-4">
        {ROWS.map((row) => {
          const Icon = Icons[row.icon] || Icons.FileText;
          return (
            <div key={row.label} className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-gold/10 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-gold" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{row.label}</p>
                <p className="text-sm text-gray-700">{row.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 pt-5 border-t border-gray-100 text-[12.5px] text-gray-500">
        For account issues (registration, password, or verification), current students and faculty should
        contact their Chairperson or the System Administrator directly through the Messages feature once
        logged in.
      </div>
    </PublicPageShell>
  );
}
