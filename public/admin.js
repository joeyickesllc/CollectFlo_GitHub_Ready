// Timezone utility function for Central Standard Time
function formatDateCST(dateValue) {
  if (!dateValue) return '-';
  
  let date;
  // Handle different input types
  if (dateValue instanceof Date) {
    // Already a Date object
    date = dateValue;
  } else if (typeof dateValue === 'string') {
    // Handle string formats
    if (dateValue.includes('T') || dateValue.includes('Z')) {
      // Already has time component or is ISO string
      date = new Date(dateValue);
    } else {
      // Just a date string like "2025-08-26", treat as local date
      date = new Date(dateValue + 'T00:00:00');
    }
  } else {
    // Try to convert whatever it is to a Date
    date = new Date(dateValue);
  }
  
  // Check if date is valid
  if (isNaN(date.getTime())) {
    console.warn('Invalid date:', dateValue);
    return 'Invalid Date';
  }
  
  return date.toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    month: 'numeric',
    day: 'numeric', 
    year: 'numeric'
  });
}

async function fetchAdminStats() {
  const res = await fetch('/api/admin/stats', { credentials: 'include' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load admin stats (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showError(message) {
  const el = document.getElementById('admin-alert');
  if (el) {
    el.classList.remove('hidden');
    el.textContent = message;
  }
}

function renderRecentUsers(users) {
  const tbody = document.getElementById('recentUsersBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="px-4 py-8 text-center text-gray-500">No users</td></tr>';
    return;
  }
  for (const u of users) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm text-gray-700">${u.id}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${u.email}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${new Date(u.created_at).toLocaleString()}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function initAdmin() {
  try {
    const data = await fetchAdminStats();
    const s = data.stats || {};

    setText('usersCount', s.users ?? '-');
    setText('companiesCount', s.companies ?? '-');

    setText('totalInvoices', s.invoices?.total ?? '-');
    setText('outstandingInvoices', s.invoices?.outstanding ?? '-');
    setText('totalOutstanding', (s.invoices?.totalOutstandingAmount ?? 0).toFixed ? s.invoices.totalOutstandingAmount.toFixed(2) : s.invoices?.totalOutstandingAmount ?? '-');

    setText('followupsTotal', s.followUps?.total ?? '-');
    setText('followupsPending', s.followUps?.pending ?? '-');
    setText('followupsDelivered', s.followUps?.delivered ?? '-');

    renderRecentUsers(s.recentUsers);
    renderPageAnalytics(s.pageViews);
  } catch (err) {
    console.error('Admin load error:', err);
    showError(err.message || 'Failed to load admin stats');
  }
}

function renderPageAnalytics(pageViews) {
  if (!pageViews) return;

  // Update total page views in header
  setText('totalPageViews', pageViews.totalViews || '-');
  // Update today's page views in header
  setText('todaysPageViews', pageViews.todayViews || '-');

  // Render top pages by views
  const topPagesEl = document.getElementById('topPagesByViews');
  if (topPagesEl && pageViews.topPages) {
    topPagesEl.innerHTML = '';
    if (pageViews.topPages.length === 0) {
      topPagesEl.innerHTML = '<div class="text-center text-gray-500 py-4">No page data available</div>';
    } else {
      pageViews.topPages.forEach(page => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center py-2 border-b border-gray-100';
        div.innerHTML = `
          <span class="text-sm font-medium">${page.page}</span>
          <span class="text-sm text-gray-600">${page.views} views</span>
        `;
        topPagesEl.appendChild(div);
      });
    }
  }

  // Render traffic sources
  const sourcesEl = document.getElementById('trafficSources');
  if (sourcesEl && pageViews.sources) {
    sourcesEl.innerHTML = '';
    if (pageViews.sources.length === 0) {
      sourcesEl.innerHTML = '<div class="text-center text-gray-500 py-4">No source data available</div>';
    } else {
      pageViews.sources.forEach(source => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center py-2 border-b border-gray-100';
        div.innerHTML = `
          <span class="text-sm font-medium">${source.source || 'Direct'}</span>
          <span class="text-sm text-gray-600">${source.visits} visits</span>
        `;
        sourcesEl.appendChild(div);
      });
    }
  }

  // Render page performance
  const perfEl = document.getElementById('pagePerformance');
  if (perfEl && pageViews.performance) {
    perfEl.innerHTML = '';
    if (pageViews.performance.length === 0) {
      perfEl.innerHTML = '<div class="text-center text-gray-500 py-4">No performance data available</div>';
    } else {
      pageViews.performance.forEach(perf => {
        const div = document.createElement('div');
        div.className = 'py-2 border-b border-gray-100';
        div.innerHTML = `
          <div class="text-sm font-medium">${perf.page}</div>
          <div class="text-xs text-gray-600 mt-1">
            ${perf.unique_users} unique users, ${perf.active_days} active days
          </div>
        `;
        perfEl.appendChild(div);
      });
    }
  }

  // Render detailed analytics table
  const detailedEl = document.getElementById('detailedPageAnalytics');
  if (detailedEl && pageViews.detailed) {
    detailedEl.innerHTML = '';
    if (pageViews.detailed.length === 0) {
      detailedEl.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">No detailed analytics available</td></tr>';
    } else {
      pageViews.detailed.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="px-4 py-2 text-sm text-gray-700">${row.page}</td>
          <td class="px-4 py-2 text-sm text-gray-700">${row.total_views}</td>
          <td class="px-4 py-2 text-sm text-gray-700">${row.unique_users}</td>
          <td class="px-4 py-2 text-sm text-gray-700">${row.active_days}</td>
          <td class="px-4 py-2 text-sm text-gray-700">${formatDateCST(row.last_visit)}</td>
        `;
        detailedEl.appendChild(tr);
      });
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}