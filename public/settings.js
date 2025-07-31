// Logo preview handling
const logoInput = document.getElementById('logoInput');
const logoPreview = document.getElementById('logoPreview');
const companyForm = document.getElementById('companyForm');

logoInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => logoPreview.src = e.target.result;
    reader.readAsDataURL(file);
  }
});

async function loadCompanySettings() {
  try {
    const response = await fetch('/api/settings', {
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      console.error('Failed to load settings:', response.status);
      return;
    }
    
    const settings = await response.json();

    if (settings.company_name) document.getElementById('companyName').value = settings.company_name;
    if (settings.email) document.getElementById('businessEmail').value = settings.email;
    if (settings.phone) document.getElementById('businessPhone').value = settings.phone;
    if (settings.reply_to_email) document.getElementById('replyToEmail').value = settings.reply_to_email;
  } catch (error) {
    console.error('Error loading company settings:', error);
  }
}

companyForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData();
  formData.append('company_name', document.getElementById('companyName').value);
  formData.append('email', document.getElementById('businessEmail').value);
  formData.append('phone', document.getElementById('businessPhone').value);
  formData.append('reply_to_email', document.getElementById('replyToEmail').value);

  if (logoInput.files[0]) {
    formData.append('logo', logoInput.files[0]);
  }

  const response = await fetch('/api/settings', {
    method: 'POST',
    body: formData
  });

  if (response.ok) {
    const urlParams = new URLSearchParams(window.location.search);
    const redirectSource = urlParams.get('redirect');
    
    if (redirectSource === 'onboarding') {
      window.location.href = '/onboarding';
    } else if (redirectSource === 'beta-onboarding') {
      window.location.href = '/beta-onboarding';
    } else {
      alert('Settings saved successfully');
    }
  } else {
    alert('Failed to save settings');
  }
});

async function checkQBOConnection() {
  const status = document.getElementById('qboStatus');
  
  try {
    const response = await fetch('/api/qbo/company-info', {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.QueryResponse && data.QueryResponse.CompanyInfo && data.QueryResponse.CompanyInfo[0]) {
        status.innerHTML = `Connected to: ${data.QueryResponse.CompanyInfo[0].CompanyName}`;
        status.className = 'text-green-600';
      } else {
        status.innerHTML = 'Connected to QuickBooks (company name not available)';
        status.className = 'text-green-600';
      }
    } else {
      let errorMessage = 'Not connected to QuickBooks';
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch (e) {
        // Response is not JSON, use default message
      }
      status.innerHTML = errorMessage;
      status.className = 'text-red-600';
    }
  } catch (error) {
    console.error('Error checking QBO connection:', error);
    status.innerHTML = 'Error checking QuickBooks connection';
    status.className = 'text-red-600';
  }
}

async function reconnectQBO() {
  window.location.href = '/auth/qbo';
}

// Add event listener for Reconnect QuickBooks button
document.getElementById('reconnectQboBtn').addEventListener('click', reconnectQBO);

// Initialize
loadCompanySettings();
checkQBOConnection();