// Check authentication status on page load
// ------------------------------------------------------------------
// Centralised login redirect helper
// Ensures we attempt to redirect only once even if multiple auth checks
// fail at roughly the same time.
// ------------------------------------------------------------------
let hasRedirected = false;
function redirectToLogin(delay = 100) {
  if (hasRedirected) return;
  hasRedirected = true;
  setTimeout(() => (window.location.href = '/login'), delay);
}

async function checkAuthentication() {
  try {
    console.log('Checking authentication...');
    const response = await fetch('/api/user-info', { 
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    console.log('Auth response status:', response.status);

    if (!response.ok) {
      console.log('User not authenticated, status:', response.status);
      redirectToLogin();
      return false;
    }

    const user = await response.json();
    console.log('User authenticated:', user.email);
    return true;
  } catch (error) {
    console.error('Authentication check failed:', error);
    redirectToLogin();
    return false;
  }
}

// Fetch dashboard stats
async function updateStats() {
  try {
    const [statsResponse, analyticsResponse] = await Promise.all([
      fetch('/api/dashboard/stats', { credentials: 'include' }),
      fetch('/api/dashboard/analytics', { credentials: 'include' })
    ]);

    // Redirect ONLY for authentication failures (401/403), ignore 404/501
    if (
      statsResponse.status === 401 || statsResponse.status === 403 ||
      analyticsResponse.status === 401 || analyticsResponse.status === 403
    ) {
      console.log('Stats/analytics auth error, redirecting to login');
      redirectToLogin();
      return;
    }

    const stats = await statsResponse.json();
    const analytics = await analyticsResponse.json();

    // Update payment analytics
    document.getElementById('avgDaysToPayment').textContent = 
      `${(analytics.avgDaysToPayment?.toFixed(1) || '0.0')} days`;
    document.getElementById('paymentTrend').textContent = 
      `${analytics.paymentTrendPercentage}%`;

    document.getElementById('totalOutstanding').textContent = 
      `$${stats.totalOutstanding?.total?.toFixed(2) || '0.00'}`;
    document.getElementById('followupsToday').textContent = 
      stats.followupsToday?.count || '0';
    document.getElementById('openRate').textContent = 
      `${stats.openRate?.rate || '0'}%`;
  } catch (error) {
    console.error('Error updating stats:', error);
    // Log the error but do not force logout for missing/invalid data
  }
}

// Fetch and display invoices
async function updateInvoices() {
  try {
    const response = await fetch('/api/invoices', { credentials: 'include' });

    // Redirect only when authentication fails
    if (response.status === 401 || response.status === 403) {
      console.log('Invoice API auth error, redirecting to login');
      redirectToLogin();
      return;
    }

    const invoices = await response.json();

    const tbody = document.getElementById('invoiceTableBody');
    tbody.innerHTML = invoices.map(invoice => `
      <tr>
        <td class="px-6 py-4">
          <input 
            type="checkbox" 
            ${invoice.excluded ? '' : 'checked'} 
            onchange="toggleInvoiceExclusion('${invoice.invoice_id}', this.checked)"
            class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
          />
        </td>
        <td class="px-6 py-4">${invoice.invoice_id}</td>
        <td class="px-6 py-4">${invoice.customer_name}</td>
        <td class="px-6 py-4">${new Date(invoice.due_date).toLocaleDateString()}</td>
        <td class="px-6 py-4">$${invoice.amount.toFixed(2)}</td>
        <td class="px-6 py-4">${invoice.status}</td>
        <td class="px-6 py-4">${invoice.next_followup ? new Date(invoice.next_followup).toLocaleDateString() : 'N/A'}</td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error updating invoices:', error);
    redirectToLogin();
  }
}

// Toggle invoice exclusion
async function toggleInvoiceExclusion(invoiceId, isIncluded) {
  try {
    const response = await fetch('/api/invoices/toggle-exclusion', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invoice_id: invoiceId,
        excluded: !isIncluded
      })
    });

    if (!response.ok) {
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      throw new Error('Failed to update exclusion status');
    }

    // Refresh the dashboard stats since excluded invoices affect calculations
    updateStats();
  } catch (error) {
    console.error('Error toggling exclusion:', error);
    // Revert checkbox state on error
    updateInvoices();
  }
}

// Initialize dashboard
async function initializeDashboard() {
  const isAuthenticated = await checkAuthentication();

  if (isAuthenticated) {
    updateStats();
    updateInvoices();

    // Update dashboard every minute
    setInterval(() => {
      updateStats();
      updateInvoices();
    }, 60000);
  }
}

// Start initialization when page loads
document.addEventListener('DOMContentLoaded', initializeDashboard);

// ------------------------------------------------------------------
// Duplicate auth-check block ­– keep but use central redirect helper
// ------------------------------------------------------------------
// Check authentication on page load
fetch('/api/user-info', {
  credentials: 'include', // Include cookies
  headers: {
    'Cache-Control': 'no-cache'
  }
})
  .then(response => {
    console.log('Dashboard auth check response:', response.status);
    if (!response.ok) {
      console.log('Not authenticated, redirecting to login');
      redirectToLogin();
      return;
    }
    return response.json();
  })
  .then(userInfo => {
    if (userInfo) {
      console.log('User authenticated on dashboard:', userInfo.email);
      document.getElementById('user-name').textContent = userInfo.full_name || userInfo.email;
      document.getElementById('company-name').textContent = userInfo.company_name || 'Your Company';
      loadDashboardData();
    }
  })
  .catch(error => {
    console.error('Authentication error:', error);
    redirectToLogin();
  });

// Load dashboard statistics
async function loadDashboardStats() {
  try {
    const response = await fetch('/api/dashboard/stats', {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const stats = await response.json();

    // Update stats display
    document.getElementById('total-outstanding').textContent = 
      `$${(stats.totalOutstanding?.total || 0).toLocaleString()}`;
    document.getElementById('followups-today').textContent = 
      stats.followupsToday?.count || 0;
    document.getElementById('open-rate').textContent = 
      `${stats.openRate?.rate || 0}%`;

  } catch (error) {
    console.error('Error loading dashboard stats:', error);
    document.getElementById('total-outstanding').textContent = 'Error';
    document.getElementById('followups-today').textContent = 'Error';
    document.getElementById('open-rate').textContent = 'Error';
  }
}

// Load invoices list
async function loadInvoices() {
  try {
    const response = await fetch('/api/invoices', {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const invoices = await response.json();
    const tableBody = document.getElementById('invoices-table-body');

    if (invoices.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" class="px-6 py-4 text-center text-gray-500">
            No outstanding invoices found. <a href="/settings" class="text-blue-600 hover:underline">Connect QuickBooks</a> to import invoices.
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = invoices.map(invoice => `
      <tr>
        <td class="px-6 py-4 text-sm text-gray-900">${invoice.invoice_id}</td>
        <td class="px-6 py-4 text-sm text-gray-900">${invoice.customer_name || 'Unknown'}</td>
        <td class="px-6 py-4 text-sm text-gray-900">${new Date(invoice.due_date).toLocaleDateString()}</td>
        <td class="px-6 py-4 text-sm text-gray-900">$${(invoice.balance || 0).toLocaleString()}</td>
        <td class="px-6 py-4 text-sm">
          <span class="inline-flex px-2 py-1 text-xs font-medium rounded-full ${
            invoice.excluded ? 'bg-gray-100 text-gray-800' : 
            invoice.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
          }">
            ${invoice.excluded ? 'Excluded' : invoice.status === 'paid' ? 'Paid' : 'Pending'}
          </span>
        </td>
        <td class="px-6 py-4 text-sm">
          <button onclick="toggleExclusion('${invoice.invoice_id}', ${!invoice.excluded})" 
                  class="text-blue-600 hover:text-blue-800">
            ${invoice.excluded ? 'Include' : 'Exclude'}
          </button>
        </td>
      </tr>
    `).join('');

  } catch (error) {
    console.error('Error loading invoices:', error);
    document.getElementById('invoices-table-body').innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-4 text-center text-red-500">
          Error loading invoices. Please refresh the page.
        </td>
      </tr>
    `;
  }
}

// Toggle invoice exclusion
async function toggleExclusion(invoiceId, excluded) {
  try {
    const response = await fetch('/api/invoices/toggle-exclusion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({
        invoice_id: invoiceId,
        excluded: excluded
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Reload invoices to reflect changes
    loadInvoices();
    loadDashboardStats();

  } catch (error) {
    console.error('Error toggling exclusion:', error);
    alert('Failed to update invoice status. Please try again.');
  }
}
// Load dashboard data
async function loadDashboard() {
    try {
        // Check authentication first
        const userResponse = await fetch('/api/user-info');
        if (!userResponse.ok) {
            console.log('User not authenticated, status:', userResponse.status);
            window.location.href = '/login';
            return;
        }

        const user = await userResponse.json();
        console.log('User authenticated:', user.email);

        // Update user info in nav if available
        if (typeof updateUserInfo === 'function') {
            updateUserInfo(user);
        }

        // Load dashboard stats
        await loadStats();

        // Load invoices
        await loadInvoices();
    } catch (error) {
        console.error('Dashboard loading error:', error);
        window.location.href = '/login';
    }
}

// Load dashboard statistics
async function loadStats() {
    try {
        const response = await fetch('/api/dashboard/stats');
        if (response.ok) {
            const stats = await response.json();

            document.getElementById('total-followups').textContent = stats.total || 0;
            document.getElementById('pending-followups').textContent = stats.pending || 0;
            document.getElementById('delivered-followups').textContent = stats.delivered || 0;
            document.getElementById('outstanding-amount').textContent = `$${(stats.outstanding || 0).toLocaleString()}`;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load invoices and follow-ups
async function loadInvoices() {
    try {
        const response = await fetch('/api/invoices');
        if (response.ok) {
            const invoices = await response.json();
            displayInvoices(invoices);
        }
    } catch (error) {
        console.error('Error loading invoices:', error);
        document.getElementById('invoices-tbody').innerHTML = 
            '<tr><td colspan="6" class="px-4 py-8 text-center text-red-500">Error loading invoices</td></tr>';
    }
}

// Display invoices in table
function displayInvoices(invoices) {
    const tbody = document.getElementById('invoices-tbody');

    if (!invoices || invoices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-500">No invoices found</td></tr>';
        return;
    }

    tbody.innerHTML = invoices.map(invoice => `
        <tr class="border-b border-gray-100">
            <td class="px-4 py-3 text-sm font-medium">${invoice.invoice_id}</td>
            <td class="px-4 py-3 text-sm">${invoice.customer_name}</td>
            <td class="px-4 py-3 text-sm">$${(invoice.balance || 0).toLocaleString()}</td>
            <td class="px-4 py-3 text-sm">${new Date(invoice.due_date).toLocaleDateString()}</td>
            <td class="px-4 py-3 text-sm">
                <span class="px-2 py-1 text-xs rounded-full ${getStatusColor(invoice.status)}">
                    ${invoice.status}
                </span>
            </td>
            <td class="px-4 py-3 text-sm">${invoice.scheduled_date ? new Date(invoice.scheduled_date).toLocaleDateString() : 'N/A'}</td>
        </tr>
    `).join('');
}

// Get status color classes
function getStatusColor(status) {
    switch (status) {
        case 'pending': return 'bg-yellow-100 text-yellow-800';
        case 'delivered': return 'bg-blue-100 text-blue-800';
        case 'paid': return 'bg-green-100 text-green-800';
        default: return 'bg-gray-100 text-gray-800';
    }
}