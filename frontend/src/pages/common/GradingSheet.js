import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { gradeService } from '../../services';
import { LoadingSpinner } from '../../components/common';
import toast from 'react-hot-toast';

const TOTAL_ROWS = 25;

const remarksFor = (status) => {
  if (status === 'Passed') return 'PASSED';
  if (status === 'Failed') return 'FAILED';
  if (status === 'INC') return 'INC';
  if (status === 'DRP') return 'DRP';
  return '';
};

export default function GradingSheet() {
  const { classId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data: result } = await gradeService.getByClass(classId);
        setData(result);
      } catch (err) {
        toast.error('Failed to load grading sheet');
      } finally {
        setLoading(false);
      }
    })();
  }, [classId]);

  if (loading) return <LoadingSpinner />;
  if (!data) return <p className="p-10 text-center text-gray-400">Class not found.</p>;

  const cls = data.class;
  const subject = cls.subject || {};
  const rows = (data.student_grades || [])
    .slice()
    .sort((a, b) => (a.student?.name || '').localeCompare(b.student?.name || ''));
  const padded = [...rows, ...Array(Math.max(0, TOTAL_ROWS - rows.length)).fill(null)].slice(0, Math.max(TOTAL_ROWS, rows.length));

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#111', maxWidth: 900, margin: '0 auto', padding: '24px' }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
        }
        .gs-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .gs-table th, .gs-table td { border: 1px solid #333; padding: 4px 6px; }
        .gs-table th { background: #f0f0f0; font-weight: 600; text-align: center; }
        .gs-table td { height: 22px; }
      `}</style>

      <div className="no-print" style={{ textAlign: 'right', marginBottom: 16 }}>
        <button onClick={() => window.print()} style={{ padding: '8px 16px', background: '#c9a84c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
          Print
        </button>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/assets/logos/ssu-logo.png" alt="SSU" style={{ width: 56, height: 56 }} />
          <div>
            <p style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>SAMAR STATE UNIVERSITY</p>
            <p style={{ fontSize: 11, margin: 0 }}>Arteche Blvd., Catbalogan City, Philippines 6700</p>
            <p style={{ fontSize: 11, margin: 0 }}>Office of the University Registrar | Main Campus</p>
          </div>
        </div>
        <p style={{ fontSize: 10, textAlign: 'right', margin: 0 }}>SSU-UNREG-FR-017<br />REV 8</p>
      </div>

      <h2 style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, margin: '18px 0 14px' }}>GRADING SHEET</h2>

      <p style={{ fontSize: 12, margin: '4px 0' }}>
        SY <b>{cls.academic_year || '________'}</b>, <b>{cls.semester || '________'}</b>
      </p>
      <p style={{ fontSize: 12, margin: '4px 0 2px' }}><b>{subject.program || '________________________'}</b></p>
      <p style={{ fontSize: 10, margin: '0 0 14px', fontStyle: 'italic' }}>(Curriculum/Program)</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 12, marginBottom: 14 }}>
        <p style={{ margin: 0 }}><b>Subject Code:</b> {subject.code}</p>
        <p style={{ margin: 0 }}><b>Units:</b> {subject.units}</p>
        <p style={{ margin: 0 }}><b>Course Description:</b> {subject.name}</p>
        <p style={{ margin: 0 }}><b>Instructor/Professor:</b> {cls.instructor?.name}</p>
      </div>

      <table className="gs-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>No</th>
            <th style={{ width: 130 }}>Student ID Number</th>
            <th>Name</th>
            <th style={{ width: 70 }}>Midterm</th>
            <th style={{ width: 70 }}>Finals</th>
            <th style={{ width: 80 }}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {padded.map((row, i) => (
            <tr key={i}>
              <td style={{ textAlign: 'center' }}>{i + 1}</td>
              <td>{row?.student?.student_no || ''}</td>
              <td>{row?.student?.name || ''}</td>
              <td style={{ textAlign: 'center' }}>{row?.grade?.midterm ? parseFloat(row.grade.midterm).toFixed(2) : ''}</td>
              <td style={{ textAlign: 'center' }}>{row?.grade?.finals ? parseFloat(row.grade.finals).toFixed(2) : ''}</td>
              <td style={{ textAlign: 'center' }}>{row?.grade ? remarksFor(row.grade.status) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 18, fontSize: 11, marginTop: 8 }}>
        <span><b>Passed:</b> {rows.filter((r) => r.grade?.status === 'Passed').length}</span>
        <span><b>INC:</b> {rows.filter((r) => r.grade?.status === 'INC').length}</span>
        <span><b>Dropped:</b> {rows.filter((r) => r.grade?.status === 'DRP').length}</span>
        <span><b>Failed:</b> {rows.filter((r) => r.grade?.status === 'Failed').length}</span>
      </div>

      <p style={{ fontSize: 10, marginTop: 10 }}>
        <b>Note:</b> This form should be submitted within Ten (10) working days after the Midterm/Final Exam. (As per Board Res. No. 32 s. 2002).
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12, marginTop: 40 }}>
        <div>
          <p style={{ borderTop: '1px solid #333', paddingTop: 4, margin: 0, textAlign: 'center' }}>Verified Correct</p>
          <p style={{ fontSize: 10, textAlign: 'center', margin: 0 }}>Dean, College of {subject.department || 'Arts and Sciences'}</p>
        </div>
        <div>
          <p style={{ borderTop: '1px solid #333', paddingTop: 4, margin: 0, textAlign: 'center' }}>Submitted by</p>
          <p style={{ fontSize: 10, textAlign: 'center', margin: 0 }}>Instructor/Professor</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12, marginTop: 40 }}>
        <div>
          <p style={{ margin: '0 0 24px' }}>Received by:</p>
          <p style={{ borderTop: '1px solid #333', paddingTop: 4, margin: 0, textAlign: 'center', fontWeight: 700 }}>IMELDA O. VELASCO</p>
          <p style={{ fontSize: 10, textAlign: 'center', margin: 0 }}>University Registrar</p>
        </div>
        <div>
          <p style={{ margin: '0 0 24px' }}>Approved:</p>
          <p style={{ borderTop: '1px solid #333', paddingTop: 4, margin: 0, textAlign: 'center', fontWeight: 700 }}>GINA U. ESPAÑO, Ph.D.</p>
          <p style={{ fontSize: 10, textAlign: 'center', margin: 0 }}>Vice President for Academic Affairs</p>
        </div>
      </div>

      <p style={{ fontSize: 9, textAlign: 'center', marginTop: 30, color: '#666' }}>
        Website: www.ssu.edu.ph | Contact us: (055) 530-0629 | info@ssu.edu.ph | Page 1 of 1
      </p>
    </div>
  );
}
