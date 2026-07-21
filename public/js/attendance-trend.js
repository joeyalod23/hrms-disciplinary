document.addEventListener('DOMContentLoaded', function() {
  if (typeof dailyTrendData !== 'undefined' && document.getElementById('dailyTrendChart')) {
    const labels = dailyTrendData.map(function(d) { return d.date ? d.date.slice(5) : '' });
    const presentData = dailyTrendData.map(function(d) { return d.present });
    const totalData = dailyTrendData.map(function(d) { return d.total });
    new Chart(document.getElementById('dailyTrendChart'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Present/Late',
            data: presentData,
            borderColor: '#198754',
            backgroundColor: 'rgba(25,135,84,0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 3
          },
          {
            label: 'Total Records',
            data: totalData,
            borderColor: '#6c757d',
            backgroundColor: 'rgba(108,117,125,0.05)',
            fill: false,
            tension: 0.3,
            borderDash: [4, 4],
            pointRadius: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } }
        },
        scales: {
          x: { ticks: { maxTicksLimit: 10, font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } }
        }
      }
    });
  }
});
