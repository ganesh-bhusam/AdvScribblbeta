/**
 * Auth overlay logic: signup + login + JWT storage.
 * Exposes window.Auth with helpers and dispatches 'auth:ready' when authenticated.
 */
(function () {
  const API = ((window.ENV && window.ENV.API) || '') + '/api';
  const TOKEN_KEY = 'skribbl_token';
  const USER_KEY = 'skribbl_user';

  const overlay = document.getElementById('auth-overlay');
  const tabs = overlay.querySelectorAll('.auth-tab');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const loginError = document.getElementById('login-error');
  const signupError = document.getElementById('signup-error');
  const forgotLink = document.getElementById('forgot-link');

  function setTab(tab) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    loginForm.classList.toggle('active', tab === 'login');
    signupForm.classList.toggle('active', tab === 'signup');
    loginError.textContent = '';
    signupError.textContent = '';
  }
  tabs.forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));

  forgotLink?.addEventListener('click', () => {
    alert(
      'If you forgot your password, please contact support@advscribbl.app from your registered email along with your Razorpay payment receipt (if Premium). We will verify your purchase and reset your password manually.'
    );
  });

  async function call(path, body) {
    const res = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      const { token, user } = await call('/auth/login', { username, password });
      finishAuth(token, user);
    } catch (err) {
      loginError.textContent = err.message;
    }
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    signupError.textContent = '';
    const name = document.getElementById('signup-name').value.trim();
    const username = document.getElementById('signup-username').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    try {
      const { token, user } = await call('/auth/signup', { name, username, email, password });
      finishAuth(token, user);
    } catch (err) {
      signupError.textContent = err.message;
    }
  });

  function finishAuth(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    hideOverlay(user);
  }

  function hideOverlay(user) {
    overlay.classList.remove('active');
    document.getElementById('home').style.display = '';
    document.dispatchEvent(new CustomEvent('auth:ready', { detail: { user } }));
  }

  function showOverlay() {
    overlay.classList.add('active');
    document.getElementById('home').style.display = 'none';
    document.getElementById('game').style.display = 'none';
  }

  async function refresh() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    try {
      const res = await fetch(API + '/auth/me', { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) throw new Error('401');
      const data = await res.json();
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return data.user;
    } catch (_) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return null;
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    showOverlay();
    setTab('login');
  }

  window.Auth = {
    token: () => localStorage.getItem(TOKEN_KEY),
    user: () => {
      try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (_) { return null; }
    },
    setUser: (u) => localStorage.setItem(USER_KEY, JSON.stringify(u)),
    refresh,
    logout,
    showOverlay,
  };

  // Bootstrap
  document.addEventListener('DOMContentLoaded', async () => {
    const user = await refresh();
    if (user) {
      hideOverlay(user);
    } else {
      showOverlay();
    }
  });
})();
