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
    const statsResponse = await fetch('/api/dashboard/stats', { credentials: 'include' });

    // Redirect ONLY for authentication failures (401/403)
    if (statsResponse.status === 401 || statsResponse.status === 403) {
      console.log('Stats auth error, redirecting to login');
      redirectToLogin();
      return;
    }

    const stats = statsResponse.ok ? await statsResponse.json().catch(() => ({})) : {};

    // Update first analytics section
    const totalFollowupsEl = document.getElementById('total-followups');
    if (totalFollowupsEl) {
      totalFollowupsEl.textContent = stats.totalFollowups?.count || '0';
    }

    const pendingFollowupsEl = document.getElementById('pending-followups');
    if (pendingFollowupsEl) {
      pendingFollowupsEl.textContent = stats.pendingFollowups?.count || '0';
    }

    const deliveredFollowupsEl = document.getElementById('delivered-followups');
    if (deliveredFollowupsEl) {
      deliveredFollowupsEl.textContent = stats.deliveredFollowups?.count || '0';
    }

    const outstandingAmountEl = document.getElementById('outstanding-amount');
    if (outstandingAmountEl) {
      outstandingAmountEl.textContent = `$${(stats.outstandingAmount?.total || 0).toLocaleString()}`;
    }

    // Update second analytics section
    const totalOutstandingEl = document.getElementById('totalOutstanding');
    if (totalOutstandingEl) {
      totalOutstandingEl.textContent = `$${stats.totalOutstanding?.total?.toFixed(2) || '0.00'}`;
    }

    const followupsTodayEl = document.getElementById('followupsToday');
    if (followupsTodayEl) {
      followupsTodayEl.textContent = stats.followupsToday?.count || '0';
    }

    const openRateEl = document.getElementById('openRate');
    if (openRateEl) {
      openRateEl.textContent = `${stats.openRate?.rate || '0'}%`;
    }

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

  const invoices = response.ok ? await response.json().catch(() => []) : [];
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
  }
}

// Toggle invoice exclusion
window.toggleInvoiceExclusion = async function (invoiceId, isIncluded) {
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
};

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
  const userNameEl = document.getElementById('user-name');
if (userNameEl) {
  userNameEl.textContent = userInfo.full_name || userInfo.email;
}

const companyNameEl = document.getElementById('company-name');
if (companyNameEl) {
  companyNameEl.textContent = userInfo.company_name || 'Your Company';
}    }
  })
  .catch(error => {
    console.error('Authentication error:', error);
    redirectToLogin();
  });


// Load invoices list
// [REMOVED DUPLICATE FUNCTION loadInvoices THAT WROTE TO invoices-table-body]

// Toggle invoice exclusion
window.toggleExclusion = async function (invoiceId, excluded) {
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
};
// Load dashboard data (unused legacy function removed)

// Load dashboard statistics (legacy, removed in favor of updateStats())

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

