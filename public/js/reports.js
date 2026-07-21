document.addEventListener('DOMContentLoaded', function() {
  const colors = ['#0d6efd','#198754','#ffc107','#dc3545','#0dcaf0','#6c757d','#fd7e14','#6610f2'];

  if (typeof deptLabels !== 'undefined' && document.getElementById('deptChart')) {
    new Chart(document.getElementById('deptChart'), {
      type: 'bar',
      data: {
        labels: deptLabels,
        datasets: [{ label: 'Cases', data: deptCounts, backgroundColor: colors.slice(0, deptLabels.length), borderRadius: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  }

  if (typeof trendLabels !== 'undefined' && document.getElementById('trendChart')) {
    new Chart(document.getElementById('trendChart'), {
      type: 'line',
      data: {
        labels: trendLabels,
        datasets: [{ label: 'Cases', data: trendCounts, borderColor: '#0f3460', backgroundColor: 'rgba(15,52,96,0.1)', fill: true, tension: 0.3 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  }

  if (typeof offenseLabels !== 'undefined' && document.getElementById('offenseChart')) {
    new Chart(document.getElementById('offenseChart'), {
      type: 'bar',
      data: {
        labels: offenseLabels,
        datasets: [{ label: 'Cases', data: offenseCounts, backgroundColor: colors.slice(0, offenseLabels.length), borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  }

  if (typeof statusLabels !== 'undefined' && document.getElementById('statusChart')) {
    const sColors = { 'Open': '#0d6efd', 'Under Investigation': '#ffc107', 'For Hearing': '#0dcaf0', 'Resolved': '#198754', 'Dismissed': '#6c757d', 'Appealed': '#dc3545' };
    new Chart(document.getElementById('statusChart'), {
      type: 'pie',
      data: {
        labels: statusLabels,
        datasets: [{ data: statusCounts, backgroundColor: statusLabels.map(s => sColors[s] || '#6c757d') }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
  }

  if (typeof severityLabels !== 'undefined' && document.getElementById('severityChart')) {
    const sevColors = { 'Light': '#0dcaf0', 'Less Serious': '#ffc107', 'Serious': '#dc3545' };
    new Chart(document.getElementById('severityChart'), {
      type: 'doughnut',
      data: {
        labels: severityLabels,
        datasets: [{ data: severityCounts, backgroundColor: severityLabels.map(s => sevColors[s] || '#6c757d') }]
      },
      options: { cutout: '65%', responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } }
    });
  }

  if (typeof codGroupLabels !== 'undefined' && document.getElementById('codGroupChart')) {
    const groupColors = { 'Group A': '#dc3545', 'Group B': '#ffc107', 'Group C': '#0d6efd', 'Group D': '#198754', 'Group E': '#6c757d' };
    new Chart(document.getElementById('codGroupChart'), {
      type: 'bar',
      data: {
        labels: codGroupLabels,
        datasets: [
          { label: 'Cases', data: codGroupCounts, backgroundColor: codGroupLabels.map(l => groupColors[l] || '#6c757d'), borderRadius: 4, yAxisID: 'y' },
          { label: 'Weight Score', data: codGroupWeights, type: 'line', borderColor: '#c0392b', backgroundColor: 'rgba(192,57,43,0.1)', fill: false, tension: 0.3, yAxisID: 'y1' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 }, title: { display: true, text: 'Cases' } },
          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Weight' } }
        }
      }
    });
  }
});
