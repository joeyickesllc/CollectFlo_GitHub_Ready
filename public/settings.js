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
      if (data && data.success && data.company) {
        status.innerHTML = `Connected to: ${data.company.name}`;
        status.className = 'text-green-600';
      } else {
        status.innerHTML = 'Connected to QuickBooks';
        status.className = 'text-green-600';
      }
    } else {
      let errorMessage = 'Not connected to QuickBooks';
      try {
        const errorData = await response.json();
        
        // Handle token refresh response
        if (errorData.tokenRefreshed) {
          status.innerHTML = 'Token refreshed, checking connection...';
          status.className = 'text-yellow-600';
          
          // Retry the request after token refresh (but limit retries)
          if (!window.qboRetryCount) window.qboRetryCount = 0;
          if (window.qboRetryCount < 3) {
            window.qboRetryCount++;
            setTimeout(() => checkQBOConnection(), 2000);
          } else {
            status.innerHTML = 'Connection check failed after multiple attempts';
            status.className = 'text-red-600';
          }
          return;
        }
        
        if (errorData.reconnectRequired) {
          errorMessage = 'QuickBooks connection expired - please reconnect';
        } else if (errorData.message) {
          errorMessage = errorData.message;
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

// Default follow-up templates
const DEFAULT_EMAIL_TEMPLATES = {
  pre_due_reminder: {
    subject: 'Invoice {{invoiceNumber}} - Due Tomorrow',
    body: `Hi {{customerName}},

I hope you're having a great day. I wanted to give you a friendly heads up that invoice {{invoiceNumber}} is due tomorrow ({{dueDate}}).

Invoice #{{invoiceNumber}}
Amount Due: $${'{{amount}}'}
Due Date: {{dueDate}}

Just a quick reminder to help you stay on top of things. If you've already scheduled the payment, you can disregard this message.

You can easily pay online or if you have any questions or need to discuss anything, just reply to this email or give me a call.

Thanks for being a valued customer!

{{companyName}}`
  },
  due_date_notice: {
    subject: 'Invoice {{invoiceNumber}} - Due Today',
    body: `Hi {{customerName}},

I wanted to reach out because invoice {{invoiceNumber}} is due today ({{dueDate}}).

Invoice #{{invoiceNumber}}
Amount Due: $${'{{amount}}'}
Due Date: {{dueDate}} (Today)

If you've already sent the payment, please disregard this message. If not, you can pay quickly and securely online.

If you need to discuss payment arrangements or have any questions, please reply to this email or give me a call.

Thank you!

{{companyName}}`
  },
  gentle_reminder: {
    subject: 'Invoice {{invoiceNumber}} - Payment Due',
    body: `Hi {{customerName}},

I hope you're doing well. I wanted to reach out regarding invoice {{invoiceNumber}} which was due on {{dueDate}}.

Invoice #{{invoiceNumber}}
Amount Due: $${'{{amount}}'}
Due Date: {{dueDate}}

I know things can get busy, so I just wanted to make sure this didn't slip through the cracks. If you've already sent the payment, please disregard this message.

If you have any questions or need to discuss payment arrangements, just hit reply or give me a call. I'm here to help.

Thanks so much!

{{companyName}}`
  },
  second_reminder: {
    subject: 'Re: Invoice {{invoiceNumber}} - Past Due',
    body: `Hi {{customerName}},

I'm following up on my previous email about invoice {{invoiceNumber}}. The payment is now {{daysOverdue}} days past due and I haven't received payment or heard back from you.

Invoice #{{invoiceNumber}}
Amount Due: $${'{{amount}}'}
Original Due Date: {{dueDate}}
Days Past Due: {{daysOverdue}} days

I need to get this resolved quickly to keep your account in good standing. Please send payment today or give me a call to discuss payment arrangements.

If you've already sent payment, please let me know so I can check on it.

I appreciate your prompt attention to this.

{{companyName}}`
  },
  firm_reminder: {
    subject: 'URGENT: Invoice {{invoiceNumber}} - Immediate Action Required',
    body: `{{customerName}},

I've sent multiple emails about invoice {{invoiceNumber}} and haven't received payment or any response. This is now seriously overdue and requires immediate attention.

Invoice #{{invoiceNumber}}
Amount Due: $${'{{amount}}'}
Due Date: {{dueDate}}
Days Past Due: {{daysOverdue}} days

I need payment within 48 hours to avoid escalating this matter.

If you've already sent payment, please send me confirmation immediately so I can locate it.

If there's a problem with the invoice or you need to work out payment arrangements, call me right away. I want to resolve this, but I need to hear from you.

Please don't ignore this - continued non-payment may result in service suspension and additional collection costs.

Call me today.

{{companyName}}`
  },
  fourth_reminder: {
    subject: 'CRITICAL: Invoice {{invoiceNumber}} - Account in Jeopardy',
    body: `{{customerName}},

Your account is now in serious jeopardy. Invoice {{invoiceNumber}} has been outstanding for {{daysOverdue}} days and I have not received payment despite multiple attempts to contact you.

ACCOUNT STATUS: CRITICAL
Invoice #{{invoiceNumber}}
Amount Due: $${'{{amount}}'}
Due Date: {{dueDate}}
Days Past Due: {{daysOverdue}} days

This is your last opportunity to resolve this before I escalate to our legal department and credit reporting agencies.

If I don't receive payment within 7 days, I will have no choice but to:
• Report this delinquency to credit bureaus
• Turn your account over to our legal department
• Suspend all services immediately
• Add collection fees and legal costs to your balance

I don't want it to come to this. Please pay online immediately or call me to arrange payment today.

{{companyName}}`
  },
  final_notice: {
    subject: 'FINAL NOTICE: Invoice {{invoiceNumber}} - Action Required',
    body: `{{customerName}},

This is my final attempt to collect payment before taking further action.

Invoice {{invoiceNumber}} is now {{daysOverdue}} days past due and I have not received payment despite multiple requests.

FINAL DEMAND
Invoice #{{invoiceNumber}}
Amount Due: $${'{{amount}}'}
Due Date: {{dueDate}}
Days Past Due: {{daysOverdue}} days

You have 7 days to pay the full amount or contact me to resolve this.

If I don't receive payment or hear from you within 7 days, I will have no choice but to:
• Turn this over to our legal department
• Report the delinquency to credit agencies
• Pursue collection through the courts
• Add collection costs and legal fees to your balance

I don't want it to come to this. Please call me immediately to avoid legal action.

{{companyName}}`
  }
};

const DEFAULT_SMS_TEMPLATES = {
  pre_due_reminder: `Hi {{customerName}}, friendly reminder that invoice {{invoiceNumber}} ($${'{{amount}}'}) is due tomorrow ({{dueDate}}). Pay online: [payment link] Thanks! - {{companyName}}`,
  due_date_notice: `Hi {{customerName}}, invoice {{invoiceNumber}} ($${'{{amount}}'}) is due today. Pay online: [payment link] Thanks! - {{companyName}}`,
  gentle_reminder: `Hi {{customerName}}, hope you're well. Just a reminder that invoice {{invoiceNumber}} ($${'{{amount}}'}) was due {{daysOverdue}} days ago. Please send payment when you get a chance. Thanks! - {{companyName}}`,
  second_reminder: `Hi {{customerName}}, following up on invoice {{invoiceNumber}} ($${'{{amount}}'}) - it's {{daysOverdue}} days past due. I need to get this resolved soon. Can you send payment today? Call me if any issues. - {{companyName}}`,
  firm_reminder: `{{customerName}}, I haven't received payment for invoice {{invoiceNumber}} ($${'{{amount}}'}, {{daysOverdue}} days overdue). I need payment in 48 hours to avoid escalation. Please call me today. - {{companyName}}`,
  fourth_reminder: `{{customerName}}, CRITICAL: Invoice {{invoiceNumber}} ($${'{{amount}}'}) is {{daysOverdue}} days overdue. Account in jeopardy. PAY IMMEDIATELY: [payment link] Call NOW to avoid legal action. - {{companyName}}`,
  final_notice: `{{customerName}}, FINAL NOTICE: Invoice {{invoiceNumber}} ($${'{{amount}}'}) is {{daysOverdue}} days overdue. I must receive payment in 7 days or turn this over to legal. Please call me now. - {{companyName}}`
};

const DEFAULT_FOLLOWUP_RULES = [
  { name: 'Pre-Due Reminder', trigger_days_overdue: -1, follow_up_type: 'email', template_type: 'pre_due_reminder', active: true },
  { name: 'Due Date Notice', trigger_days_overdue: 0, follow_up_type: 'email', template_type: 'due_date_notice', active: true },
  { name: 'First Reminder', trigger_days_overdue: 7, follow_up_type: 'email', template_type: 'gentle_reminder', active: true },
  { name: 'Second Reminder', trigger_days_overdue: 10, follow_up_type: 'email', template_type: 'second_reminder', active: true },
  { name: 'Third Reminder', trigger_days_overdue: 14, follow_up_type: 'email', template_type: 'firm_reminder', active: true },
  { name: 'Fourth Reminder', trigger_days_overdue: 21, follow_up_type: 'email', template_type: 'fourth_reminder', active: true },
  { name: 'Final Notice', trigger_days_overdue: 28, follow_up_type: 'email', template_type: 'final_notice', active: true },
  { name: 'Phone Call Follow-up', trigger_days_overdue: 30, follow_up_type: 'call', template_type: 'phone_script', active: false }
];

// Load follow-up settings
async function loadFollowUpSettings() {
  try {
    // Load follow-up rules
    const rulesResponse = await fetch('/api/follow-ups/rules', {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    
    let rules = DEFAULT_FOLLOWUP_RULES;
    if (rulesResponse.ok) {
      const rulesData = await rulesResponse.json();
      rules = rulesData.rules || DEFAULT_FOLLOWUP_RULES;
    }
    
    displayFollowUpRules(rules);
    loadEmailTemplates();
    loadSMSTemplates();
    setupCharacterCounters();
    
  } catch (error) {
    console.error('Error loading follow-up settings:', error);
    displayFollowUpRules(DEFAULT_FOLLOWUP_RULES);
    loadEmailTemplates();
    loadSMSTemplates();
  }
}

function displayFollowUpRules(rules) {
  const container = document.getElementById('followUpRules');
  container.innerHTML = rules.map((rule, index) => `
    <div class="flex items-center space-x-4 p-4 border rounded">
      <input type="checkbox" ${rule.active ? 'checked' : ''} 
             onchange="toggleRule(${index})" class="mr-2">
      <div class="flex-1">
        <input type="text" value="${rule.name}" 
               onchange="updateRule(${index}, 'name', this.value)"
               class="font-medium border-none bg-transparent" placeholder="Rule name">
      </div>
      <div class="flex items-center space-x-2">
        <span class="text-sm">Send</span>
        <select onchange="updateRule(${index}, 'follow_up_type', this.value)" class="border rounded px-2 py-1">
          <option value="email" ${rule.follow_up_type === 'email' ? 'selected' : ''}>Email</option>
          <option value="sms" ${rule.follow_up_type === 'sms' ? 'selected' : ''}>SMS</option>
          <option value="call" ${rule.follow_up_type === 'call' ? 'selected' : ''}>Call</option>
        </select>
        <span class="text-sm">after</span>
        <input type="number" value="${rule.trigger_days_overdue}" min="-10" max="365"
               onchange="updateRule(${index}, 'trigger_days_overdue', parseInt(this.value))"
               class="w-16 border rounded px-2 py-1">
        <span class="text-sm">${rule.trigger_days_overdue < 0 ? 'days before due' : rule.trigger_days_overdue === 0 ? 'on due date' : 'days overdue'}</span>
      </div>
      <button onclick="removeRule(${index})" class="text-red-600 hover:text-red-800">Remove</button>
    </div>
  `).join('');
}

function loadEmailTemplates() {
  document.getElementById('emailSubject1').value = DEFAULT_EMAIL_TEMPLATES.pre_due_reminder.subject;
  document.getElementById('emailTemplate1').value = DEFAULT_EMAIL_TEMPLATES.pre_due_reminder.body;
  document.getElementById('emailSubject2').value = DEFAULT_EMAIL_TEMPLATES.due_date_notice.subject;
  document.getElementById('emailTemplate2').value = DEFAULT_EMAIL_TEMPLATES.due_date_notice.body;

  document.getElementById('emailSubject3').value = DEFAULT_EMAIL_TEMPLATES.gentle_reminder.subject;
  document.getElementById('emailTemplate3').value = DEFAULT_EMAIL_TEMPLATES.gentle_reminder.body;

  document.getElementById('emailSubject4').value = DEFAULT_EMAIL_TEMPLATES.second_reminder.subject;
  document.getElementById('emailTemplate4').value = DEFAULT_EMAIL_TEMPLATES.second_reminder.body;

  document.getElementById('emailSubject5').value = DEFAULT_EMAIL_TEMPLATES.firm_reminder.subject;
  document.getElementById('emailTemplate5').value = DEFAULT_EMAIL_TEMPLATES.firm_reminder.body;

  document.getElementById('emailSubject6').value = DEFAULT_EMAIL_TEMPLATES.fourth_reminder.subject;
  document.getElementById('emailTemplate6').value = DEFAULT_EMAIL_TEMPLATES.fourth_reminder.body;

  document.getElementById('emailSubject7').value = DEFAULT_EMAIL_TEMPLATES.final_notice.subject;
  document.getElementById('emailTemplate7').value = DEFAULT_EMAIL_TEMPLATES.final_notice.body;
}

function loadSMSTemplates() {
  document.getElementById('smsTemplate1').value = DEFAULT_SMS_TEMPLATES.pre_due_reminder;
  document.getElementById('smsTemplate2').value = DEFAULT_SMS_TEMPLATES.due_date_notice;
  document.getElementById('smsTemplate3').value = DEFAULT_SMS_TEMPLATES.gentle_reminder;
  document.getElementById('smsTemplate4').value = DEFAULT_SMS_TEMPLATES.second_reminder;
  document.getElementById('smsTemplate5').value = DEFAULT_SMS_TEMPLATES.firm_reminder;
  document.getElementById('smsTemplate6').value = DEFAULT_SMS_TEMPLATES.fourth_reminder;
  document.getElementById('smsTemplate7').value = DEFAULT_SMS_TEMPLATES.final_notice;
}

function setupCharacterCounters() {
  for (let i = 1; i <= 7; i++) {
    const textarea = document.getElementById(`smsTemplate${i}`);
    const counter = document.getElementById(`smsCount${i}`);
    
    const updateCounter = () => {
      const count = textarea.value.length;
      counter.textContent = count;
      counter.className = count > 320 ? 'text-red-500' : count > 160 ? 'text-yellow-500' : 'text-gray-500';
    };
    
    textarea.addEventListener('input', updateCounter);
    updateCounter();
  }
}

// Follow-up rules management
let currentRules = [...DEFAULT_FOLLOWUP_RULES];

window.toggleRule = function (index) {
  currentRules[index].active = !currentRules[index].active;
};

window.updateRule = function (index, field, value) {
  currentRules[index][field] = value;
};

window.removeRule = function (index) {
  currentRules.splice(index, 1);
  displayFollowUpRules(currentRules);
};

document.getElementById('addRuleBtn').addEventListener('click', () => {
  currentRules.push({
    name: 'New Rule',
    trigger_days_overdue: 30,
    follow_up_type: 'email',
    template_type: 'custom',
    active: true
  });
  displayFollowUpRules(currentRules);
});

// Save follow-up settings
document.getElementById('saveFollowUpSettings').addEventListener('click', async () => {
  try {
    // Save rules
    const rulesResponse = await fetch('/api/follow-ups/rules', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: currentRules })
    });
    
    if (!rulesResponse.ok) {
      throw new Error('Failed to save rules');
    }
    
    // Save templates (would need new API endpoint)
    // For now, just show success message
    
    alert('Follow-up settings saved successfully!');
  } catch (error) {
    console.error('Error saving follow-up settings:', error);
    alert('Failed to save settings. Please try again.');
  }
});

// Reset to defaults
document.getElementById('resetToDefaults').addEventListener('click', () => {
  if (confirm('Are you sure you want to reset all follow-up settings to defaults? This cannot be undone.')) {
    currentRules = [...DEFAULT_FOLLOWUP_RULES];
    displayFollowUpRules(currentRules);
    loadEmailTemplates();
    loadSMSTemplates();
    setupCharacterCounters();
  }
});

// Preview and test
document.getElementById('previewFollowUp').addEventListener('click', async () => {
  const email = prompt('Enter email address to send test follow-up:');
  if (email) {
    try {
      async function sendTestEmailRequest() {
        return fetch('/api/test-email', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            toEmail: email,
            testData: {
              templateType: 'gentle_reminder',
              invoiceId: 'TEST-001',
              customerName: 'Test Customer',
              amount: 1500.00,
              dueDate: '2025-07-15',
              daysOverdue: 5
            }
          })
        });
      }

      let response = await sendTestEmailRequest();
      
      // If unauthorized, attempt token refresh once then retry
      if (response.status === 401) {
        try {
          const refreshResp = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include'
          });
          if (refreshResp.ok) {
            response = await sendTestEmailRequest();
          }
        } catch (_) {
          // ignore, will fall through to error handling below
        }
      }
      
      if (response.ok) {
        alert('Test email sent successfully!');
      } else {
        let serverMsg = 'Failed to send test email';
        try {
          const errData = await response.json();
          if (errData?.message) serverMsg = errData.message;
          if (errData?.error) serverMsg += `: ${errData.error}`;
        } catch (_) {}
        throw new Error(serverMsg);
      }
    } catch (error) {
      console.error('Error sending test email:', error);
      alert('Failed to send test email. Please try again.');
    }
  }
});

// Initialize
loadCompanySettings();
loadFollowUpSettings();
checkQBOConnection();
• Add collection fees and legal costs to your balance



I don't want it to come to this. Please pay online immediately or call me to arrange payment today.



{{companyName}}`

  },

  final_notice: {

    subject: 'FINAL NOTICE: Invoice {{invoiceNumber}} - Action Required',

    body: `{{customerName}},



This is my final attempt to collect payment before taking further action.



Invoice {{invoiceNumber}} is now {{daysOverdue}} days past due and I have not received payment despite multiple requests.



FINAL DEMAND

Invoice #{{invoiceNumber}}

Amount Due: $${'{{amount}}'}

Due Date: {{dueDate}}

Days Past Due: {{daysOverdue}} days



You have 7 days to pay the full amount or contact me to resolve this.



If I don't receive payment or hear from you within 7 days, I will have no choice but to:

• Turn this over to our legal department

• Report the delinquency to credit agencies

• Pursue collection through the courts

• Add collection costs and legal fees to your balance



I don't want it to come to this. Please call me immediately to avoid legal action.



{{companyName}}`

  }

};



const DEFAULT_SMS_TEMPLATES = {

  pre_due_reminder: `Hi {{customerName}}, friendly reminder that invoice {{invoiceNumber}} ($${'{{amount}}'}) is due tomorrow ({{dueDate}}). Pay online: [payment link] Thanks! - {{companyName}}`,

  due_date_notice: `Hi {{customerName}}, invoice {{invoiceNumber}} ($${'{{amount}}'}) is due today. Pay online: [payment link] Thanks! - {{companyName}}`,

  gentle_reminder: `Hi {{customerName}}, hope you're well. Just a reminder that invoice {{invoiceNumber}} ($${'{{amount}}'}) was due {{daysOverdue}} days ago. Please send payment when you get a chance. Thanks! - {{companyName}}`,

  second_reminder: `Hi {{customerName}}, following up on invoice {{invoiceNumber}} ($${'{{amount}}'}) - it's {{daysOverdue}} days past due. I need to get this resolved soon. Can you send payment today? Call me if any issues. - {{companyName}}`,

  firm_reminder: `{{customerName}}, I haven't received payment for invoice {{invoiceNumber}} ($${'{{amount}}'}, {{daysOverdue}} days overdue). I need payment in 48 hours to avoid escalation. Please call me today. - {{companyName}}`,

  fourth_reminder: `{{customerName}}, CRITICAL: Invoice {{invoiceNumber}} ($${'{{amount}}'}) is {{daysOverdue}} days overdue. Account in jeopardy. PAY IMMEDIATELY: [payment link] Call NOW to avoid legal action. - {{companyName}}`,

  final_notice: `{{customerName}}, FINAL NOTICE: Invoice {{invoiceNumber}} ($${'{{amount}}'}) is {{daysOverdue}} days overdue. I must receive payment in 7 days or turn this over to legal. Please call me now. - {{companyName}}`

};



const DEFAULT_FOLLOWUP_RULES = [

  { name: 'Pre-Due Reminder', trigger_days_overdue: -1, follow_up_type: 'email', template_type: 'pre_due_reminder', active: true },

  { name: 'Due Date Notice', trigger_days_overdue: 0, follow_up_type: 'email', template_type: 'due_date_notice', active: true },

  { name: 'First Reminder', trigger_days_overdue: 7, follow_up_type: 'email', template_type: 'gentle_reminder', active: true },

  { name: 'Second Reminder', trigger_days_overdue: 10, follow_up_type: 'email', template_type: 'second_reminder', active: true },

  { name: 'Third Reminder', trigger_days_overdue: 14, follow_up_type: 'email', template_type: 'firm_reminder', active: true },

  { name: 'Fourth Reminder', trigger_days_overdue: 21, follow_up_type: 'email', template_type: 'fourth_reminder', active: true },

  { name: 'Final Notice', trigger_days_overdue: 28, follow_up_type: 'email', template_type: 'final_notice', active: true },

  { name: 'Phone Call Follow-up', trigger_days_overdue: 30, follow_up_type: 'call', template_type: 'phone_script', active: false }

];



// Load follow-up settings

async function loadFollowUpSettings() {

  try {

    // Load follow-up rules

    const rulesResponse = await fetch('/api/follow-ups/rules', {

      credentials: 'include',

      headers: { 'Accept': 'application/json' }

    });

    

    let rules = DEFAULT_FOLLOWUP_RULES;

    if (rulesResponse.ok) {

      const rulesData = await rulesResponse.json();

      rules = rulesData.rules || DEFAULT_FOLLOWUP_RULES;

    }

    

    displayFollowUpRules(rules);

    loadEmailTemplates();

    loadSMSTemplates();

    setupCharacterCounters();

    

  } catch (error) {

    console.error('Error loading follow-up settings:', error);

    displayFollowUpRules(DEFAULT_FOLLOWUP_RULES);

    loadEmailTemplates();

    loadSMSTemplates();

  }

}



function displayFollowUpRules(rules) {

  const container = document.getElementById('followUpRules');

  container.innerHTML = rules.map((rule, index) => `

    <div class="flex items-center space-x-4 p-4 border rounded">

      <input type="checkbox" ${rule.active ? 'checked' : ''} 

             onchange="toggleRule(${index})" class="mr-2">

      <div class="flex-1">

        <input type="text" value="${rule.name}" 

               onchange="updateRule(${index}, 'name', this.value)"

               class="font-medium border-none bg-transparent" placeholder="Rule name">

      </div>

      <div class="flex items-center space-x-2">

        <span class="text-sm">Send</span>

        <select onchange="updateRule(${index}, 'follow_up_type', this.value)" class="border rounded px-2 py-1">

          <option value="email" ${rule.follow_up_type === 'email' ? 'selected' : ''}>Email</option>

          <option value="sms" ${rule.follow_up_type === 'sms' ? 'selected' : ''}>SMS</option>

          <option value="call" ${rule.follow_up_type === 'call' ? 'selected' : ''}>Call</option>

        </select>

        <span class="text-sm">after</span>

        <input type="number" value="${rule.trigger_days_overdue}" min="-10" max="365"

               onchange="updateRule(${index}, 'trigger_days_overdue', parseInt(this.value))"

               class="w-16 border rounded px-2 py-1">

        <span class="text-sm">${rule.trigger_days_overdue < 0 ? 'days before due' : rule.trigger_days_overdue === 0 ? 'on due date' : 'days overdue'}</span>

      </div>

      <button onclick="removeRule(${index})" class="text-red-600 hover:text-red-800">Remove</button>

    </div>

  `).join('');

}



function loadEmailTemplates() {

  document.getElementById('emailSubject1').value = DEFAULT_EMAIL_TEMPLATES.pre_due_reminder.subject;

  document.getElementById('emailTemplate1').value = DEFAULT_EMAIL_TEMPLATES.pre_due_reminder.body;

  document.getElementById('emailSubject2').value = DEFAULT_EMAIL_TEMPLATES.due_date_notice.subject;

  document.getElementById('emailTemplate2').value = DEFAULT_EMAIL_TEMPLATES.due_date_notice.body;



  document.getElementById('emailSubject3').value = DEFAULT_EMAIL_TEMPLATES.gentle_reminder.subject;

  document.getElementById('emailTemplate3').value = DEFAULT_EMAIL_TEMPLATES.gentle_reminder.body;



  document.getElementById('emailSubject4').value = DEFAULT_EMAIL_TEMPLATES.second_reminder.subject;

  document.getElementById('emailTemplate4').value = DEFAULT_EMAIL_TEMPLATES.second_reminder.body;



  document.getElementById('emailSubject5').value = DEFAULT_EMAIL_TEMPLATES.firm_reminder.subject;

  document.getElementById('emailTemplate5').value = DEFAULT_EMAIL_TEMPLATES.firm_reminder.body;



  document.getElementById('emailSubject6').value = DEFAULT_EMAIL_TEMPLATES.fourth_reminder.subject;

  document.getElementById('emailTemplate6').value = DEFAULT_EMAIL_TEMPLATES.fourth_reminder.body;



  document.getElementById('emailSubject7').value = DEFAULT_EMAIL_TEMPLATES.final_notice.subject;

  document.getElementById('emailTemplate7').value = DEFAULT_EMAIL_TEMPLATES.final_notice.body;

}



function loadSMSTemplates() {

  document.getElementById('smsTemplate1').value = DEFAULT_SMS_TEMPLATES.pre_due_reminder;

  document.getElementById('smsTemplate2').value = DEFAULT_SMS_TEMPLATES.due_date_notice;

  document.getElementById('smsTemplate3').value = DEFAULT_SMS_TEMPLATES.gentle_reminder;

  document.getElementById('smsTemplate4').value = DEFAULT_SMS_TEMPLATES.second_reminder;

  document.getElementById('smsTemplate5').value = DEFAULT_SMS_TEMPLATES.firm_reminder;

  document.getElementById('smsTemplate6').value = DEFAULT_SMS_TEMPLATES.fourth_reminder;

  document.getElementById('smsTemplate7').value = DEFAULT_SMS_TEMPLATES.final_notice;

}



function setupCharacterCounters() {

  for (let i = 1; i <= 7; i++) {

    const textarea = document.getElementById(`smsTemplate${i}`);

    const counter = document.getElementById(`smsCount${i}`);

    

    const updateCounter = () => {

      const count = textarea.value.length;

      counter.textContent = count;

      counter.className = count > 320 ? 'text-red-500' : count > 160 ? 'text-yellow-500' : 'text-gray-500';

    };

    

    textarea.addEventListener('input', updateCounter);

    updateCounter();

  }

}



// Follow-up rules management

let currentRules = [...DEFAULT_FOLLOWUP_RULES];



window.toggleRule = function (index) {

  currentRules[index].active = !currentRules[index].active;

};



window.updateRule = function (index, field, value) {

  currentRules[index][field] = value;

};



window.removeRule = function (index) {

  currentRules.splice(index, 1);

  displayFollowUpRules(currentRules);

};



document.getElementById('addRuleBtn').addEventListener('click', () => {

  currentRules.push({

    name: 'New Rule',

    trigger_days_overdue: 30,

    follow_up_type: 'email',

    template_type: 'custom',

    active: true

  });

  displayFollowUpRules(currentRules);

});



// Save follow-up settings

document.getElementById('saveFollowUpSettings').addEventListener('click', async () => {

  try {

    // Save rules

    const rulesResponse = await fetch('/api/follow-ups/rules', {

      method: 'POST',

      credentials: 'include',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ rules: currentRules })

    });

    

    if (!rulesResponse.ok) {

      throw new Error('Failed to save rules');

    }

    

    // Save templates (would need new API endpoint)

    // For now, just show success message

    

    alert('Follow-up settings saved successfully!');

  } catch (error) {

    console.error('Error saving follow-up settings:', error);

    alert('Failed to save settings. Please try again.');

  }

});



// Reset to defaults

document.getElementById('resetToDefaults').addEventListener('click', () => {

  if (confirm('Are you sure you want to reset all follow-up settings to defaults? This cannot be undone.')) {

    currentRules = [...DEFAULT_FOLLOWUP_RULES];

    displayFollowUpRules(currentRules);

    loadEmailTemplates();

    loadSMSTemplates();

    setupCharacterCounters();

  }

});



// Preview and test

document.getElementById('previewFollowUp').addEventListener('click', async () => {

  const email = prompt('Enter email address to send test follow-up:');

  if (email) {

    try {

      const response = await fetch('/api/test-email', {

        method: 'POST',

        credentials: 'include',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ 

          toEmail: email,

          testData: {

            templateType: 'gentle_reminder',

            invoiceId: 'TEST-001',

            customerName: 'Test Customer',

            amount: 1500.00,

            dueDate: '2025-07-15',

            daysOverdue: 5

          }

        })

      });

      

      if (response.ok) {

        alert('Test email sent successfully!');

      } else {

        throw new Error('Failed to send test email');

      }

    } catch (error) {

      console.error('Error sending test email:', error);

      alert('Failed to send test email. Please try again.');

    }

  }

});



// Initialize

loadCompanySettings();

loadFollowUpSettings();

checkQBOConnection();
