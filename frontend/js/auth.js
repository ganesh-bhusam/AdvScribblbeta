/**
 * No-auth mode: Anyone can play by just entering a name.
 * window.Auth is kept as a lightweight shim so game.js references don't break.
 * Premium is detected by the server based on locked username, not a JWT token.
 */
(function () {
  // No stored token — socket auth sends just the name
  window.Auth = {
    token: () => null,
    user: () => null,
    setUser: () => {},
    refresh: async () => null,
    logout: () => {},
    showOverlay: () => {},
  };

  // Fire auth:ready immediately so game.js initialises
  document.addEventListener('DOMContentLoaded', () => {
    document.dispatchEvent(new CustomEvent('auth:ready', { detail: { user: null } }));
  });
})();
