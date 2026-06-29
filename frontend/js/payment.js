/**
 * Razorpay payment + premium unlock flow.
 * Exposes window.Payment.open() to launch the upgrade modal.
 */
(function () {
  const API = ((window.ENV && window.ENV.API) || '') + '/api';

  const modal = document.getElementById('premium-modal');
  const closeBtn = document.getElementById('premium-close');
  const payBtn = document.getElementById('premium-pay-btn');
  const note = document.getElementById('payment-note');

  let config = null;

  async function getConfig() {
    if (config) return config;
    const res = await fetch(API + '/payment/config');
    config = await res.json();
    return config;
  }

  function authHeaders() {
    const t = window.Auth?.token();
    return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  function show() {
    modal.style.display = 'flex';
    note.textContent = '';
    getConfig().then((cfg) => {
      if (cfg.mock) {
        note.textContent = 'Demo mode: clicking Pay will instantly grant premium (no charge).';
      } else {
        note.textContent = 'Secure payment via Razorpay. Test card 4111 1111 1111 1111 in test mode.';
      }
    });
  }

  function hide() {
    modal.style.display = 'none';
  }

  closeBtn.addEventListener('click', hide);
  modal.addEventListener('click', (e) => { if (e.target === modal) hide(); });

  payBtn.addEventListener('click', async () => {
    payBtn.disabled = true;
    const original = payBtn.textContent;
    payBtn.textContent = 'Creating order…';
    try {
      const cfg = await getConfig();
      const orderRes = await fetch(API + '/payment/order', {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      const order = await orderRes.json();
      if (!orderRes.ok) throw new Error(order.error || 'Failed to create order');

      if (cfg.mock) {
        // Mock-mode: immediately verify
        await verify({ razorpay_order_id: order.orderId });
        return;
      }

      const options = {
        key: cfg.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'AdvScribbl Premium',
        description: cfg.productName,
        theme: { color: '#6366F1' },
        prefill: {
          name: window.Auth?.user()?.name || '',
          email: window.Auth?.user()?.email || '',
        },
        handler: async function (response) {
          await verify(response);
        },
        modal: {
          ondismiss: function () {
            payBtn.disabled = false;
            payBtn.textContent = original;
          },
        },
      };
      const rp = new Razorpay(options);
      rp.open();
    } catch (err) {
      console.error(err);
      window.toast?.(err.message, 'error');
      payBtn.disabled = false;
      payBtn.textContent = original;
    }
  });

  async function verify(response) {
    payBtn.textContent = 'Verifying…';
    const res = await fetch(API + '/payment/verify', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(response),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      window.toast?.(data.error || 'Verification failed', 'error');
      payBtn.disabled = false;
      payBtn.textContent = 'Pay ₹25 via Razorpay';
      return;
    }
    const fresh = await window.Auth.refresh();
    if (fresh) window.Auth.setUser(fresh);
    window.toast?.('Premium unlocked! 🎉', 'success');
    hide();
    document.dispatchEvent(new CustomEvent('premium:unlocked'));
    payBtn.disabled = false;
    payBtn.textContent = 'Pay ₹25 via Razorpay';
  }

  window.Payment = { open: show, hide };

  // Bind premium buttons
  document.getElementById('button-unlock-premium')?.addEventListener('click', () => {
    if (window.Auth?.user()?.has_premium) {
      window.toast?.('You already own Premium!', 'success');
      return;
    }
    show();
  });
})();
