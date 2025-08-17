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
  } catch (err) {
    console.error('Admin load error:', err);
    showError(err.message || 'Failed to load admin stats');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}