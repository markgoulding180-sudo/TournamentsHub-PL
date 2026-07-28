// toast.js — a small, Hub-themed notification that replaces the native
// browser alert() popup. Include this script on any page, then call
// showToast('message', 'success' | 'error' | 'info') instead of alert(...).

(function () {
  function ensureContainer() {
    let container = document.getElementById('gbf-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'gbf-toast-container';
      container.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 9999;
        display: flex; flex-direction: column-reverse; gap: 10px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }
    return container;
  }

  function ensureStyles() {
    if (document.getElementById('gbf-toast-styles')) return;
    const style = document.createElement('style');
    style.id = 'gbf-toast-styles';
    style.textContent = `
      @keyframes gbfToastIn { from { transform: translateY(120%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      @keyframes gbfToastOut { from { transform: translateY(0); opacity: 1; } to { transform: translateY(120%); opacity: 0; } }
      .gbf-toast {
        pointer-events: auto;
        display: flex; align-items: flex-start; gap: 12px;
        min-width: 280px; max-width: 380px;
        padding: 14px 16px;
        border-radius: 12px;
        background: #0a101f;
        border: 1px solid #131f35;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        font-family: 'Inter', -apple-system, sans-serif;
        animation: gbfToastIn 0.3s ease-out;
      }
      .gbf-toast.success { border-left: 3px solid #22c55e; }
      .gbf-toast.error { border-left: 3px solid #ef4444; }
      .gbf-toast.info { border-left: 3px solid #3b82f6; }
      .gbf-toast-icon { flex: none; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
      .gbf-toast.success .gbf-toast-icon { color: #22c55e; }
      .gbf-toast.error .gbf-toast-icon { color: #ef4444; }
      .gbf-toast.info .gbf-toast-icon { color: #60a5fa; }
      .gbf-toast-msg { flex: 1; color: #f1f5fc; font-size: 14px; line-height: 1.45; }
      .gbf-toast-close { flex: none; background: none; border: none; color: #4d5972; cursor: pointer; font-size: 16px; line-height: 1; padding: 0; }
      .gbf-toast-close:hover { color: #8a97b0; }
      @media (max-width: 480px) {
        #gbf-toast-container { left: 12px; right: 12px; bottom: 12px; }
        .gbf-toast { min-width: 0; max-width: none; }
      }
    `;
    document.head.appendChild(style);
  }

  const ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 11v5"/></svg>'
  };

  window.showToast = function (message, type = 'info', durationMs = 4500) {
    ensureStyles();
    const container = ensureContainer();

    const toast = document.createElement('div');
    toast.className = `gbf-toast ${type}`;
    toast.innerHTML = `
      <div class="gbf-toast-icon">${ICONS[type] || ICONS.info}</div>
      <div class="gbf-toast-msg"></div>
      <button class="gbf-toast-close" aria-label="Dismiss">&times;</button>
    `;
    toast.querySelector('.gbf-toast-msg').textContent = message; // textContent — avoids any HTML injection

    function remove() {
      toast.style.animation = 'gbfToastOut 0.25s ease-in forwards';
      setTimeout(() => toast.remove(), 250);
    }

    toast.querySelector('.gbf-toast-close').addEventListener('click', remove);
    container.appendChild(toast);

    if (durationMs > 0) {
      setTimeout(remove, durationMs);
    }
  };
})();
