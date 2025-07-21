// Navigation loading and authentication handling
console.log('Nav.js loading...');

// Global variables
let authCheckInProgress = false;

// Main navigation loading function
async function loadNav() {
  try {
    const currentPath = window.location.pathname;
    const publicPages = ['/', '/landing', '/beta', '/help', '/privacy'];

    if (publicPages.includes(currentPath)) {
      console.log('Public page detected inside loadNav() — skipping auth check and nav injection.');
      return;
    }

    console.log('Loading navigation...');

    // Load navigation HTML first
    const navResponse = await fetch('/nav.html');
    if (!navResponse.ok) {
      throw new Error(`Failed to load nav.html: ${navResponse.status}`);
    }
    const navHTML = await navResponse.text();

    const navPlaceholder = document.getElementById('nav-placeholder');
    if (navPlaceholder) {
      navPlaceholder.innerHTML = navHTML;
    } else {
      console.warn('nav-placeholder element not found');
      return;
    }

    // Check authentication status
    let isAuthenticated = false;
    let userInfo = null;

    try {
      const userResponse = await fetch('/api/user-info', {
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          'Accept': 'application/json'
        }
      });

      console.log('User info response status:', userResponse.status);

      if (userResponse.ok) {
        userInfo = await userResponse.json();
        isAuthenticated = true;
        console.log('User authenticated:', userInfo.email);
      } else {
        console.log('User not authenticated, status:', userResponse.status);
      }
    } catch (error) {
      console.error('Auth check error:', error);
    }

    // Update navigation based on authentication status
    setTimeout(() => {
      if (isAuthenticated && userInfo) {
        updateAuthenticatedNavigation(userInfo);
      } else {
        updateUnauthenticatedNavigation();
      }
    }, 100);
  } catch (error) {
    console.error('Error loading navigation:', error);
  }
}

// Update navigation for authenticated users
function updateAuthenticatedNavigation(user) {
  const navLinks = document.getElementById('nav-links');
  const userMenu = document.getElementById('user-menu');

  if (navLinks) {
    navLinks.innerHTML = `
      <a href="/dashboard" class="text-gray-700 hover:text-blue-600 px-3 py-2 text-sm font-medium">Dashboard</a>
      <a href="/settings" class="text-gray-700 hover:text-blue-600 px-3 py-2 text-sm font-medium">Settings</a>
    `;
  }

  if (userMenu) {
    userMenu.innerHTML = `
      <span class="text-gray-700 px-3 py-2 text-sm">${user.name || user.full_name || user.email}</span>
      <button onclick="logout()" class="bg-red-500 text-white px-3 py-2 rounded text-sm">Logout</button>
    `;
  }
}

// Update navigation for unauthenticated users
function updateUnauthenticatedNavigation() {
  const navLinks = document.getElementById('nav-links');
  const userMenu = document.getElementById('user-menu');

  if (navLinks) {
    navLinks.innerHTML = `
      <a href="/login" class="text-gray-700 hover:text-blue-600 px-3 py-2 text-sm font-medium">Login</a>
      <a href="/help" class="text-gray-700 hover:text-blue-600 px-3 py-2 text-sm font-medium">Help</a>
    `;
  }

  if (userMenu) {
    userMenu.innerHTML = `
      <a href="/beta-signup" class="bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium mr-2">Join Beta</a>
    `;
  }
}

// Logout function
async function logout() {
  try {
    await fetch('/api/logout', { 
      method: 'POST',
      credentials: 'include' 
    });
    window.location.href = '/';
  } catch (error) {
    console.error('Logout error:', error);
    window.location.href = '/';
  }
}

// Should nav even load on this page?
function shouldLoadNav() {
  const currentPath = window.location.pathname;
  const publicPages = ['/', '/landing', '/beta', '/help', '/privacy'];

  if (publicPages.includes(currentPath)) {
    console.log('Skipping nav.js on public page:', currentPath);
    return false;
  }

  if (!document.getElementById('nav-placeholder')) {
    console.log('No nav-placeholder found, skipping nav.js');
    return false;
  }

  return true;
}

// Load navigation when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
  if (shouldLoadNav()) {
    console.log('DOM loaded, initializing navigation...');
    loadNav();
  }
});

if (document.readyState !== 'loading') {
  if (shouldLoadNav()) {
    console.log('DOM already loaded, initializing navigation immediately...');
    loadNav();
  }
}

console.log('Nav.js loaded successfully');
