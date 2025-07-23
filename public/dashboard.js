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

    // Only redirect for actual auth failures, not missing endpoints
    if (response.status === 401 || response.status === 403) {
      console.log('User not authenticated, status:', response.status);
      redirectToLogin();
      return false;
    }

    // Try to parse user info if available
    let user = {};
    if (response.ok) {
      try {
        user = await response.json();
        console.log('User authenticated:', user.email);
      } catch (e) {
        console.warn('Could not parse user info:', e);
      }
    } else {
      console.warn('User info endpoint returned non-OK status:', response.status);
    }
    
    return true;
  } catch (error) {
    console.error('Authentication check failed:', error);
    // Only redirect for network errors, not for parsing errors
    redirectToLogin();
    return false;
  }
}

// Fetch dashboard stats
async function updateStats() {
  try {
    // Helper function to check for auth errors
    const isAuthError = (response) => response.status === 401 || response.status === 403;
    
    const [statsResponse, analyticsResponse] = await Promise.all([
      fetch('/api/dashboard/stats', { credentials: 'include' }),
      fetch('/api/dashboard/analytics', { credentials: 'include' })
    ]);

    // Only redirect for auth errors (401/403), not for missing endpoints (404/501)
    if (isAuthError(statsResponse) || isAuthError(analyticsResponse)) {
      console.log('Stats/analytics auth error, redirecting to login');
      redirectToLogin();
      return;
    }

    // Use default empty objects for missing endpoints
    let stats = {};
    let analytics = {};
    
    // Try to parse responses if they're OK
    if (statsResponse.ok) {
      try { stats = await statsResponse.json(); } 
      catch (e) { console.warn('Could not parse stats:', e); }
    }
    
    if (analyticsResponse.ok) {
      try { analytics = await analyticsResponse.json(); } 
      catch (e) { console.warn('Could not parse analytics:', e); }
    }

    // Update payment analytics with fallbacks for missing data
    const avgDaysEl = document.getElementById('avgDaysToPayment');
    if (avgDaysEl) {
      avgDaysEl.textContent = analytics.avgDaysToPayment 
        ? `${analytics.avgDaysToPayment.toFixed(1)} days` 
        : 'N/A';
    }
    
    const trendEl = document.getElementById('paymentTrend');
    if (trendEl) {
      trendEl.textContent = analytics.paymentTrendPercentage 
        ? `${analytics.paymentTrendPercentage}%` 
        : 'N/A';
    }

    const outstandingEl = document.getElementById('totalOutstanding');
    if (outstandingEl) {
      outstandingEl.textContent = `$${stats.totalOutstanding?.total?.toFixed(2) || '0.00'}`;
    }
    
    const followupsEl = document.getElementById('followupsToday');
    if (followupsEl) {
      followupsEl.textContent = stats.followupsToday?.count || '0';
    }
    
    const rateEl = document.getElementById('openRate');
    if (rateEl) {
      rateEl.textContent = `${stats.openRate?.rate || '0'}%`;
    }
  } catch (error) {
    console.error('Error updating stats:', error);
    // Don't redirect for data errors
  }
}

// Fetch and display invoices
async function updateInvoices() {
  try {
    const response = await fetch('/api/invoices', { credentials: 'include' });

    // Only redirect for auth errors (401/403), not for missing endpoints (404/501)
    if (response.status === 401 || response.status === 403) {
      console.log('Invoice API auth error, redirecting to login');
      redirectToLogin();
      return;
    }

    // Use empty array for missing/error endpoints
    let invoices = [];
    if (response.ok) {
      try {
        invoices = await response.json();
      } catch (e) {
        console.warn('Could not parse invoices:', e);
      }
    }

    const tbody = document.getElementById('invoiceTableBody');
    if (!tbody) {
      console.warn('Invoice table body element not found');
      return;
    }
    
    if (invoices.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="px-6 py-4 text-center text-gray-500">
            No invoices found or API not implemented yet.
          </td>
        </tr>
      `;
      return;
    }

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
    // Don't redirect for data errors
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

    if (response.status === 401 || response.status === 403) {
      redirectToLogin();
      return;
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
    // Only redirect for auth errors (401/403), not for missing endpoints
    if (response.status === 401 || response.status === 403) {
      console.log('Not authenticated, redirecting to login');
      redirectToLogin();
      return null;
    }
    
    // Try to parse response if it's OK
    if (response.ok) {
      return response.json().catch(err => {
        console.warn('Failed to parse user info:', err);
        return null;
      });
    }
    
    console.warn('User info endpoint returned non-OK status:', response.status);
    return null;
  })
  .then(userInfo => {
    if (userInfo) {
      console.log('User authenticated on dashboard:', userInfo.email);
      
      // Safely update user info elements if they exist
      const userNameEl = document.getElementById('user-name');
      if (userNameEl) {
        userNameEl.textContent = userInfo.full_name || userInfo.email;
      }
      
      const companyNameEl = document.getElementById('company-name');
      if (companyNameEl) {
        companyNameEl.textContent = userInfo.company_name || 'Your Company';
      }
      
      if (typeof loadDashboardData === 'function') {
        loadDashboardData();
      }
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

    // Only redirect for auth errors, handle missing endpoints gracefully
    if (response.status === 401 || response.status === 403) {
      redirectToLogin();
      return;
    }

    let stats = {};
    if (response.ok) {
      try {
        stats = await response.json();
      } catch (e) {
        console.warn('Could not parse stats:', e);
      }
    }

    // Update stats display with fallbacks
    const outstandingEl = document.getElementById('total-outstanding');
    if (outstandingEl) {
      outstandingEl.textContent = `$${(stats.totalOutstanding?.total || 0).toLocaleString()}`;
    }
    
    const followupsEl = document.getElementById('followups-today');
    if (followupsEl) {
      followupsEl.textContent = stats.followupsToday?.count || 0;
    }
    
    const rateEl = document.getElementById('open-rate');
    if (rateEl) {
      rateEl.textContent = `${stats.openRate?.rate || 0}%`;
    }

  } catch (error) {
    console.error('Error loading dashboard stats:', error);
    // Display error messages but don't redirect
    const elements = ['total-outstanding', 'followups-today', 'open-rate'];
    elements.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = 'Error';
    });
  }
}

// Load invoices list
async function loadInvoices() {
  try {
    const response = await fetch('/api/invoices', {
      method: 'GET',
      credentials: 'include'
    });

    // Only redirect for auth errors, handle missing endpoints gracefully
    if (response.status === 401 || response.status === 403) {
      redirectToLogin();
      return;
    }

    let invoices = [];
    if (response.ok) {
      try {
        invoices = await response.json();
      } catch (e) {
        console.warn('Could not parse invoices:', e);
      }
    }
    
    const tableBody = document.getElementById('invoices-table-body');
    if (!tableBody) {
      console.warn('Invoices table body element not found');
      return;
    }

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
    const tableBody = document.getElementById('invoices-table-body');
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" class="px-6 py-4 text-center text-red-500">
            Error loading invoices. Please refresh the page.
          </td>
        </tr>
      `;
    }
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

    // Only redirect for auth errors
    if (response.status === 401 || response.status === 403) {
      redirectToLogin();
      return;
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
        
        // Only redirect for actual auth errors
        if (userResponse.status === 401 || userResponse.status === 403) {
            console.log('User not authenticated, status:', userResponse.status);
            window.location.href = '/login';
            return;
        }

        let user = {};
        if (userResponse.ok) {
            try {
                user = await userResponse.json();
                console.log('User authenticated:', user.email);
            } catch (e) {
                console.warn('Could not parse user info:', e);
            }
        }

        // Update user info in nav if available
        if (typeof updateUserInfo === 'function' && user) {
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
        
        // Don't redirect for missing endpoints
        let stats = { total: 0, pending: 0, delivered: 0, outstanding: 0 };
        
        if (response.ok) {
            try {
                stats = await response.json();
            } catch (e) {
                console.warn('Could not parse stats:', e);
            }
        } else if (response.status === 401 || response.status === 403) {
            window.location.href = '/login';
            return;
        }

        // Update stats with fallbacks
        const totalEl = document.getElementById('total-followups');
        if (totalEl) totalEl.textContent = stats.total || 0;
        
        const pendingEl = document.getElementById('pending-followups');
        if (pendingEl) pendingEl.textContent = stats.pending || 0;
        
        const deliveredEl = document.getElementById('delivered-followups');
        if (deliveredEl) deliveredEl.textContent = stats.delivered || 0;
        
        const outstandingEl = document.getElementById('outstanding-amount');
        if (outstandingEl) outstandingEl.textContent = `$${(stats.outstanding || 0).toLocaleString()}`;
    } catch (error) {
        console.error('Error loading stats:', error);
        // Don't redirect for data errors
    }
}

// Load invoices and follow-ups
async function loadInvoices() {
    try {
        const response = await fetch('/api/invoices');
        
        // Only redirect for auth errors
        if (response.status === 401 || response.status === 403) {
            window.location.href = '/login';
            return;
        }
        
        let invoices = [];
        if (response.ok) {
            try {
                invoices = await response.json();
            } catch (e) {
                console.warn('Could not parse invoices:', e);
            }
        }
        
        displayInvoices(invoices);
    } catch (error) {
        console.error('Error loading invoices:', error);
        const tbody = document.getElementById('invoices-tbody');
        if (tbody) {
            tbody.innerHTML = 
                '<tr><td colspan="6" class="px-4 py-8 text-center text-red-500">Error loading invoices</td></tr>';
        }
    }
}

// Display invoices in table
function displayInvoices(invoices) {
    const tbody = document.getElementById('invoices-tbody');
    if (!tbody) {
        console.warn('Invoices tbody element not found');
        return;
    }

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
