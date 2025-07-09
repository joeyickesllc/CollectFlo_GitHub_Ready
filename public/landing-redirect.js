/**
 * Landing Page Redirect Script
 * 
 * This script checks if the user is accessing the root path directly
 * and redirects them to the landing page instead of showing the login page.
 */

(function() {
  // Only redirect if we're at exactly the root path
  if (window.location.pathname === '/' || window.location.pathname === '') {
    console.log('Root path detected, redirecting to landing page...');
    
    // Store the fact that we've redirected to prevent loops
    if (!sessionStorage.getItem('redirectedFromRoot')) {
      sessionStorage.setItem('redirectedFromRoot', 'true');
      
      // Redirect to landing.html
      window.location.href = '/landing.html';
    }
  } else {
    // Clear the redirect flag when visiting other pages
    sessionStorage.removeItem('redirectedFromRoot');
  }
})();
