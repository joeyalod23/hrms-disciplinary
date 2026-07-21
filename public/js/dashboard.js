document.addEventListener('DOMContentLoaded', function() {
  if (typeof severityLabels !== 'undefined' && document.getElementById('severityChart')) {
    const sevColors = { 'Light': '#0dcaf0', 'Less Serious': '#ffc107', 'Serious': '#dc3545' };
    new Chart(document.getElementById('severityChart'), {
      type: 'doughnut',
      data: {
        labels: severityLabels,
        datasets: [{
          data: severityCounts,
          backgroundColor: severityLabels.map(s => sevColors[s] || '#6c757d')
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }
  if (typeof monthlyLabels !== 'undefined' && document.getElementById('monthlyChart')) {
    new Chart(document.getElementById('monthlyChart'), {
      type: 'line',
      data: {
        labels: monthlyLabels,
        datasets: [{
          label: 'Cases',
          data: monthlyCounts,
          borderColor: '#0f3460',
          backgroundColor: 'rgba(15,52,96,0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  }

  if (typeof attBreakdown !== 'undefined' && document.getElementById('attBreakdownChart')) {
    new Chart(document.getElementById('attBreakdownChart'), {
      type: 'doughnut',
      data: {
        labels: attBreakdown.labels,
        datasets: [{
          data: attBreakdown.counts,
          backgroundColor: ['#198754', '#ffc107', '#6c757d', '#dc3545', '#0dcaf0', '#0d6efd']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }
      }
    });
  }
  if (typeof statusLabels !== 'undefined' && document.getElementById('statusChart')) {
    const colors = { 'Open': '#0d6efd', 'Under Investigation': '#ffc107', 'For Hearing': '#0dcaf0', 'Resolved': '#198754', 'Dismissed': '#6c757d', 'Appealed': '#dc3545' };
    new Chart(document.getElementById('statusChart'), {
      type: 'doughnut',
      data: {
        labels: statusLabels,
        datasets: [{
          data: statusCounts,
          backgroundColor: statusLabels.map(s => colors[s] || '#6c757d')
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }

  if (typeof groupLabels !== 'undefined' && document.getElementById('groupChart')) {
    const groupColors = { 'Group A': '#dc3545', 'Group B': '#ffc107', 'Group C': '#0d6efd', 'Group D': '#198754', 'Group E': '#6c757d' };
    new Chart(document.getElementById('groupChart'), {
      type: 'bar',
      data: {
        labels: groupLabels,
        datasets: [
          { label: 'Cases', data: groupCounts, backgroundColor: groupLabels.map(l => groupColors[l] || '#6c757d'), borderRadius: 4, yAxisID: 'y' },
          { label: 'Weight', data: groupWeights, type: 'line', borderColor: '#c0392b', backgroundColor: 'rgba(192,57,43,0.1)', fill: false, tension: 0.3, yAxisID: 'y1' }
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
