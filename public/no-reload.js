/**
 * no-reload.js - Emergency fix to prevent reload loops
 * 
 * This script prevents the login page from reloading in a loop by:
 * 1. Tracking reload attempts in localStorage
 * 2. Overriding window.location methods that cause reloads
 * 3. Adding detailed console logging
 * 4. Breaking detected reload loops
 */

(function() {
  console.log('[no-reload] Initializing reload prevention...');

  // Constants
  const RELOAD_THRESHOLD = 3; // Number of reloads before we consider it a loop
  const RELOAD_TIMEFRAME = 10000; // Timeframe in ms to consider reloads part of the same loop
  const STORAGE_KEY = 'collectflo_reload_prevention';
  const DEBUG = true; // Set to true for detailed console logs

  // Get current page info
  const currentPage = window.location.pathname;
  const isLoginPage = currentPage === '/login' || currentPage.includes('/login');
  
  // Only apply to login page
  if (!isLoginPage) {
    console.log('[no-reload] Not on login page, reload prevention not active');
    return;
  }

  // Initialize or get reload tracking data
  let reloadData = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {
    count: 0,
    lastReload: 0,
    prevented: 0,
    page: currentPage
  };

  // Check if we're in a new session or page
  const now = Date.now();
  if (now - reloadData.lastReload > RELOAD_TIMEFRAME || reloadData.page !== currentPage) {
    // Reset counter for new session or different page
    reloadData = {
      count: 0,
      lastReload: now,
      prevented: 0,
      page: currentPage
    };
    console.log('[no-reload] New session or page detected, reset counter');
  }

  // Update reload counter
  reloadData.count++;
  reloadData.lastReload = now;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reloadData));

  // Log reload attempt
  console.log(`[no-reload] Page load #${reloadData.count} detected on ${currentPage}`);
  
  // Check if we're in a reload loop
  const inReloadLoop = reloadData.count > RELOAD_THRESHOLD;
  if (inReloadLoop) {
    console.warn(`[no-reload] RELOAD LOOP DETECTED! (${reloadData.count} reloads in ${RELOAD_TIMEFRAME}ms)`);
    
    // Add visible warning on page
    setTimeout(() => {
      const warningDiv = document.createElement('div');
      warningDiv.style.position = 'fixed';
      warningDiv.style.top = '0';
      warningDiv.style.left = '0';
      warningDiv.style.right = '0';
      warningDiv.style.padding = '10px';
      warningDiv.style.background = '#ffeb3b';
      warningDiv.style.color = '#000';
      warningDiv.style.textAlign = 'center';
      warningDiv.style.zIndex = '9999';
      warningDiv.style.fontSize = '14px';
      warningDiv.style.fontFamily = 'sans-serif';
      warningDiv.innerHTML = `
        <strong>Reload loop detected and prevented!</strong> 
        <span>${reloadData.count} reloads in ${Math.round(RELOAD_TIMEFRAME/1000)}s.</span>
        <button id="no-reload-reset" style="margin-left: 10px; padding: 3px 8px; background: #fff; border: 1px solid #ccc; border-radius: 3px;">Reset Counter</button>
      `;
      document.body.appendChild(warningDiv);
      
      // Add reset button handler
      document.getElementById('no-reload-reset').addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEY);
        warningDiv.innerHTML = 'Counter reset! Refresh allowed on next attempt.';
        setTimeout(() => {
          warningDiv.style.opacity = '0';
          setTimeout(() => warningDiv.remove(), 500);
        }, 2000);
      });
    }, 100);
  }

  // Override reload methods
  const originalReload = window.location.reload;
  window.location.reload = function() {
    reloadData.prevented++;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reloadData));
    console.warn(`[no-reload] Prevented reload call #${reloadData.prevented}`);
    
    // Get stack trace to find what's causing the reload
    const stack = new Error().stack || '';
    console.warn('[no-reload] Reload call stack:', stack);
    
    // Allow reload if we're not in a loop or if forced
    if (!inReloadLoop || arguments[0] === true) {
      console.log('[no-reload] Allowing reload (not in loop or forced)');
      return originalReload.apply(this, arguments);
    }
    
    return false;
  };

  // Track navigation attempts
  const originalAssign = window.location.assign;
  window.location.assign = function(url) {
    if (DEBUG) {
      console.log(`[no-reload] location.assign called with: ${url}`);
    }
    
    // Check if this is a self-redirect (to the same page)
    const isSelfRedirect = url === window.location.href || 
                          url === currentPage || 
                          url === '/login' || 
                          url.includes('/login?');
    
    if (isSelfRedirect && inReloadLoop) {
      console.warn('[no-reload] Prevented self-redirect in reload loop');
      reloadData.prevented++;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reloadData));
      return false;
    }
    
    // Allow other navigation
    return originalAssign.apply(this, arguments);
  };

  // Also override direct property assignment
  const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    get: function() {
      return originalLocationDescriptor.get.call(this);
    },
    set: function(url) {
      console.log(`[no-reload] window.location setter called with: ${url}`);
      
      // Check if this is a self-redirect
      const isSelfRedirect = url === window.location.href || 
                            url === currentPage || 
                            url === '/login' || 
                            url.includes('/login?');
      
      if (isSelfRedirect && inReloadLoop) {
        console.warn('[no-reload] Prevented location change in reload loop');
        reloadData.prevented++;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(reloadData));
        return false;
      }
      
      return originalLocationDescriptor.set.call(this, url);
    },
    configurable: true
  });

  // Monitor history API for potential reload loops
  const originalPushState = history.pushState;
  history.pushState = function() {
    if (DEBUG) {
      console.log('[no-reload] history.pushState called:', arguments);
    }
    return originalPushState.apply(this, arguments);
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function() {
    if (DEBUG) {
      console.log('[no-reload] history.replaceState called:', arguments);
    }
    return originalReplaceState.apply(this, arguments);
  };

  // Monitor form submissions that might cause reloads
  document.addEventListener('submit', function(e) {
    if (inReloadLoop) {
      console.warn('[no-reload] Form submission detected in reload loop');
      console.log('[no-reload] Form target:', e.target);
      
      // Let the form submission proceed but track it
      reloadData.formSubmits = (reloadData.formSubmits || 0) + 1;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reloadData));
    }
  }, true);

  // Detect navigation events that might be part of the loop
  window.addEventListener('beforeunload', function(e) {
    if (DEBUG) {
      console.log('[no-reload] beforeunload event detected');
    }
    
    // Don't prevent normal navigation
    if (!inReloadLoop) return;
    
    // Only try to prevent if we're in a loop
    if (inReloadLoop) {
      console.warn('[no-reload] Unload detected in reload loop');
      
      // Modern browsers ignore this, but we try anyway
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Add a helper function to reset the prevention if needed
  window.resetReloadPrevention = function() {
    localStorage.removeItem(STORAGE_KEY);
    console.log('[no-reload] Prevention data reset');
    return 'Reload prevention reset. Page can reload normally on next attempt.';
  };

  // Log that we're active
  console.log(`[no-reload] Reload prevention active on ${currentPage}`);
  
  // Expose current status to console for debugging
  window.getReloadStatus = function() {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    console.table(current);
    return current;
  };
})();
