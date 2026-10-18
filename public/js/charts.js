import { formatJalaliDate, toPersianDigits } from './jalali.js';

/** Chart.js is loaded from /vendor/chart.umd.js; the app degrades without it. */
export function chartLib() {
  return typeof window !== 'undefined' && window.Chart ? window.Chart : null;
}

export const COLORS = {
  line: '#7c3aed',
  fill: 'rgba(124, 58, 237, 0.16)',
  gain: '#16a34a',
  loss: '#dc2626',
  edge: '#2563eb',
  grid: '#ece7fb',
};

const FA_FONT = { family: 'Vazirmatn, Tahoma, sans-serif', size: 12 };

function digits(value, persianDigits) {
  const text = String(value);
  return persianDigits ? toPersianDigits(text) : text;
}

/**
 * Pure builder for the student "my points over time" chart so the shape can be
 * unit tested without a canvas. Returns the Chart.js configuration plus the
 * derived point metadata.
 */
export function buildPointsChartConfig(series, { persianDigits = true } = {}) {
  const points = Array.isArray(series?.points) ? series.points : [];
  const start = Number(series?.start ?? 0);

  const labels = ['شروع', ...points.map((point) => formatJalaliDate(point.createdAt, { persianDigits }))];
  const data = [start, ...points.map((point) => Number(point.total ?? 0))];
  const deltas = [null, ...points.map((point) => Number(point.delta ?? 0))];

  const colors = data.map((_value, index) => {
    const isEdge = index === 0 || index === data.length - 1;
    if (isEdge) return COLORS.edge;
    const delta = deltas[index] ?? 0;
    if (delta > 0) return COLORS.gain;
    if (delta < 0) return COLORS.loss;
    return COLORS.edge;
  });

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'امتیاز من',
          data,
          borderColor: COLORS.line,
          backgroundColor: COLORS.fill,
          borderWidth: 3,
          fill: true,
          tension: 0.35,
          pointRadius: points.length > 40 ? 2 : 5,
          pointHoverRadius: 7,
          pointBackgroundColor: colors,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          textDirection: 'rtl',
          backgroundColor: 'rgba(30, 27, 75, 0.92)',
          titleFont: FA_FONT,
          bodyFont: FA_FONT,
          callbacks: {
            label(context) {
              const index = context.dataIndex;
              const lines = [`امتیاز کل: ${digits(data[index], persianDigits)}`];
              const delta = deltas[index];
              if (delta !== null && delta !== undefined && delta !== 0) {
                const sign = delta > 0 ? '+' : '−';
                lines.push(`تغییر: ${sign}${digits(Math.abs(delta), persianDigits)}`);
              }
              const reason = points[index - 1]?.reason;
              if (reason) lines.push(`دلیل: ${reason}`);
              const column = points[index - 1]?.columnName;
              if (column) lines.push(`ستون: ${column}`);
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: FA_FONT, maxRotation: 0, autoSkipPadding: 16 },
        },
        y: {
          beginAtZero: true,
          grid: { color: COLORS.grid },
          ticks: {
            font: FA_FONT,
            precision: 0,
            callback: (value) => digits(value, persianDigits),
          },
        },
      },
    },
  };

  return { config, labels, data, deltas, colors };
}

function mountChart(canvas, config) {
  const Lib = chartLib();
  if (!Lib || !canvas) return null;
  if (canvas.__chart) {
    canvas.__chart.destroy();
    canvas.__chart = null;
  }
  const instance = new Lib(canvas, config);
  canvas.__chart = instance;
  return instance;
}

/** Renders the student progress chart. Returns the Chart instance or null. */
export function renderPointsChart(canvas, series, options = {}) {
  const { config } = buildPointsChartConfig(series, options);
  return mountChart(canvas, config);
}

/** Simple bar chart used by the report card. */
export function renderBars(canvas, labels, values, { persianDigits = true, label = 'امتیاز' } = {}) {
  const config = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          backgroundColor: 'rgba(168, 85, 247, 0.65)',
          borderColor: COLORS.line,
          borderWidth: 1,
          borderRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { rtl: true, textDirection: 'rtl', titleFont: FA_FONT, bodyFont: FA_FONT },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: FA_FONT } },
        y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { font: FA_FONT, precision: 0, callback: (value) => digits(value, persianDigits) } },
      },
    },
  };
  return mountChart(canvas, config);
}

export function destroyChart(canvas) {
  if (canvas && canvas.__chart) {
    canvas.__chart.destroy();
    canvas.__chart = null;
  }
}
