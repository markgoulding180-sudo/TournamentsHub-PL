// Auth gate - redirects unauthenticated users to login
(function() {
  // Pages that don't require authentication
  const publicPages = [
    '/index.html',
    '/',
    '/login.html',
    '/register.html'
  ];
  
  // Current page
  const currentPath = window.location.pathname;
  
  // Check if current page is public
  const isPublicPage = publicPages.some(page => currentPath.endsWith(page) || currentPath === page);
  
  if (!isPublicPage) {
    // Check for auth token
    const token = localStorage.getItem('gbf_token');
    
    if (!token) {
      // Redirect to login
      window.location.href = '/login.html?redirect=' + encodeURIComponent(currentPath);
      return;
    }
  }
  
  // Update navbar and sidebar for auth state on ALL pages after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      updateNavbarForAuth();
      updateSidebarForAuth();
    });
  } else {
    updateNavbarForAuth();
    updateSidebarForAuth();
  }
})();

function updateNavbarForAuth() {
  const token = localStorage.getItem('gbf_token');
  const userJson = localStorage.getItem('gbf_user');
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) {
    console.log('Navbar: nav-links not found');
    return;
  }
  
  try {
    const user = userJson ? JSON.parse(userJson) : null;
    console.log('Navbar: token=' + (token ? 'yes' : 'no') + ', user=' + (user ? user.username : 'none'));
    
    // Find register and login links - check both with and without leading slash
    let registerLink = navLinks.querySelector('a[href="register.html"]') || 
                       navLinks.querySelector('a[href="/register.html"]');
    let loginLink = navLinks.querySelector('a[href="login.html"]') || 
                    navLinks.querySelector('a[href="/login.html"]');
    
    console.log('Navbar: registerLink=' + (registerLink ? 'found' : 'not found') + ', loginLink=' + (loginLink ? 'found' : 'not found'));
    
    if (token && user) {
      // User is logged in - show user name and logout
      if (registerLink) {
        registerLink.innerHTML = `<i class="fas fa-user"></i> ${user.display_name || user.username}`;
        registerLink.href = 'profile.html';
        console.log('Navbar: Updated register link to profile');
      }
      
      if (loginLink) {
        loginLink.innerHTML = `<i class="fas fa-sign-out-alt"></i> Logout`;
        loginLink.href = '#';
        loginLink.onclick = function(e) {
          e.preventDefault();
          logout();
        };
        console.log('Navbar: Updated login link to logout');
      }
    } else {
      // User is not logged in - ensure register/login links are showing
      if (registerLink) {
        registerLink.innerHTML = `<i class="fas fa-user-plus"></i> Register`;
        registerLink.href = 'register.html';
        registerLink.onclick = null;
      }
      
      if (loginLink) {
        loginLink.innerHTML = `<i class="fas fa-sign-in-alt"></i> Login`;
        loginLink.href = 'login.html';
        loginLink.onclick = null;
      }
    }
    
  } catch (e) {
    console.error('Error updating navbar:', e);
  }
}

function updateSidebarForAuth() {
  const token = localStorage.getItem('gbf_token');
  const userJson = localStorage.getItem('gbf_user');
  const sidebarFooter = document.querySelector('.sidebar-footer');
  if (!sidebarFooter) {
    console.log('Sidebar: sidebar-footer not found');
    return;
  }
  
  try {
    const user = userJson ? JSON.parse(userJson) : null;
    console.log('Sidebar: token=' + (token ? 'yes' : 'no') + ', user=' + (user ? user.username : 'none'));
    
    if (token && user) {
      // User is logged in - update sidebar with user info and logout
      sidebarFooter.innerHTML = `
        <a href="profile.html" class="sidebar-user" id="sidebar-user">
          <div class="sidebar-user-avatar" id="sidebar-avatar">${(user.display_name || user.username || 'U').charAt(0).toUpperCase()}</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name" id="sidebar-username">${user.display_name || user.username}</div>
            <div class="sidebar-user-role">View Profile</div>
          </div>
        </a>
        <a href="#" class="sidebar-logout" id="sidebar-logout" onclick="logout(event)">
          <i class="fas fa-sign-out-alt"></i>
          <span>Logout</span>
        </a>
      `;
      console.log('Sidebar: Updated with logout button');
    } else {
      // User is not logged in - show guest state
      sidebarFooter.innerHTML = `
        <a href="login.html" class="sidebar-user" id="sidebar-user">
          <div class="sidebar-user-avatar" id="sidebar-avatar">--</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name" id="sidebar-username">Guest</div>
            <div class="sidebar-user-role">Login</div>
          </div>
        </a>
      `;
      console.log('Sidebar: Updated with guest state');
    }
    
  } catch (e) {
    console.error('Error updating sidebar:', e);
  }
}

function logout(event) {
  if (event) event.preventDefault();
  localStorage.removeItem('gbf_token');
  localStorage.removeItem('gbf_user');
  window.location.href = '/index.html';
}

// Initialize mobile menu
document.addEventListener('DOMContentLoaded', function() {
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const navLinks = document.querySelector('.nav-links');
  
  if (mobileMenuBtn && navLinks) {
    mobileMenuBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      navLinks.classList.toggle('active');
      navLinks.style.display = navLinks.classList.contains('active') ? 'flex' : 'none';
    });
  }
});