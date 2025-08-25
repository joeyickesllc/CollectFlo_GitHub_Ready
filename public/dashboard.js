// Timezone utility functions for Central Standard Time
// ------------------------------------------------------------------
function formatDateCST(dateValue) {
  if (!dateValue) return 'N/A';
  
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


// Fetch and display invoices
async function updateInvoices() {
  try {
    const response = await fetch('/api/invoices', { credentials: 'include' });

    // Handle authentication and trial expiration
    if (response.status === 401) {
      console.log('Invoice API auth error, redirecting to login');
      redirectToLogin();
      return;
    }
    
    if (response.status === 403) {
      try {
        const errorData = await response.json();
        if (errorData.code === 'TRIAL_EXPIRED') {
          console.log('Trial expired, redirecting to subscription');
          window.location.href = '/subscription';
          return;
        }
      } catch (e) {
        // If we can't parse the error, treat as general auth error
      }
      console.log('API access denied, redirecting to login');
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
        <td class="px-6 py-4">${formatDateCST(invoice.due_date)}</td>
        <td class="px-6 py-4">$${invoice.amount.toFixed(2)}</td>
        <td class="px-6 py-4">${invoice.status}</td>
        <td class="px-6 py-4">${invoice.next_followup ? formatDateCST(invoice.next_followup) : 'N/A'}</td>
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

    // Refresh the dashboard since excluded invoices changed
    updateInvoices();
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
    updateInvoices();

    // Update dashboard every minute
    setInterval(() => {
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
            <td class="px-4 py-3 text-sm">${formatDateCST(invoice.due_date)}</td>
            <td class="px-4 py-3 text-sm">
                <span class="px-2 py-1 text-xs rounded-full ${getStatusColor(invoice.status)}">
                    ${invoice.status}
                </span>
            </td>
            <td class="px-4 py-3 text-sm">${invoice.scheduled_date ? formatDateCST(invoice.scheduled_date) : 'N/A'}</td>
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

