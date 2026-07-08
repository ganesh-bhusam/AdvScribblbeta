/**
 * UPI Payment + Premium Username Locking Flow
 * Step 1: Check username availability
 * Step 2: Pay ₹20 via UPI (QR on desktop, intent link on mobile)
 * Step 3: Submit 12-digit UTR number
 * Step 4: Wait for admin approval → premium colors unlock
 */
(function () {
  const API = ((window.ENV && window.ENV.API) || '') + '/api';

  const modal      = document.getElementById('premium-modal');
  const closeBtn   = document.getElementById('premium-close');

  // Step panels
  const step1Panel = document.getElementById('upi-step1');
  const step2Panel = document.getElementById('upi-step2');
  const step3Panel = document.getElementById('upi-step3');
  const successPanel = document.getElementById('upi-success');

  let lockedUsername = '';
  let upiConfig = null;

  // Fetch UPI config from backend
  async function getUpiConfig() {
    if (upiConfig) return upiConfig;
    try {
      const res = await fetch(API + '/payment/upi-config');
      upiConfig = await res.json();
    } catch (_) {
      upiConfig = { upiId: 'advscribbl@ybl', upiName: 'Bhusam Ganesh', amount: 20 };
    }
    return upiConfig;
  }

  function showStep(n) {
    [step1Panel, step2Panel, step3Panel, successPanel].forEach((p, i) => {
      if (p) p.style.display = (i + 1 === n || (n === 4 && i === 3)) ? '' : 'none';
    });
    if (successPanel) successPanel.style.display = (n === 4) ? '' : 'none';
  }

  function show() {
    modal.style.display = 'flex';
    showStep(1);
    const usernameInput = document.getElementById('upi-username-input');
    if (usernameInput) {
      // Pre-fill from the name they typed on the home screen
      const homeName = (document.getElementById('login-name')?.value || '').trim();
      if (homeName) usernameInput.value = homeName;
    }
    document.getElementById('upi-check-result').textContent = '';
  }

  function hide() {
    modal.style.display = 'none';
  }

  if (closeBtn) closeBtn.addEventListener('click', hide);
  modal?.addEventListener('click', (e) => { if (e.target === modal) hide(); });

  // ── STEP 1: Check username availability ──────────────────────────────────
  const checkBtn    = document.getElementById('upi-check-btn');
  const checkResult = document.getElementById('upi-check-result');

  checkBtn?.addEventListener('click', async () => {
    const input = document.getElementById('upi-username-input');
    const username = input.value.trim().toLowerCase();
    if (!username) { checkResult.textContent = 'Enter a username first.'; checkResult.className = 'utr-status error'; return; }

    checkBtn.disabled = true;
    checkResult.textContent = 'Checking…';
    checkResult.className = 'utr-status';

    try {
      const res = await fetch(`${API}/payment/check-username?username=${encodeURIComponent(username)}`);
      const data = await res.json();
      if (data.available) {
        checkResult.textContent = `✅ "${username}" is available! Proceed to pay.`;
        checkResult.className = 'utr-status success';
        lockedUsername = username;
        document.getElementById('upi-step2-username').textContent = `@${username}`;
        document.getElementById('upi-success-name').textContent = username;
        setTimeout(() => showStep(2), 900);
      } else {
        checkResult.textContent = `❌ ${data.reason}`;
        checkResult.className = 'utr-status error';
      }
    } catch (_) {
      checkResult.textContent = '❌ Network error. Try again.';
      checkResult.className = 'utr-status error';
    } finally {
      checkBtn.disabled = false;
    }
  });

  // ── STEP 2: Show payment options ─────────────────────────────────────────
  const proceedToUTRBtn = document.getElementById('upi-paid-btn');

  // When step 2 shows, build the UPI links
  document.getElementById('upi-pay-btn')?.addEventListener('click', async () => {
    const cfg = await getUpiConfig();
    const upiUrl = `upi://pay?pa=${encodeURIComponent(cfg.upiId)}&pn=${encodeURIComponent(cfg.upiName)}&am=${cfg.amount}&cu=INR&tn=AdvScribblPremium-${lockedUsername}`;
    window.location.href = upiUrl;
  });

  proceedToUTRBtn?.addEventListener('click', () => showStep(3));

  // ── STEP 3: Submit UTR ───────────────────────────────────────────────────
  const submitUTRBtn  = document.getElementById('upi-submit-utr-btn');
  const utrStatus     = document.getElementById('utr-submit-status');

  submitUTRBtn?.addEventListener('click', async () => {
    const utrInput = document.getElementById('upi-utr-input');
    const utr = utrInput.value.trim().replace(/\s+/g, '');

    if (!/^\d{12}$/.test(utr)) {
      utrStatus.textContent = '❌ UTR must be exactly 12 digits.';
      utrStatus.className = 'utr-status error';
      return;
    }

    submitUTRBtn.disabled = true;
    submitUTRBtn.textContent = 'Submitting…';
    utrStatus.textContent = '';

    try {
      const res = await fetch(`${API}/payment/submit-utr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: lockedUsername, utr }),
      });
      const data = await res.json();
      if (!res.ok) {
        utrStatus.textContent = `❌ ${data.error}`;
        utrStatus.className = 'utr-status error';
        submitUTRBtn.disabled = false;
        submitUTRBtn.textContent = '✅ Submit UTR';
        return;
      }
      // Success
      utrStatus.textContent = '';
      showStep(4);
    } catch (_) {
      utrStatus.textContent = '❌ Network error. Please try again.';
      utrStatus.className = 'utr-status error';
      submitUTRBtn.disabled = false;
      submitUTRBtn.textContent = '✅ Submit UTR';
    }
  });

  // ── Success close ────────────────────────────────────────────────────────
  document.getElementById('upi-success-close')?.addEventListener('click', hide);

  // ── Bind "Unlock Premium" button ─────────────────────────────────────────
  window.Payment = { open: show, hide };

  document.getElementById('button-unlock-premium')?.addEventListener('click', () => show());

  // Detect if user is on mobile and toggle QR vs intent button
  document.addEventListener('DOMContentLoaded', async () => {
    const cfg = await getUpiConfig();
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const qrSection  = document.getElementById('upi-qr-section');
    const payBtn     = document.getElementById('upi-pay-btn');
    if (isMobile) {
      if (qrSection) qrSection.style.display = 'none';
      if (payBtn) {
        payBtn.style.display = 'block';
        payBtn.textContent = `📱 Open GPay / PhonePe — Pay ₹${cfg.amount}`;
      }
    } else {
      if (qrSection) qrSection.style.display = 'block';
      if (payBtn) {
        payBtn.style.display = 'none'; // Hide intent button on desktop
      }
    }
    // Update amount display
    document.querySelectorAll('.upi-amount').forEach(el => {
      el.textContent = `₹${cfg.amount}`;
    });
  });
})();
