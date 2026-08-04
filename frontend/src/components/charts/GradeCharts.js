import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export function GradeDistributionChart({ distribution }) {
  if (!distribution) return null;

  // GWA labels from 1.0 to 5.0
  const labels = Object.keys(distribution).map(k => parseFloat(k).toFixed(2));
  const values = Object.values(distribution);

  // Color coding: 1.0-1.75 = green, 2.0-2.5 = yellow, 2.75-3.0 = orange, 5.0 = red
  const colors = labels.map(l => {
    const v = parseFloat(l);
    if (v <= 1.75) return '#22c55e';
    if (v <= 2.5) return '#eab308';
    if (v <= 3.0) return '#f97316';
    return '#ef4444';
  });

  const data = {
    labels,
    datasets: [
      {
        label: 'Number of Grades',
        data: values,
        backgroundColor: colors,
        borderColor: colors.map(c => c + 'dd'),
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (ctx) => `GWA: ${ctx[0].label}`,
          label: (ctx) => {
            const gwa = parseFloat(ctx.label);
            let desc = '';
            if (gwa === 1.0) desc = 'Excellent';
            else if (gwa <= 1.5) desc = 'Very Good';
            else if (gwa <= 2.0) desc = 'Good';
            else if (gwa <= 2.5) desc = 'Satisfactory';
            else if (gwa <= 3.0) desc = 'Passing';
            else desc = 'Failed';
            return `${ctx.raw} student${ctx.raw !== 1 ? 's' : ''} — ${desc}`;
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: 'GWA Value', font: { size: 12 } },
        grid: { display: false },
      },
      y: {
        title: { display: true, text: 'Number of Students', font: { size: 12 } },
        beginAtZero: true,
        ticks: { stepSize: 1 },
      },
    },
  };

  return (
    <div style={{ height: '300px' }}>
      <Bar data={data} options={options} />
    </div>
  );
}