
// Global error handling for forms and API calls
class ErrorHandler {
  static showError(message, containerId = 'error-container') {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `
        <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          <div class="flex items-center">
            <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
            </svg>
            ${message}
          </div>
        </div>
      `;
    } else {
      alert(message);
    }
  }

  static showSuccess(message, containerId = 'success-container') {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `
        <div class="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
          <div class="flex items-center">
            <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
            </svg>
            ${message}
          </div>
        </div>
      `;
    }
  }

  static showLoading(message = 'Loading...', buttonId) {
    const button = document.getElementById(buttonId);
    if (button) {
      button.disabled = true;
      button.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        ${message}
      `;
    }
  }

  static hideLoading(originalText, buttonId) {
    const button = document.getElementById(buttonId);
    if (button) {
      button.disabled = false;
      button.innerHTML = originalText;
    }
  }
}

// Make available globally
window.ErrorHandler = ErrorHandler;
