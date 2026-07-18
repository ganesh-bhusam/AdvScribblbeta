/**
 * AdvScribbl — game client.
 * Implements the protocol from the architecture spec:
 *   - Socket.io with path /api/socket.io/
 *   - 'login' handshake + 'data' multiplexing with {id, data}
 *   - State machine: G(0) K(1) F(2) V(3) j(4) Z(5) X(6) J(7)
 *   - Drawing tools: pencil, bucket, line, rect, circle, eraser
 *   - 26 standard + 26 premium colors swapped via toggle
 */
(function () {
  window.ENV = window.ENV || {};
  window.ENV.API = '';

  const STATE = { G: 0, K: 1, F: 2, V: 3, j: 4, Z: 5, X: 6, J: 7 };

  // 26 standard + 26 premium colors
  const STANDARD_COLORS = [
    '#FFFFFF','#C1C1C1','#EF130B','#FF7100','#FFE400','#00CC00',
    '#00B2FF','#231FD3','#A300BA','#D37CAA','#A0522D','#000000','#4C4C4C',
    '#740B07','#C23800','#E8A200','#005510','#00569E','#0E0865','#550069',
    '#A75574','#63300D','#111111','#222222','#333333','#444444',
  ];
  const PREMIUM_COLORS = [
    '#FFB3BA','#FFDFBA','#FFFFBA','#BAFFC9','#BAE1FF','#D0E1FF','#E1BAFF',
    '#FFB3E6','#FFC4E1','#F4F4F4','#E0E0E0','#FF6B6B','#FF9E9E',
    '#FFD700','#98FF98','#4ECDC4','#45B7D1','#1A535C','#5F27CD','#341F97',
    '#01A3A4','#B8E994','#FF9FF3','#FCA311','#FECA57','#54A0FF',
  ];
  const ALL_COLORS = [...STANDARD_COLORS, ...PREMIUM_COLORS];

  // 10 classic skribbl-style head colors (indices match data-color CSS)
  const HEAD_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'mint', 'gold'];

  const ELEMENTS = [
    { name:"Classic", c1:"#FFDE7A", c2:"#FDC846", glow:"#FDC846", ink:"#1a1a1a" },
    { name:"Fire",   c1:"#FFB020", c2:"#FF5A36", glow:"#FF5A36", ink:"#3a1400" },
    { name:"Water",  c1:"#8FE3FF", c2:"#2FB8E8", glow:"#2FB8E8", ink:"#04263a" },
    { name:"Nature", c1:"#B6FF9C", c2:"#3FBE72", glow:"#3FBE72", ink:"#0b3a1c" },
    { name:"Storm",  c1:"#C7B8FF", c2:"#8B7CF6", glow:"#8B7CF6", ink:"#1c1240" },
    { name:"Shadow", c1:"#8a6bd6", c2:"#2b1b44", glow:"#6B4FA0", ink:"#efe9ff" },
    { name:"Light",  c1:"#FFFFFF", c2:"#FFE9A8", glow:"#FFE9A8", ink:"#3a2e05" }
  ];

  const EXPRESSIONS = [
    { name:"Happy", face:(ink)=>`<circle cx="82" cy="92" r="6" fill="${ink}"/><circle cx="118" cy="92" r="6" fill="${ink}"/><path d="M80 114 Q100 132 120 114" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round"/>` },
    { name:"Fierce", face:(ink)=>`<path d="M74 86 L92 94" stroke="${ink}" stroke-width="6" stroke-linecap="round"/><path d="M126 86 L108 94" stroke="${ink}" stroke-width="6" stroke-linecap="round"/><circle cx="86" cy="98" r="4.5" fill="${ink}"/><circle cx="114" cy="98" r="4.5" fill="${ink}"/><path d="M82 118 L118 118" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>` },
    { name:"Cool", face:(ink)=>`<rect x="70" y="88" width="26" height="10" rx="5" fill="${ink}"/><rect x="104" y="88" width="26" height="10" rx="5" fill="${ink}"/><rect x="96" y="91" width="8" height="4" fill="${ink}"/><path d="M86 116 Q100 122 114 114" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round"/>` },
    { name:"Sleepy", face:(ink)=>`<path d="M74 92 Q82 86 90 92" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M110 92 Q118 86 126 92" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="100" cy="120" r="6" fill="none" stroke="${ink}" stroke-width="4"/>` },
    { name:"Star-Eyed", face:(ink)=>{
        const star=(cx,cy)=>{let pts=[];for(let i=0;i<10;i++){const a=Math.PI/2+i*Math.PI/5;const r=i%2===0?9:4;pts.push((cx+r*Math.cos(a)).toFixed(1)+","+(cy-r*Math.sin(a)).toFixed(1));}return `<polygon points="${pts.join(' ')}" fill="${ink}"/>`;};
        return star(83,93)+star(117,93)+`<ellipse cx="100" cy="120" rx="10" ry="7" fill="${ink}"/>`;
      }},
    { name:"Grin", face:(ink)=>`<circle cx="83" cy="92" r="6" fill="${ink}"/><circle cx="117" cy="92" r="6" fill="${ink}"/><path d="M78 112 Q100 134 122 112 Q100 122 78 112 Z" fill="${ink}"/>` },
    { name:"Angry", face:(ink)=>`<path d="M74 84 L100 96 L126 84" stroke="${ink}" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="86" cy="98" r="4" fill="${ink}"/><circle cx="114" cy="98" r="4" fill="${ink}"/><path d="M80 122 L120 122" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>` },
    { name:"Surprised", face:(ink)=>`<circle cx="83" cy="94" r="8" fill="none" stroke="${ink}" stroke-width="4"/><circle cx="117" cy="94" r="8" fill="none" stroke="${ink}" stroke-width="4"/><circle cx="83" cy="94" r="3" fill="${ink}"/><circle cx="117" cy="94" r="3" fill="${ink}"/><ellipse cx="100" cy="122" rx="8" ry="10" fill="${ink}"/>` }
  ];

  function avatarSVG(elIdx, exIdx, uid, size) {
    const el = ELEMENTS[((elIdx % ELEMENTS.length) + ELEMENTS.length) % ELEMENTS.length];
    const ex = EXPRESSIONS[((exIdx % EXPRESSIONS.length) + EXPRESSIONS.length) % EXPRESSIONS.length];
    const gid = 'av-grad-' + uid;
    return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" style="display:block;">
      <defs><radialGradient id="${gid}" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="${el.c1}"/><stop offset="100%" stop-color="${el.c2}"/>
      </radialGradient></defs>
      <circle cx="100" cy="100" r="94" fill="${el.c2}" opacity="0.22"/>
      <circle cx="100" cy="100" r="78" fill="url(#${gid})"/>
      <circle cx="100" cy="100" r="78" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="4"/>
      ${ex.face(el.ink)}
    </svg>`;
  }

  function renderAvatarTo(domEl, avatarArr, uid, size) {
    let elIdx = 0; let exIdx = 0;
    if (avatarArr && avatarArr.length >= 2) {
      elIdx = avatarArr[0];
      exIdx = avatarArr[1];
    } else if (avatarArr && avatarArr.length === 1) {
      elIdx = avatarArr[0] % ELEMENTS.length;
      exIdx = 0;
    }
    domEl.innerHTML = avatarSVG(elIdx, exIdx, uid, size);
  }

  // ============================ STATE ============================
  let socket = null;
  let me = null;
  let room = null;
  let players = [];
  let currentDrawerId = null;
  let currentState = STATE.G;
  let currentWord = null;
  let wordHints = [];
  let colorIndex = 26;  // Start on first premium color (premium palette is default)
  let secondaryColorIndex = 0;
  let brushSize = 8;
  let tool = 'pencil';
  let currentHue = 0;
  let drawingEnabled = false;
  let premiumColorsActive = true;  // Premium colors are the default palette
  let languages = [];
  let myEmojiCount = 0;
  let avatarIdx = 0;
  const mutedPlayerIds = new Set();
  // Drawing-rating aggregation (cleared on new drawer)
  let rateScores = new Map(); // raterPlayerId -> 0|1
  let myRate = null;          // 0|1|null for this drawing

  const canvas = document.getElementById('draw-canvas');
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawCommands = [];

  // Hidden input element for native color wheel picker
  const wheelInput = document.createElement('input');
  wheelInput.type = 'color';
  wheelInput.style.position = 'absolute';
  wheelInput.style.opacity = '0';
  wheelInput.style.width = '0';
  wheelInput.style.height = '0';
  document.body.appendChild(wheelInput);

  // Advanced Color Picker integration
  (function(){
    // h: 0-360, s: 0-1, v: 0-1, a: 0-1
    let state = { h: 120, s: 0.55, v: 0.55, a: 1 };
    let metallic = 0.0;
    let roughness = 0.741176;

    function hsvToRgb(h, s, v) {
      h = ((h % 360) + 360) % 360;
      const c = v * s;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = v - c;
      let r=0,g=0,b=0;
      if (h < 60) [r,g,b] = [c,x,0];
      else if (h < 120) [r,g,b] = [x,c,0];
      else if (h < 180) [r,g,b] = [0,c,x];
      else if (h < 240) [r,g,b] = [0,x,c];
      else if (h < 300) [r,g,b] = [x,0,c];
      else [r,g,b] = [c,0,x];
      return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
    }

    function rgbToHsv(r,g,b) {
      r/=255; g/=255; b/=255;
      const max = Math.max(r,g,b), min = Math.min(r,g,b);
      const d = max - min;
      let h = 0;
      if (d !== 0) {
        if (max === r) h = ((g-b)/d) % 6;
        else if (max === g) h = (b-r)/d + 2;
        else h = (r-g)/d + 4;
        h *= 60;
        if (h < 0) h += 360;
      }
      const s = max === 0 ? 0 : d/max;
      const v = max;
      return [h,s,v];
    }

    function toHex2(n) { return n.toString(16).padStart(2,'0').toUpperCase(); }
    function rgbaToHex(r,g,b,a) { return toHex2(r)+toHex2(g)+toHex2(b)+toHex2(Math.round(a*255)); }

    function currentRgb() { return hsvToRgb(state.h, state.s, state.v); }

    // ---------------- wheel ----------------
    const wheelCanvas = document.getElementById('wheelCanvas');
    if (!wheelCanvas) return; // Guard
    const wctx = wheelCanvas.getContext('2d');
    const WSIZE = 150;

    function drawWheel() {
      const img = wctx.createImageData(WSIZE, WSIZE);
      const radius = WSIZE / 2;
      for (let y = 0; y < WSIZE; y++) {
        for (let x = 0; x < WSIZE; x++) {
          const dx = x - radius, dy = y - radius;
          const dist = Math.sqrt(dx*dx + dy*dy);
          const idx = (y * WSIZE + x) * 4;
          if (dist <= radius) {
            let angle = Math.atan2(dy, dx) * 180 / Math.PI;
            if (angle < 0) angle += 360;
            const sat = Math.min(dist / radius, 1);
            const [r,g,b] = hsvToRgb(angle, sat, 1);
            img.data[idx] = r; img.data[idx+1] = g; img.data[idx+2] = b; img.data[idx+3] = 255;
          } else {
            img.data[idx+3] = 0;
          }
        }
      }
      wctx.putImageData(img, 0, 0);
    }
    drawWheel();

    function updateWheelDot() {
      const radius = WSIZE / 2;
      const angleRad = state.h * Math.PI / 180;
      const dist = state.s * radius;
      const x = radius + Math.cos(angleRad) * dist;
      const y = radius + Math.sin(angleRad) * dist;
      const dot = document.getElementById('wheelDot');
      if(dot) {
        dot.style.left = x + 'px';
        dot.style.top = y + 'px';
      }
    }

    function wheelInteract(clientX, clientY) {
      const rect = wheelCanvas.getBoundingClientRect();
      const radius = rect.width / 2;
      let dx = clientX - rect.left - radius;
      let dy = clientY - rect.top - radius;
      let dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > radius) { dx = dx * radius / dist; dy = dy * radius / dist; dist = radius; }
      let angle = Math.atan2(dy, dx) * 180 / Math.PI;
      if (angle < 0) angle += 360;
      state.h = angle;
      state.s = radius === 0 ? 0 : dist / radius;
      render();
    }

    let wheelDragging = false;
    wheelCanvas.addEventListener('pointerdown', e => { wheelDragging = true; wheelCanvas.setPointerCapture(e.pointerId); wheelInteract(e.clientX, e.clientY); });
    wheelCanvas.addEventListener('pointermove', e => { if (wheelDragging) wheelInteract(e.clientX, e.clientY); });
    wheelCanvas.addEventListener('pointerup', e => { wheelDragging = false; });

    // ---------------- generic slider helper ----------------
    function makeSlider(el, opts) {
      if(!el) return;
      function frac() {
        let f = opts.get();
        return Math.min(1, Math.max(0, f));
      }
      function pointerToFrac(clientX, clientY) {
        const rect = el.getBoundingClientRect();
        let f;
        if (opts.vertical) {
          f = 1 - (clientY - rect.top) / rect.height;
        } else {
          f = (clientX - rect.left) / rect.width;
        }
        return Math.min(1, Math.max(0, f));
      }
      let dragging = false;
      el.addEventListener('pointerdown', e => {
        dragging = true;
        el.setPointerCapture(e.pointerId);
        opts.set(pointerToFrac(e.clientX, e.clientY));
        render();
      });
      el.addEventListener('pointermove', e => {
        if (dragging) { opts.set(pointerToFrac(e.clientX, e.clientY)); render(); }
      });
      el.addEventListener('pointerup', () => dragging = false);
    }

    // ---------------- build RGBA + HSV rows ----------------
    const rgbaCol = document.getElementById('rgbaCol');
    const hsvSliders = document.getElementById('hsvSliders');

    function buildRow(container, key) {
      if(!container) return;
      const row = document.createElement('div');
      row.className = 'hslider-row';
      row.innerHTML = `<label class="small">${key.toUpperCase()}</label>
        <div class="hslider" id="slider-${key}"><div class="mark" id="mark-${key}"></div></div>
        <input type="number" id="num-${key}" step="0.001" min="0" max="${key==='h'?360:1}">`;
      container.appendChild(row);
    }
    if (rgbaCol && hsvSliders) {
        ['r','g','b','a'].forEach(k => buildRow(rgbaCol, k));
        ['h','s','v'].forEach(k => buildRow(hsvSliders, k));
    }

    // wire RGB sliders
    function rgbGetSet(key) {
      return {
        get: () => {
          const [r,g,b] = currentRgb();
          const map = {r,g,b};
          return map[key] / 255;
        },
        set: (frac) => {
          let [r,g,b] = currentRgb();
          const map = {r,g,b};
          map[key] = Math.round(frac * 255);
          const [h,s,v] = rgbToHsv(map.r, map.g, map.b);
          state.h = h; state.s = s; state.v = v;
        }
      };
    }
    ['r','g','b'].forEach(k => {
      const gs = rgbGetSet(k);
      makeSlider(document.getElementById('slider-'+k), { get: gs.get, set: gs.set });
    });
    makeSlider(document.getElementById('slider-a'), { get: () => state.a, set: f => state.a = f });

    makeSlider(document.getElementById('slider-h'), { get: () => state.h/360, set: f => state.h = f*360 });
    makeSlider(document.getElementById('slider-s'), { get: () => state.s, set: f => state.s = f });
    makeSlider(document.getElementById('slider-v'), { get: () => state.v, set: f => state.v = f });

    // number inputs sync
    function wireNumber(key, getFrac, setFrac, scale) {
      const inp = document.getElementById('num-'+key);
      if(!inp) return;
      inp.addEventListener('change', () => {
        let val = parseFloat(inp.value);
        if (isNaN(val)) return;
        setFrac(val / scale);
        render();
      });
    }
    wireNumber('r', null, f => { const gs = rgbGetSet('r'); gs.set(f); }, 1);
    wireNumber('g', null, f => { const gs = rgbGetSet('g'); gs.set(f); }, 1);
    wireNumber('b', null, f => { const gs = rgbGetSet('b'); gs.set(f); }, 1);
    wireNumber('a', null, f => state.a = f, 1);
    const numH = document.getElementById('num-h');
    if (numH) {
      numH.addEventListener('change', () => {
        let val = parseFloat(numH.value);
        if (!isNaN(val)) { state.h = val; render(); }
      });
    }
    wireNumber('s', null, f => state.s = f, 1);
    wireNumber('v', null, f => state.v = f, 1);

    // ---------------- vertical sliders (value / alpha) ----------------
    makeSlider(document.getElementById('vSlider'), { vertical: true, get: () => state.v, set: f => state.v = f });
    makeSlider(document.getElementById('aSlider'), { vertical: true, get: () => state.a, set: f => state.a = f });

    // ---------------- hex input ----------------
    const hexInput = document.getElementById('hexInput');
    if (hexInput) {
      hexInput.addEventListener('change', () => {
        let hex = hexInput.value.replace('#','').trim();
        if (/^[0-9a-fA-F]{6}$/.test(hex)) hex += 'FF';
        if (/^[0-9a-fA-F]{8}$/.test(hex)) {
          const r = parseInt(hex.substr(0,2),16);
          const g = parseInt(hex.substr(2,2),16);
          const b = parseInt(hex.substr(4,2),16);
          const a = parseInt(hex.substr(6,2),16) / 255;
          const [h,s,v] = rgbToHsv(r,g,b);
          state.h = h; state.s = s; state.v = v; state.a = a;
          render();
        }
      });
    }

    // ---------------- palette ----------------
    const paletteColors = [
      '#3d1f10','#5c2c17','#7a3b1d','#a15226','#c96f34','#e08c47','#f0a862','#f7c98a',
      '#f9d9a8','#ffe9c7','#8b1e1e','#b52a2a','#d9432f','#f0603c','#f2825b','#c2185b',
      '#8e24aa','#5e35b1','#3949ab','#1e88e5','#039be5','#00acc1','#00897b','#43a047',
      '#7cb342','#c0ca33','#fdd835','#ffb300','#fb8c00','#f4511e','#6d4c41','#757575',
      '#546e7a','#26323a','#1b2a2f','#102015','#1a3b1f','#245c2a','#2e7d32','#66bb6a',
      '#a5d6a7','#004d40','#00695c','#00796b','#26a69a','#004ba0','#1565c0','#283593',
      '#4527a0','#6a1b9a','#ad1457','#c62828','#d84315','#4e342e','#212121','#000000',
      '#ffffff','#eeeeee','#bdbdbd','#9e9e9e','#616161','#f5f5dc','#d2b48c','#8d6e63'
    ];
    const paletteGrid = document.getElementById('paletteGrid');
    if (paletteGrid) {
      paletteColors.forEach(c => {
        const sw = document.createElement('div');
        sw.className = 'swatch';
        sw.style.background = c;
        sw.title = c;
        sw.addEventListener('click', () => {
          const r = parseInt(c.substr(1,2),16), g = parseInt(c.substr(3,2),16), b = parseInt(c.substr(5,2),16);
          const [h,s,v] = rgbToHsv(r,g,b);
          state.h = h; state.s = s; state.v = v;
          render();
        });
        paletteGrid.appendChild(sw);
      });
    }

    // ---------------- PBR sliders ----------------
    const metallicSlider = document.getElementById('metallicSlider');
    const roughnessSlider = document.getElementById('roughnessSlider');
    makeSlider(metallicSlider, { get: () => metallic, set: f => { metallic = f; renderPbr(); } });
    makeSlider(roughnessSlider, { get: () => roughness, set: f => { roughness = f; renderPbr(); } });

    function renderPbr() {
      if(metallicSlider) {
        metallicSlider.style.background = `linear-gradient(to right, #1a1a1a, #eef2f6)`;
        const mark = metallicSlider.querySelector('.mark');
        if (mark) mark.style.left = (metallic*100)+'%';
      }
      if(roughnessSlider) {
        roughnessSlider.style.background = `linear-gradient(to right, #444, #ddd)`;
        const mark = roughnessSlider.querySelector('.mark');
        if (mark) mark.style.left = (roughness*100)+'%';
      }
      const mVal = document.getElementById('metallicVal');
      if (mVal) mVal.textContent = metallic.toFixed(3);
      const rVal = document.getElementById('roughnessVal');
      if (rVal) rVal.textContent = roughness.toFixed(3);
    }

    // ---------------- eyedropper ----------------
    async function runEyedropper() {
      if (!('EyeDropper' in window)) {
        alert('EyeDropper API not supported in this browser.');
        return;
      }
      try {
        const ed = new window.EyeDropper();
        const result = await ed.open();
        const hex = result.sRGBHex.replace('#','');
        const r = parseInt(hex.substr(0,2),16), g = parseInt(hex.substr(2,2),16), b = parseInt(hex.substr(4,2),16);
        const [h,s,v] = rgbToHsv(r,g,b);
        state.h = h; state.s = s; state.v = v;
        render();
      } catch (err) { /* user cancelled */ }
    }
    const dropperBtn = document.getElementById('dropperBtn');
    if (dropperBtn) dropperBtn.addEventListener('click', runEyedropper);
    const eyedropBtn = document.getElementById('eyedropBtn');
    if (eyedropBtn) eyedropBtn.addEventListener('click', runEyedropper);

    let isInitialRender = true;

    // ---------------- master render ----------------
    function render() {
      const [r,g,b] = currentRgb();

      // preview
      const previewFill = document.getElementById('previewFill');
      if (previewFill) previewFill.style.background = `rgba(${r},${g},${b},${state.a})`;
      const eyedropSwatch = document.getElementById('eyedropSwatch');
      if (eyedropSwatch) eyedropSwatch.style.background = `rgba(${r},${g},${b},${state.a})`;

      // wheel dot
      updateWheelDot();

      // vertical value slider
      const vSlider = document.getElementById('vSlider');
      const [hueR,hueG,hueB] = hsvToRgb(state.h, state.s, 1);
      if (vSlider) vSlider.style.background = `linear-gradient(to top, #000, rgb(${hueR},${hueG},${hueB}))`;
      const vMark = document.getElementById('vMark');
      if (vMark) vMark.style.top = ((1-state.v)*100)+'%';

      // vertical alpha slider
      const aSlider = document.getElementById('aSlider');
      if (aSlider) {
        aSlider.style.backgroundImage = `linear-gradient(to top, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1)),
          linear-gradient(45deg, #777 25%, transparent 25%),
          linear-gradient(-45deg, #777 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #777 75%),
          linear-gradient(-45deg, transparent 75%, #777 75%)`;
        aSlider.style.backgroundSize = 'auto, 8px 8px, 8px 8px, 8px 8px, 8px 8px';
        aSlider.style.backgroundPosition = '0 0, 0 0, 0 4px, 4px -4px, -4px 0px';
      }
      const aMark = document.getElementById('aMark');
      if (aMark) aMark.style.top = ((1-state.a)*100)+'%';

      // RGB sliders
      const rgbVals = {r,g,b};
      ['r','g','b'].forEach(k => {
        const slider = document.getElementById('slider-'+k);
        if(!slider) return;
        const lo = {...rgbVals}; lo[k] = 0;
        const hi = {...rgbVals}; hi[k] = 255;
        slider.style.background = `linear-gradient(to right, rgb(${lo.r},${lo.g},${lo.b}), rgb(${hi.r},${hi.g},${hi.b}))`;
        document.getElementById('mark-'+k).style.left = ((rgbVals[k]/255)*100)+'%';
        document.getElementById('num-'+k).value = (rgbVals[k]/255).toFixed(3);
      });
      // alpha slider (horizontal, in RGBA column)
      const aH = document.getElementById('slider-a');
      if (aH) {
        aH.style.backgroundImage = `linear-gradient(to right, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1)),
          linear-gradient(45deg, #777 25%, transparent 25%),
          linear-gradient(-45deg, #777 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #777 75%),
          linear-gradient(-45deg, transparent 75%, #777 75%)`;
        aH.style.backgroundSize = 'auto, 8px 8px, 8px 8px, 8px 8px, 8px 8px';
        aH.style.backgroundPosition = '0 0, 0 0, 0 4px, 4px -4px, -4px 0px';
        document.getElementById('mark-a').style.left = (state.a*100)+'%';
        document.getElementById('num-a').value = state.a.toFixed(3);
      }

      // HSV sliders
      const sliderH = document.getElementById('slider-h');
      if (sliderH) {
        sliderH.style.background =
          'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)';
        document.getElementById('mark-h').style.left = ((state.h/360)*100)+'%';
        document.getElementById('num-h').value = state.h.toFixed(1);
      }

      const sliderS = document.getElementById('slider-s');
      if (sliderS) {
        const [sLoR,sLoG,sLoB] = hsvToRgb(state.h, 0, state.v);
        const [sHiR,sHiG,sHiB] = hsvToRgb(state.h, 1, state.v);
        sliderS.style.background = `linear-gradient(to right, rgb(${sLoR},${sLoG},${sLoB}), rgb(${sHiR},${sHiG},${sHiB}))`;
        document.getElementById('mark-s').style.left = (state.s*100)+'%';
        document.getElementById('num-s').value = state.s.toFixed(3);
      }

      const sliderV = document.getElementById('slider-v');
      if (sliderV) {
        sliderV.style.background = `linear-gradient(to right, #000000, rgb(${hueR},${hueG},${hueB}))`;
        document.getElementById('mark-v').style.left = (state.v*100)+'%';
        document.getElementById('num-v').value = state.v.toFixed(3);
      }

      // hex
      if (hexInput && document.activeElement !== hexInput) {
        hexInput.value = rgbaToHex(r,g,b,state.a);
      }

      // Notify the main game logic to update the primary color!
      if (!isInitialRender && typeof setColor === 'function' && hexInput) {
        // If alpha is 1, use 6 character hex for better compatibility, else use 8
        const hexStr = '#' + (state.a === 1 ? hexInput.value.slice(0, 6) : hexInput.value);
        setColor(hexStr);
      }
    }

    render();
    renderPbr();
    isInitialRender = false;
  })();

  // Legacy: action-random (kept for any old references)
  document.addEventListener('click', (ev) => {
    const btn = ev.target && ev.target.closest('#action-random');
    if (btn) {
      ev.preventDefault();
      const rndIdx = Math.floor(Math.random() * ALL_COLORS.length);
      setColor(rndIdx);
    }
  });

  // ============================ HELPERS ============================
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  function toast(msg, kind = '') {
    const t = $('toast');
    if (!t) return; // Guard: skip if DOM not ready
    t.textContent = msg;
    t.className = kind + ' show';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = kind; }, 2800);
  }
  window.toast = toast;

  function colorFromIdx(idx) {
    if (typeof idx === 'string') return idx;
    if (idx < 0 || idx >= ALL_COLORS.length) return '#000000';
    return ALL_COLORS[idx];
  }

  function show(view) {
    $('home').style.display = view === 'home' ? '' : 'none';
    $('game').style.display = view === 'game' ? '' : 'none';
    
    // Wipe game UI state when returning to home
    if (view === 'home') {
      const chatContent = $('chat-content');
      if (chatContent) chatContent.innerHTML = '';
      if (typeof clearCanvasLocal === 'function') clearCanvasLocal();
    }
  }

  function playSound(name) {
    try {
      const ext = name.includes('.') ? '' : '.ogg';
      const a = new Audio('/audio/' + name + ext);
      a.volume = 0.35;
      a.play().catch(() => {});
    } catch (_) { /* noop */ }
  }

  // ============================ LANGUAGES ============================
  async function loadLanguages() {
    try {
      const r = await fetch((window.ENV.API || '') + '/api/languages');
      const d = await r.json();
      languages = d.languages || [];
      const sel = $('login-language');
      sel.innerHTML = '';
      languages.forEach((l) => {
        const o = document.createElement('option');
        o.value = String(l.id); o.textContent = l.name;
        sel.appendChild(o);
      });
    } catch (e) { console.error('lang', e); }
  }

  // ============================ HOME ============================
  function updateHomeUI() {
    let name = $('login-name').value;
    if (name) {
      localStorage.setItem('advscribbl_name', name);
    }
    if (!name) {
      name = 'Guest';
    }
    $('welcome-text').innerHTML = `Hi <b>${escapeHTML(name)}</b>`;
  }

  function setAvatar(idx) {
    const total = ELEMENTS.length * EXPRESSIONS.length;
    avatarIdx = ((idx % total) + total) % total;
    const preview = $('avatar-preview');
    if (preview) {
      renderAvatarTo(preview, [Math.floor(avatarIdx / EXPRESSIONS.length), avatarIdx % EXPRESSIONS.length], 'lobby-big', 120);
      preview.animate(
        [
          { transform: 'scale(0.8) scaleX(1.1) rotate(-8deg)' }, 
          { transform: 'scale(1.05) scaleX(0.95) rotate(3deg)' },
          { transform: 'scale(1) scaleX(1) rotate(0)' }
        ],
        { duration: 350, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
      );
    }
  }
  function pickAvatar(dir) { setAvatar(avatarIdx + dir); }

  function avatarPayload() {
    return [Math.floor(avatarIdx / EXPRESSIONS.length), avatarIdx % EXPRESSIONS.length, 0, -1];
  }

  // ============================ SOCKET ============================
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 5;

  function connectAndJoin(opts) {
    const playerName = ($('login-name').value || '').trim() || 'Player';
    if (socket) { try { socket.disconnect(); } catch (_) { /* noop */ } socket = null; }
    reconnectAttempts = 0;
    socket = io(window.ENV.API || undefined, {
      path: '/api/socket.io/',
      transports: ['websocket', 'polling'],
      auth: { name: playerName },   // No JWT — just send name for premium check
      reconnection: true,
      reconnectionAttempts: MAX_RECONNECT,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 8000,
    });
    socket.on('connect', () => {
      reconnectAttempts = 0;
      socket.emit('login', {
        join: opts.join || 0,
        create: opts.create ? 1 : 0,
        name: playerName,
        lang: String(opts.lang ?? $('login-language').value ?? '0'),
        mode: document.querySelector('input[name="login-mode"]:checked')?.value || 'all',
        code: '',
        avatar: avatarPayload(),
      });
    });
    socket.on('connect_error', (err) => { toast('Connection error: ' + err.message, 'error'); });
    socket.on('reconnect_attempt', (n) => { toast(`Reconnecting… (${n}/${MAX_RECONNECT})`, 'error'); });
    socket.on('reconnect_failed', () => { toast('Could not reconnect. Returning to home.', 'error'); show('home'); });
    socket.on('joinerr', (code) => {
      const map = { 1: 'Room not found', 2: 'Room is full', 3: 'Cooldown', 4: 'You are banned', 5: 'Joining too fast', 6: 'Name already taken!', 100: 'Already connected', 200: 'Too many users from your IP', 300: 'Kicked too many times' };
      toast(map[code] || 'Failed to join', 'error');
    });
    socket.on('reason', (code) => { toast(code === 1 ? 'You were kicked' : 'You were banned', 'error'); });
    socket.on('data', handlePacket);
    socket.on('disconnect', (reason) => {
      // [FIX H2] Only show disconnect toast / go home if not auto-reconnecting
      if (reason === 'io server disconnect' || reason === 'io client disconnect') {
        toast('Disconnected', 'error');
        show('home');
      }
    });
  }

  function send(id, data) {
    if (!socket || !socket.connected) return;
    socket.emit('data', { id, data });
  }

  // ============================ PACKET HANDLERS ============================
  function handlePacket(packet) {
    const { id, data } = packet;
    switch (id) {
      case 1: onPlayerJoined(data); break;
      case 2: onPlayerLeft(data); break;
      case 5: onVotekickUpdate(data); break;
      case 8: onRatingBroadcast(data); break;
      case 9: onAvatarSync(data); break;
      case 90: onNameSync(data); break;
      case 10: onLobbyInit(data); break;
      case 11: onStateTransition(data); break;
      case 12: onSettingsUpdate(data); break;
      case 13: onHintsUpdate(data); break;
      case 14: onTimerTick(data); break;
      case 15: onCorrectGuess(data); break;
      case 16: onCloseGuess(data); break;
      case 17: onOwnerChange(data); break;
      case 19: onDrawCommands(data); break;
      case 20: onClearCanvas(); break;
      case 21: onUndo(data); break;
      case 30: onChat(data); break;
      case 33: onEmoji(data); break;
      case 31: onWarning(data); break;
      case 32: onSpamWarning(data); break;
      case 100: onKickReason(data); break;
      default: break;
    }
  }

  function onLobbyInit(data) {
    room = data;
    me = data.me;
    players = data.users.slice();
    currentState = data.state.id;
    show('game');
    updatePlayersList();
    $('chat-content').innerHTML = ''; // Fix: Clear previous chat when rejoining
    
    // Load existing canvas state if joining mid-round
    if (data.drawCommands && Array.isArray(data.drawCommands)) {
      drawCommands.length = 0;
      data.drawCommands.forEach(c => {
        drawCommands.push(c);
      });
      redrawAll();
    }
    
    applyState(data.state);
    addChatSystem('Joined room ' + data.id);
    playSound('join');
    if (data.type === 1) {
      const link = window.location.origin + '/?room=' + data.id;
      if ($('invite-link-input')) {
        $('invite-link-input').value = link;
      }
      showRoomSettings(data.settings, data.owner === me);
    }
    const myPlayer = players.find(p => p.id === me);
    if (myPlayer && Array.isArray(myPlayer.avatar)) {
      avatarIdx = (myPlayer.avatar[0] != null ? myPlayer.avatar[0] : 0) % HEAD_COLORS.length;
      updateAvatarPreview();
      window.isPremium = true; // All users get premium features for free
      buildPalette(); // Always builds with premium colors + all tools
    }
    updateLobbyAvatarUI();
  }
  function onPlayerJoined(p) {
    players.push(p);
    updatePlayersList();
    addChatSystem(p.name + ' joined', 'join');
    playSound('join');
  }
  function onPlayerLeft(d) {
    // Don't show a toast for ourselves — we handle our own leave via the leave button / disconnect handler
    if (d.id === me) return;
    const idx = players.findIndex((p) => p.id === d.id);
    if (idx >= 0) {
      const p = players.splice(idx, 1)[0];
      
      let reasonMsg = 'left the game';
      let msgType = 'info';
      if (d.reason === 1) {
        reasonMsg = 'was kicked';
        msgType = 'error';
      } else if (d.reason === 2) {
        reasonMsg = 'was banned';
        msgType = 'error';
      }
      
      addChatSystem(`${p.name} ${reasonMsg}`, 'leave');
      toast(`${p.name} ${reasonMsg}`, msgType);
      
      updatePlayersList();
      playSound('leave');
    }
  }
  function onAvatarSync(d) {
    const p = players.find((x) => x.id === d.id);
    if (p) {
      p.avatar = d.avatar;
      updatePlayersList();
    }
  }
  function onNameSync(d) {
    const p = players.find((x) => x.id === d.id);
    if (p) {
      const oldName = p.name;
      p.name = d.name;
      addChatSystem(`${oldName} changed name to ${d.name}`);
      updatePlayersList();
    }
  }
  function onOwnerChange(newOwnerId) {
    players.forEach((p) => { if (p.flags) p.flags &= ~4; });
    const o = players.find((p) => p.id === newOwnerId);
    if (o) o.flags = (o.flags || 0) | 4;
    if (room) room.owner = newOwnerId;
    updatePlayersList();
  }
  function onStateTransition(s) {
    currentState = s.id;
    applyState(s);
  }
  function onSettingsUpdate(d) {
    if (!room) return;
    room.settings[d.id] = d.val;
    const sel = document.querySelector(`select[data-setting="${d.id}"]`);
    if (sel) sel.value = String(d.val);
  }
  function onTimerTick(t) {
    $('game-clock').querySelector('.text').textContent = t;
    if (t === 10 && room && room.type === 1) {
      playSound('tick');
    }
    
    // Clue mode for drawer in last 10 seconds
    if (t <= 10 && currentDrawerId === me && drawingEnabled) {
      const chatInp = $('chat-input');
      const chatBtn = document.querySelector('.chat-send');
      const chatForm = $('chat-form');
      if (chatInp && chatBtn && chatForm && chatInp.disabled) {
        chatInp.disabled = false;
        chatInp.placeholder = "Enter a clue...";
        chatBtn.innerHTML = '💡';
        chatForm.classList.add('clue-mode');
        
        // Add a transition effect class
        chatInp.classList.add('clue-transition');
        setTimeout(() => chatInp.classList.remove('clue-transition'), 1000);
      }
    }
  }
  function onHintsUpdate(arr) {
    arr.forEach(([idx, ch]) => { wordHints[idx] = ch; });
    renderHintWord();
  }
  function onCorrectGuess(d) {
    const p = players.find((x) => x.id === d.id);
    addChat({ author: p?.name || '?', msg: 'guessed the word!', kind: 'guess-correct', system: true });
    if (p) { p.guessed = true; updatePlayersList(); }
    playSound('roundEndSuccess');
  }
  function onCloseGuess(name) {
    // [FIX L4] This is already sent only to the guesser by the server (id:16).
    // Display privately in chat — do NOT show the full word hint text to others.
    addChatSystem('Close! Keep guessing…', 'guess-close');
  }
  function onDrawCommands(cmds) {
    if (!Array.isArray(cmds)) return;
    cmds.forEach((c) => { drawCommands.push(c); renderCommand(c); });
  }
  function onClearCanvas() {
    drawCommands.length = 0;
    clearCanvasLocal();
    undoneCommands.length = 0;
    if (typeof strokeSizes !== 'undefined') strokeSizes.length = 0;
    updateRedoButtonState();
  }
  function onUndo(newLen) {
    drawCommands.length = Math.max(0, Math.min(newLen, drawCommands.length));
    redrawAll();
    updateRedoButtonState();
  }
  function onChat(d) {
    if (d.id === 0) {
      addChatSystem(d.msg, 'guess-close');
      return;
    }
    if (mutedPlayerIds.has(d.id)) return;
    const p = players.find((x) => x.id === d.id);
    addChat({ author: p?.name || '?', msg: d.msg });
    showPlayerBubble(d.id, d.msg);
  }
  function showPlayerBubble(playerId, text) {
    const p = players.find(x => x.id === playerId);
    if (!p) return;
    
    const card = document.querySelector(`.player-card[data-player-id="${playerId}"]`);
    if (card) {
      if (p.bubbleNode) p.bubbleNode.remove();
      
      const bubble = el('div', 'player-speech-bubble', text);
      document.body.appendChild(bubble);
      p.bubbleNode = bubble;
      
      const rect = card.getBoundingClientRect();
      bubble.style.position = 'fixed';
      bubble.style.top = (rect.top + rect.height / 2) + 'px';
      bubble.style.left = rect.right + 'px';
      
      if (p.bubbleTimeout) clearTimeout(p.bubbleTimeout);
      p.bubbleTimeout = setTimeout(() => {
        if (bubble.parentNode) bubble.remove();
        p.bubbleNode = null;
      }, 3000);
    }
  }
  function onWarning(d) {
    const map = { 0: 'Need at least 2 players to start' };
    toast(map[d.id] || 'Warning', 'error');
  }
  function onVotekickUpdate(arr) {
    if (!Array.isArray(arr)) return;
    const [voterId, targetId, count, required] = arr;
    const voter = players.find((p) => p.id === voterId);
    const target = players.find((p) => p.id === targetId);
    if (!voter || !target) return;
    addChatSystem(`${voter.name} votekicked ${target.name} (${count}/${required})`, 'guess-close');
  }
  function onRatingBroadcast(d) {
    if (!d) return;
    // Aggregate ratings shown on the rate-count badge
    rateScores.set(d.id, d.vote);
    refreshRateCount();
  }
  function onSpamWarning() {
    toast('You are typing too fast, slow down', 'error');
  }
  function onKickReason(code) {
    if (code === 1) toast('You were kicked from the room', 'error');
    if (code === 2) toast('You were banned from the room', 'error');
  }

  // ============================ STATE APPLICATION ============================
  function applyState(s) {
    if (s.id !== STATE.Z) {
      players.forEach((p) => delete p.delta);
    }
    undoneCommands.length = 0;
    updateRedoButtonState();
    const overlay = $('canvas-overlay');
    const overlayContent = $('canvas-overlay-content');
    overlay.classList.remove('active');
    overlayContent.classList.remove('active');
    [...overlayContent.children].forEach((c) => c.classList.remove('active'));
    currentDrawerId = null;
    drawingEnabled = false;
    if ($('game-toolbar')) $('game-toolbar').style.display = 'none';
    if ($('game-wrapper')) $('game-wrapper').classList.remove('is-drawing');
    // Hide rate bar by default (re-enabled inside STATE.j only)
    const rb = $('rate-bar');
    if (rb) rb.classList.remove('show');

    if (s.id === STATE.G) {
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      $('overlay-text').classList.add('active');
      $('overlay-text').textContent = 'Waiting for more players… (need ≥ 2)';
      $('game-round').querySelector('.text').textContent = 'Lobby';
      $('game-word').querySelector('.word').textContent = '—';
    } else if (s.id === STATE.J) {
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      $('overlay-room').classList.add('active');
      if ($('display-room-code') && room && room.id) {
        $('display-room-code').textContent = room.id;
      }
      $('game-round').querySelector('.text').textContent = 'Private Room';
      showRoomSettings(room.settings, room.owner === me);
    } else if (s.id === STATE.K) {
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      $('overlay-text').classList.add('active');
      $('overlay-text').textContent = 'Game starting in a few seconds…';
      playSound('roundStart');
    } else if (s.id === STATE.F) {
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      $('overlay-text').classList.add('active');
      $('overlay-text').textContent = 'Round ' + ((s.data ?? 0) + 1);
      $('game-round').querySelector('.text').textContent = 'Round ' + ((s.data ?? 0) + 1);
      players.forEach((p) => {
        p.guessed = false;
        p.drawn = false;
      });
      updatePlayersList();
      clearCanvasLocal();
      drawCommands.length = 0;
      if (typeof strokeSizes !== 'undefined') strokeSizes.length = 0;
      undoneCommands.length = 0;
    } else if (s.id === STATE.V) {
      myEmojiCount = 0;
      players.forEach((p) => (p.guessed = false));
      updatePlayersList();
      clearCanvasLocal();
      drawCommands.length = 0;
      if (typeof strokeSizes !== 'undefined') strokeSizes.length = 0;
      undoneCommands.length = 0;
      currentDrawerId = s.data?.id;
      const isDrawer = currentDrawerId === me;
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      if ($('timer-bar')) $('timer-bar').classList.add('active');
      const isCombination = room && room.settings[6] === 2;
      const choiceText = $('overlay-text');
      const wordsWrap = $('overlay-words');
      if (choiceText) choiceText.classList.add('active');
      if (wordsWrap) wordsWrap.classList.add('active');
      const timerFill = $('timer-fill');
      
      const dripColors = ['#EF9F27', '#1D9E75', '#D4537E', '#7F77DD'];
      function spawnDrip(x, y) {
        const dot = document.createElement('div');
        dot.className = 'drip-dot';
        const size = 4 + Math.random() * 5;
        dot.style.width = size + 'px';
        dot.style.height = size + 'px';
        dot.style.background = dripColors[Math.floor(Math.random() * dripColors.length)];
        dot.style.left = (x + (Math.random() * 16 - 8)) + 'px';
        dot.style.top = (y + (Math.random() * 6)) + 'px';
        dot.style.animation = 'dripFall 0.6s ease-out forwards';
        document.body.appendChild(dot);
        setTimeout(() => dot.remove(), 650);
      }

      let elapsed = 0;
      let timer = null;
      const PICK_SECONDS = s.time || 15;
      function startTimer(autoPick) {
        clearInterval(timer);
        if (timerFill) {
          timerFill.style.width = '100%';
          timerFill.style.background = 'linear-gradient(90deg, #1D9E75, #5DCAA5)';
        }
        wordsWrap.classList.remove('urgent-pulse');
        timer = setInterval(() => {
          elapsed += 100;
          const remaining = PICK_SECONDS - elapsed / 1000;
          const pct = Math.min(100, (elapsed / (PICK_SECONDS * 1000)) * 100);
          if (timerFill) {
            timerFill.style.width = (100 - pct) + '%';
            if (remaining <= 6 && remaining > 3) timerFill.style.background = '#D85A30';
            else if (remaining <= 3 && remaining > 0) { timerFill.style.background = '#E24B4A'; wordsWrap.classList.add('urgent-pulse'); }
          }
          if (pct >= 100) {
            clearInterval(timer);
            wordsWrap.classList.remove('urgent-pulse');
          }
        }, 100);
      }

      if (isDrawer && s.data?.words) {
        if (wordsWrap) wordsWrap.innerHTML = '';
        if (isCombination) {
          choiceText.textContent = 'Choose the first word';
          const half = s.data.words.length / 2;
          const firstHalf = s.data.words.slice(0, half);
          const secondHalf = s.data.words.slice(half);
          let firstChoiceIdx = null;
          firstHalf.forEach((w, i) => {
            const btn = el('button', 'word-card', w);
            btn.dataset.testid = 'word-choice-' + i;
            let dripInterval = null;
            btn.addEventListener('mouseenter', (e) => { dripInterval = setInterval(() => spawnDrip(e.clientX, e.clientY + 18), 180); });
            btn.addEventListener('mouseleave', () => { clearInterval(dripInterval); });
            btn.addEventListener('click', () => {
              firstChoiceIdx = i;
              choiceText.textContent = 'Choose the second word';
              wordsWrap.innerHTML = '';
              secondHalf.forEach((w2, j) => {
                const btn2 = el('button', 'word-card', w2);
                btn2.dataset.testid = 'word-choice-second-' + j;
                let dripInterval2 = null;
                btn2.addEventListener('mouseenter', (e) => { dripInterval2 = setInterval(() => spawnDrip(e.clientX, e.clientY + 18), 180); });
                btn2.addEventListener('mouseleave', () => { clearInterval(dripInterval2); });
                btn2.addEventListener('click', () => {
                  btn2.classList.add('selected');
                  clearInterval(timer);
                  wordsWrap.classList.remove('urgent-pulse');
                  send(18, [firstChoiceIdx, j]);
                  setTimeout(() => { wordsWrap.innerHTML = ''; }, 300);
                });
                wordsWrap.appendChild(btn2);
                setTimeout(() => btn2.classList.add('pop-in'), j * 100);
              });
            });
            wordsWrap.appendChild(btn);
            setTimeout(() => btn.classList.add('pop-in'), i * 100);
          });
          startTimer(true);
        } else {
          choiceText.textContent = 'Choose a word to draw';
          s.data.words.forEach((w, i) => {
            const c = el('button', 'word-card', w);
            c.dataset.testid = 'word-choice-' + i;
            let dripInterval = null;
            c.addEventListener('mouseenter', (e) => { dripInterval = setInterval(() => spawnDrip(e.clientX, e.clientY + 18), 180); });
            c.addEventListener('mouseleave', () => { clearInterval(dripInterval); });
            c.addEventListener('click', () => {
              c.classList.add('selected');
              clearInterval(timer);
              wordsWrap.classList.remove('urgent-pulse');
              send(18, i);
              setTimeout(() => { wordsWrap.innerHTML = ''; choiceText.textContent = w + ' selected'; }, 300);
            });
            wordsWrap.appendChild(c);
            setTimeout(() => c.classList.add('pop-in'), i * 100);
          });
          startTimer(true);
        }
      } else {
        const drawer = players.find((p) => p.id === currentDrawerId);
        choiceText.innerHTML = (drawer?.name || 'Someone') + ' is choosing a word<span class="wait-dots"><span>.</span><span>.</span><span>.</span></span>';
        if (wordsWrap) wordsWrap.innerHTML = '';
        startTimer(false);
      }
      $('game-word').querySelector('.word').textContent = '—';
      updatePlayersList();
    } else if (s.id === STATE.j) {
      currentDrawerId = s.data?.id;
      const isDrawer = currentDrawerId === me;
      drawingEnabled = isDrawer;
      updateCanvasCursor();
      if ($('game-toolbar')) $('game-toolbar').style.display = isDrawer ? 'flex' : 'none';
      if ($('game-wrapper')) $('game-wrapper').classList.toggle('is-drawing', isDrawer);
      // Reset rating state for new drawing
      rateScores = new Map();
      myRate = null;
      refreshRateCount();
      // Show rate-bar only for non-drawers
      const rb = $('rate-bar');
      if (rb) rb.classList.toggle('show', !isDrawer);
      document.querySelectorAll('.rate-btn').forEach((b) => b.classList.remove('voted'));
      if (isDrawer) {
        currentWord = String(s.data?.word || '').toLowerCase();
        $('game-word').querySelector('.description').textContent = 'DRAW THIS';
        $('game-word').querySelector('.word').textContent = currentWord;
        wordHints = currentWord.split('').map((c) => (c === ' ' ? ' ' : null));
        
        // Disable chat for drawer at start of round
        const chatInp = $('chat-input');
        const chatBtn = document.querySelector('.chat-send');
        const chatForm = $('chat-form');
        if (chatInp && chatBtn && chatForm) {
          chatInp.disabled = true;
          chatInp.placeholder = "You are drawing!";
          chatBtn.innerHTML = '↵';
          chatForm.classList.remove('clue-mode');
        }
      } else {
        const chatInp = $('chat-input');
        const chatBtn = document.querySelector('.chat-send');
        const chatForm = $('chat-form');
        if (chatInp && chatBtn && chatForm) {
          chatInp.disabled = false;
          chatInp.placeholder = "Type your guess here…";
          chatBtn.innerHTML = '↵';
          chatForm.classList.remove('clue-mode');
        }
        
        currentWord = null;
        const w = s.data?.word;
        const isHidden = room && room.settings[6] === 1;
        if (isHidden) {
          wordHints = [null, null, null];
          $('game-word').querySelector('.description').textContent = 'WORD HIDDEN';
        } else {
          const lengths = Array.isArray(w) ? w : [w];
          wordHints = [];
          lengths.forEach((len, idx) => {
            if (idx > 0) wordHints.push(' ');
            for (let i = 0; i < len; i++) wordHints.push(null);
          });
          $('game-word').querySelector('.description').textContent = 'GUESS THE WORD';
        }
        renderHintWord();
      }
      // [FIX L3] Show the full draw time on the clock immediately when drawing starts
      $('game-clock').querySelector('.text').textContent = String(room?.settings?.[2] ?? '--');
      if (Array.isArray(s.data?.drawCommands)) {
        s.data.drawCommands.forEach((c) => { drawCommands.push(c); renderCommand(c); });
      }
      updatePlayersList();
    } else if (s.id === STATE.Z) {
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      $('overlay-reveal').classList.add('active');
      $('reveal-word').textContent = s.data?.word || '???';
      const reasonMap = { 0: 'Everyone guessed!', 1: 'Time is up!', 2: 'Drawer left', 5: 'Drawer skipped' };
      $('reveal-reason').textContent = reasonMap[s.data?.reason] || '';
      const drawer = players.find((p) => p.id === currentDrawerId);
      if (drawer) drawer.drawn = true;
      const sc = s.data?.scores || [];
      let anyoneGuessed = false;
      for (let i = 0; i < sc.length; i += 4) {
        const pid = sc[i], score = sc[i + 1], delta = sc[i + 2];
        const p = players.find((x) => x.id === pid);
        if (p) { 
          p.score = score; p.delta = delta; 
          if (delta > 0 && p.id !== currentDrawerId) {
            anyoneGuessed = true;
          }
        }
      }

      if (!anyoneGuessed && (s.data?.reason === 1 || s.data?.reason === 5 || s.data?.reason === 2)) {
        playSound('faah.mp3');
      }

      // Populate dynamic turn score changes inside the canvas overlay
      const revealScores = $('reveal-scores');
      if (revealScores) {
        revealScores.innerHTML = '';
        const sortedScores = [];
        for (let i = 0; i < sc.length; i += 4) {
          const pid = sc[i], score = sc[i + 1], delta = sc[i + 2], guessTime = sc[i + 3];
          const p = players.find((x) => x.id === pid);
          if (p) {
            sortedScores.push({ player: p, score, delta, guessTime });
          }
        }
        
        // Sort by delta desc so scorers show first, followed by score desc
        sortedScores.sort((a, b) => b.delta - a.delta || b.score - a.score);
        
        function animateCount(el, val) {
          let c = 0; const step = Math.max(1, Math.floor(val / 15));
          const t = setInterval(() => { c += step; if(c >= val){ c = val; clearInterval(t); } el.textContent = '+' + c; }, 30);
        }
        function burstSplatter(avEl) {
          const c = ['#EF9F27', '#1D9E75', '#D4537E'];
          for(let i=0; i<4; i++){
            const p = document.createElement('div');
            p.className = 'splatter-piece';
            p.style.width = (4+Math.random()*6)+'px'; p.style.height = p.style.width;
            p.style.background = c[Math.floor(Math.random()*c.length)];
            p.style.borderRadius = '50%';
            p.style.left = '16px'; p.style.top = '16px';
            const ang = Math.random()*Math.PI*2; const dist = 20+Math.random()*20;
            p.style.transform = `translate(${Math.cos(ang)*dist}px, ${Math.sin(ang)*dist}px)`;
            p.style.transition = 'all 0.4s ease-out';
            avEl.appendChild(p);
            setTimeout(()=>p.style.opacity='0', 300);
            setTimeout(()=>p.remove(), 400);
          }
        }

        sortedScores.forEach(({ player, score, delta, guessTime }, idx) => {
          const row = document.createElement('div');
          row.className = 'score-row';
          if (delta > 0) row.classList.add('has-points');
          
          const av = document.createElement('div');
          av.className = 'avatar';
          renderAvatarTo(av, player.avatar, 'rnd-'+player.id, 32);
          
          const nw = document.createElement('div');
          nw.className = 'name-wrap';
          nw.innerHTML = `<div class="name">${escapeHTML(player.name)}<span class="streak-badge"></span></div><div class="sub-label">Total: ${score}</div>`;
          
          const ptsWrap = document.createElement('div');
          ptsWrap.style.display = 'flex';
          ptsWrap.style.alignItems = 'center';
          ptsWrap.style.gap = '12px';

          if (guessTime > 0 && player.id !== currentDrawerId) {
            const timeBadge = document.createElement('div');
            timeBadge.style.display = 'flex';
            timeBadge.style.alignItems = 'center';
            timeBadge.style.gap = '4px';
            timeBadge.style.fontSize = '12px';
            timeBadge.style.color = 'rgba(255,255,255,0.5)';
            timeBadge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> ${guessTime}s`;
            ptsWrap.appendChild(timeBadge);
          }

          const pts = document.createElement('div');
          pts.className = 'row-value';
          pts.style.color = delta > 0 ? '#3DDCA0' : 'rgba(255,255,255,0.3)';
          pts.textContent = delta > 0 ? '+0' : '0';
          ptsWrap.appendChild(pts);
          
          row.appendChild(av); row.appendChild(nw); row.appendChild(ptsWrap);
          revealScores.appendChild(row);
          
          setTimeout(() => {
            row.classList.add('pop-in');
            if (delta > 0) {
              setTimeout(() => { animateCount(pts, delta); burstSplatter(av); }, 200);
            }
          }, idx * 120);
        });
      }

      updatePlayersList();
    } else if (s.id === STATE.X) {
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      $('overlay-result').classList.add('active');

      // Clear the header text since the game is over
      $('game-round').querySelector('.text').textContent = 'Game Over';
      $('game-word').querySelector('.word').textContent = '-';
      $('game-word').querySelector('.description').textContent = '';

      // Clear previous podium content and reset rank numbers
      for (let rank = 1; rank <= 3; rank++) {
        const slot = $('podest-slot-' + rank);
        if (slot) {
          slot.innerHTML = `<div class="podest-block"><span class="rank-tag">${rank}</span></div>`;
        }
      }

      const ranks = s.data || [];
      const top = ranks[0];
      try {
        if (top) {
          const wn = players.find((p) => p.id === top[0]);
          $('winner-name').textContent = wn?.name || 'Player';
        } else {
          $('winner-name').textContent = 'Someone';
        }
        
        const list = $('ranks-list'); list.innerHTML = '';
        ranks.forEach((r) => {
          const p = players.find((x) => x.id === r[0]);
          if (!p) return;
          
          const rank = r[1] + 1; // 1-based rank
          
          // Populate dynamic visual podium slot
          if (rank <= 3) {
            const slot = $('podest-slot-' + rank);
            if (slot) {
              const playerDiv = el('div', 'podest-player');
              
              const av = el('div', 'podest-avatar');
              renderAvatarTo(av, p.avatar, 'pod-'+p.id, rank === 1 ? 52 : 40);
              
              const nameDiv = el('div', 'podest-name', p.name);
              const scoreDiv = el('div', 'podest-score', p.score + ' pts');
              
              playerDiv.appendChild(av);
              playerDiv.appendChild(nameDiv);
              playerDiv.appendChild(scoreDiv);
              
              slot.insertBefore(playerDiv, slot.firstChild);
              setTimeout(() => playerDiv.classList.add('pop-in'), rank * 150);
            }
          } else {
            const row = document.createElement('div');
            row.className = 'rank-entry';
            const rnum = document.createElement('div'); rnum.className = 'rank-num'; rnum.textContent = '#' + rank;
            const av = document.createElement('div'); av.className = 'rank-avatar';
            renderAvatarTo(av, p.avatar, 'rnk-'+p.id, 30);
            const rname = document.createElement('div'); rname.className = 'rank-name'; rname.textContent = escapeHTML(p.name);
            const rscore = document.createElement('div'); rscore.className = 'rank-score'; rscore.textContent = p.score + ' pts';
            
            row.appendChild(rnum); row.appendChild(av); row.appendChild(rname); row.appendChild(rscore);
            list.appendChild(row);
            setTimeout(() => row.classList.add('pop-in'), rank * 100);
          }
        });
      } catch (e) {
        console.error('Error rendering podium:', e);
      }
    }
  }

  function renderHintWord() {
    if (!wordHints || !wordHints.length) {
      $('game-word').querySelector('.word').textContent = '—';
      return;
    }
    const isHidden = room && room.settings[6] === 1 && currentDrawerId !== me;
    
    let html = '';
    let currentWordLen = 0;
    
    for (let i = 0; i < wordHints.length; i++) {
      const c = wordHints[i];
      if (c === ' ') {
        if (currentWordLen > 0 && currentDrawerId !== me) {
          html = html.trimEnd() + `<sup style="font-size:0.55em; opacity:0.7; margin-left: 4px; vertical-align: super;">${currentWordLen}</sup>`;
        }
        html += '&nbsp;&nbsp;&nbsp;&nbsp;'; // Clear gap for space
        currentWordLen = 0;
      } else {
        html += (c === null ? (isHidden ? '?' : '_') : c) + ' ';
        currentWordLen++;
      }
    }
    if (currentWordLen > 0 && currentDrawerId !== me) {
      html = html.trimEnd() + `<sup style="font-size:0.55em; opacity:0.7; margin-left: 4px; vertical-align: super;">${currentWordLen}</sup>`;
    }
    
    $('game-word').querySelector('.word').innerHTML = html;
  }

  function showRoomSettings(settings, isOwner) {
    if (!settings) return;
    const grid = $('settings-grid');
    const inputs = $$('#lobby-settings input, #lobby-settings select');
    grid.innerHTML = '';
    const fields = [
      { idx: 0, label: 'Language', opts: languages.map((l) => [l.id, l.name]) },
      { idx: 1, label: 'Players', opts: Array.from({ length: 19 }, (_, i) => [i + 2, String(i + 2)]) },
      { idx: 2, label: 'Drawtime', opts: [15, 20, 30, 40, 50, 60, 80, 100, 120, 150, 180, 240].map((v) => [v, v + 's']) },
      { idx: 3, label: 'Rounds', opts: Array.from({ length: 9 }, (_, i) => [i + 2, String(i + 2)]) },
      { idx: 4, label: 'Word choices', opts: Array.from({ length: 5 }, (_, i) => [i + 1, String(i + 1)]) },
      { idx: 5, label: 'Hints', opts: Array.from({ length: 6 }, (_, i) => [i, String(i)]) },
      { idx: 6, label: 'Word mode', opts: [[0, 'Normal'], [1, 'Hidden'], [2, 'Combination']] },
    ];
    fields.forEach((f) => {
      const lbl = el('label', '', f.label);
      const sel = document.createElement('select');
      sel.dataset.setting = String(f.idx);
      sel.dataset.testid = 'setting-' + f.idx;
      sel.disabled = !isOwner;
      f.opts.forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = String(v); o.textContent = t;
        if (Number(v) === Number(settings[f.idx])) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => send(12, { id: f.idx, val: Number(sel.value) }));
      grid.appendChild(lbl);
      grid.appendChild(sel);
    });
    // Only owner sees Start button enabled and Custom Words
    const startBtn = $('button-start-game');
    const customWordsWrap = $('custom-words-wrap');
    const waitingText = $('waiting-host-text');
    const roomHint = $('room-start-hint');

    if (startBtn) {
      if (isOwner) {
        startBtn.style.display = 'inline-block';
        startBtn.disabled = false;
        if (customWordsWrap) customWordsWrap.style.display = 'block';
        if (waitingText) waitingText.style.display = 'none';
        if (roomHint) roomHint.style.display = 'block';
      } else {
        startBtn.style.display = 'none';
        if (customWordsWrap) customWordsWrap.style.display = 'none';
        if (waitingText) waitingText.style.display = 'block';
        if (roomHint) roomHint.style.display = 'none';
      }
    }
  }

  // ============================ PLAYERS LIST ============================
  // [FIX H7] Debounce DOM rebuild — coalesce rapid consecutive calls (avatar sync,
  // timer ticks, etc.) into a single repaint on the next animation frame.
  let _playersListRaf = null;
  function updatePlayersList() {
    if (_playersListRaf) return; // already queued
    _playersListRaf = requestAnimationFrame(() => {
      _playersListRaf = null;
      _buildPlayersList();
    });
  }
  function _buildPlayersList() {
    const wrap = $('players-list');
    wrap.innerHTML = '';
    const sorted = [...players].sort((a, b) => b.score - a.score);
    sorted.forEach((p, idx) => {
      const card = el('div', 'player-card');
      card.dataset.testid = 'player-' + p.id;
      card.dataset.playerId = String(p.id);
      if (p.id === me) card.classList.add('me');
      if (p.id === currentDrawerId) card.classList.add('drawer');
      if (p.guessed) card.classList.add('guessed');
      const av = document.createElement('div');
      av.className = 'avatar';
      av.style.width = '38px';
      av.style.height = '38px';
      av.style.borderRadius = '50%';
      av.style.flexShrink = '0';
      av.style.overflow = 'hidden';
      renderAvatarTo(av, p.avatar, 'pl-'+p.id, 38);
      const info = el('div', 'player-info');
      const nameRow = el('div', 'player-name');
      nameRow.textContent = p.name;
      if (p.flags & 4) {
        const crown = el('span', 'crown', '♛');
        nameRow.appendChild(crown);
      }
      if (mutedPlayerIds.has(p.id)) {
        const muteIcon = el('span', 'mute-icon', ' 🔇');
        nameRow.appendChild(muteIcon);
      }
      if (p.id === currentDrawerId) {
        const pencilIcon = el('span', 'drawer-icon', ' ✏️');
        nameRow.appendChild(pencilIcon);
      } else if (p.drawn) {
        const drawnIcon = el('span', 'drawn-icon', ' ✅');
        nameRow.appendChild(drawnIcon);
      }
      let scoreText = (p.score || 0) + ' pts';
      if (p.delta && p.delta > 0) {
        scoreText += ` (+${p.delta})`;
      }
      if (p.guessed) {
        scoreText += ' • guessed ✓';
      }
      const sc = el('div', 'player-score', scoreText);
      info.appendChild(nameRow); info.appendChild(sc);
      const rank = el('div', 'player-rank', '#' + (idx + 1));
      card.appendChild(rank); card.appendChild(info); card.appendChild(av);
      // Click → context menu (votekick / kick / ban) for other players
      card.addEventListener('click', (ev) => {
        if (p.id === me) return;
        openPlayerMenu(p.id, ev);
      });
      wrap.appendChild(card);
    });
    $('player-count').textContent = players.length;
  }

  // --- Player context menu ---
  function openPlayerMenu(targetId, ev) {
    const menu = $('player-menu');
    if (!menu) return;
    const isOwner = room && room.owner === me;
    menu.classList.toggle('no-owner', !isOwner);
    menu.dataset.target = String(targetId);
    const muteBtn = menu.querySelector('[data-action="mute"]');
    if (muteBtn) {
      muteBtn.textContent = mutedPlayerIds.has(targetId) ? '🔊 Unmute' : '🔇 Mute';
    }
    // Position next to the clicked card
    const rect = ev.currentTarget.getBoundingClientRect();
    menu.style.left = Math.min(window.innerWidth - 200, rect.right + 6) + 'px';
    menu.style.top = (rect.top) + 'px';
    menu.classList.add('open');
  }
  function closePlayerMenu() {
    $('player-menu')?.classList.remove('open');
  }
  document.addEventListener('click', (ev) => {
    const menu = $('player-menu');
    if (!menu || !menu.classList.contains('open')) return;
    if (menu.contains(ev.target)) return;
    if (ev.target.closest('.player-card')) return;
    closePlayerMenu();
  });
  document.querySelectorAll('#player-menu .player-menu-item').forEach((b) => {
    b.addEventListener('click', () => {
      const targetId = Number($('player-menu').dataset.target);
      const action = b.dataset.action;
      if (!targetId) return;
      if (action === 'votekick') send(5, targetId);
      else if (action === 'kick') send(3, targetId);
      else if (action === 'ban')  send(4, targetId);
      else if (action === 'report') {
        send(6, { id: targetId, reasons: 1 }); // Default to toxic (reasons: 1)
        toast('Player reported', 'success');
      }
      else if (action === 'mute') {
        if (mutedPlayerIds.has(targetId)) {
          mutedPlayerIds.delete(targetId);
          toast('Player unmuted', 'success');
        } else {
          mutedPlayerIds.add(targetId);
          toast('Player muted', 'success');
        }
        send(7, targetId);
        updatePlayersList();
      }
      closePlayerMenu();
    });
  });

  // --- Drawing rating ---
  function refreshRateCount() {
    let up = 0, down = 0;
    for (const v of rateScores.values()) { if (v === 1) up++; else down++; }
    const txt = up + (down ? ' / -' + down : '');
    const node = $('rate-count'); if (node) node.textContent = txt;
  }
  document.querySelectorAll('.rate-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.dataset.vote);
      if (myRate === v) return; // already voted same way
      myRate = v;
      document.querySelectorAll('.rate-btn').forEach((x) => x.classList.toggle('voted', Number(x.dataset.vote) === v));
      send(8, v);
    });
  });

  // ============================ CHAT ============================
  function addChat({ author, msg, kind, system }) {
    const wrap = $('chat-content');
    const extraClasses = (kind ? ' ' + kind : '') + (system ? ' system' : '') + (kind === 'guess-correct' ? ' flash-correct' : '');
    const m = el('div', 'chat-msg' + extraClasses);
    if (system) m.innerHTML = '<i>' + escapeHTML(author) + ' ' + escapeHTML(msg) + '</i>';
    else m.innerHTML = '<span class="author">' + escapeHTML(author) + ':</span>' + escapeHTML(msg);
    wrap.appendChild(m);
    wrap.scrollTop = wrap.scrollHeight;
  }
  function addChatSystem(msg, kind) {
    const wrap = $('chat-content');
    const m = el('div', 'chat-msg system' + (kind ? ' ' + kind : ''));
    m.textContent = msg;
    wrap.appendChild(m);
    wrap.scrollTop = wrap.scrollHeight;
  }

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('chat-input');
    const t = inp.value.trim();
    if (!t) return;
    send(30, t);
    inp.value = '';
  });

  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (myEmojiCount >= 15) return; // limit per turn
      const emojiChar = btn.dataset.emoji;
      if (!emojiChar) return;
      myEmojiCount++;
      send(33, emojiChar);
      spawnFloatingEmoji(emojiChar);
      showPlayerBubble(me, emojiChar);
    });
  });

  function onEmoji(data) {
    if (typeof data === 'string') {
      spawnFloatingEmoji(data);
    } else if (data && data.emoji) {
      spawnFloatingEmoji(data.emoji);
      showPlayerBubble(data.id, data.emoji);
    }
  }

  function spawnFloatingEmoji(emojiChar) {
    const wrap = $('game-canvas');
    if (!wrap) return;
    const elEmoji = el('div', 'floating-emoji', emojiChar);
    // Random position horizontally across the canvas width (20% to 80%)
    const leftPercent = 20 + Math.random() * 60;
    elEmoji.style.left = leftPercent + '%';
    wrap.appendChild(elEmoji);
    setTimeout(() => {
      if (elEmoji.parentNode === wrap) {
        wrap.removeChild(elEmoji);
      }
    }, 2000);
  }


  // ============================ COLOR PALETTE ============================
  function buildPalette() {
    const grid = $('color-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Build STANDARD colors in the top row
    const standardGrid = $('color-grid-standard');
    if (standardGrid) {
      standardGrid.innerHTML = '';
      STANDARD_COLORS.forEach((c, i) => {
        const sw = el('button', 'color-swatch');
        sw.type = 'button';
        sw.style.background = c;
        sw.dataset.color = String(i);
        sw.dataset.testid = 'color-std-' + i;
        sw.addEventListener('click', (ev) => { 
          ev.preventDefault(); 
          setColor(i); 
          document.querySelectorAll('.tb-group').forEach(g => g.classList.remove('show'));
        });
        sw.addEventListener('contextmenu', (ev) => { 
          ev.preventDefault(); 
          setColor(i, true); 
          document.querySelectorAll('.tb-group').forEach(g => g.classList.remove('show'));
        });
        standardGrid.appendChild(sw);
      });
    }

    // Build PREMIUM colors in the bottom row
    PREMIUM_COLORS.forEach((c, i) => {
      const idx = 26 + i; // premium colors start at index 26 in ALL_COLORS
      const sw = el('button', 'color-swatch');
      sw.type = 'button';
      sw.style.background = c;
      sw.dataset.color = String(idx);
      sw.dataset.testid = 'color-' + idx;
      sw.addEventListener('click', (ev) => { 
        ev.preventDefault(); 
        setColor(idx); 
        document.querySelectorAll('.tb-group').forEach(g => g.classList.remove('show'));
      });
      sw.addEventListener('contextmenu', (ev) => { 
        ev.preventDefault(); 
        setColor(idx, true); 
        document.querySelectorAll('.tb-group').forEach(g => g.classList.remove('show'));
      });
      grid.appendChild(sw);
    });
    refreshColorSelection();


    // Show redo and rainbow for premium (always on)
    const redoBtn = $('action-redo');
    if (redoBtn) redoBtn.style.display = 'inline-flex';

    const rainbowBtn = $('tool-rainbow');
    if (rainbowBtn) rainbowBtn.style.display = 'inline-flex';
  }

  function setColor(idx, secondary = false) {
    if (secondary) {
      secondaryColorIndex = idx;
    } else {
      colorIndex = idx;
      // If the rainbow tool is active and the user picks a solid color,
      // automatically switch back to pencil so the chosen color is used immediately.
      if (tool === 'rainbow') {
        tool = 'pencil';
        document.querySelectorAll('#tool-buttons .tool-btn').forEach((x) => x.classList.remove('active'));
        const pencilBtn = document.querySelector('#tool-buttons .tool-btn[data-tool="pencil"]');
        if (pencilBtn) pencilBtn.classList.add('active');
        updateCanvasCursor();
      }
    }
    $('color-primary').style.background = colorFromIdx(colorIndex);
    $('color-secondary').style.background = colorFromIdx(secondaryColorIndex);
    
    // Update premium swatch background color
    const swatch = $('size-swatch');
    if (swatch) swatch.style.background = colorFromIdx(colorIndex);
    
    refreshColorSelection();
  }
  function refreshColorSelection() {
    document.querySelectorAll('.color-swatch').forEach((s) => {
      const colAttr = s.dataset.color;
      s.classList.toggle('selected', colAttr === String(colorIndex) || colAttr === colorIndex);
    });
  }

  // Toggle button removed — premium is always on for everyone
  // Guard in case any legacy reference still exists in DOM
  const premiumSwitch = $('toggle-color-panel');
  if (premiumSwitch) premiumSwitch.addEventListener('click', () => { /* no-op */ });
  function updateCanvasCursor() {
    const cvs = $('game-canvas');
    if (!cvs) return;
    cvs.classList.remove('tool-pencil', 'tool-eraser', 'tool-fill');
    
    if (!drawingEnabled) {
      canvas.style.cursor = 'default';
      return;
    }
    
    canvas.style.cursor = ''; // clear inline style to let CSS classes take over
    if (tool === 'pencil' || tool === 'rainbow') cvs.classList.add('tool-pencil');
    else if (tool === 'eraser') cvs.classList.add('tool-eraser');
    else if (tool === 'bucket') cvs.classList.add('tool-fill');
  }

  // ============================ POPUPS & TOOLS ============================
  // Handle click to show/hide popups
  document.addEventListener('click', (ev) => {
    const isTrigger = ev.target.closest('.tb-trigger');
    const isInsidePopup = ev.target.closest('.tb-popup');

    if (isTrigger) {
      ev.preventDefault();
      const group = isTrigger.closest('.tb-group');
      const wasShowing = group.classList.contains('show');
      
      // Close all other groups
      document.querySelectorAll('.tb-group').forEach(g => g.classList.remove('show'));
      
      // Toggle this group
      if (!wasShowing) {
        group.classList.add('show');
      }
    } else if (!isInsidePopup) {
      // Clicked outside, close all
      document.querySelectorAll('.tb-group').forEach(g => g.classList.remove('show'));
    }
  });

  document.querySelectorAll('#tool-buttons .tool-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#tool-buttons .tool-btn').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.shape-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      tool = b.dataset.tool;
      updateCanvasCursor();
    });
  });
  document.querySelectorAll('#size-picker .size-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#size-picker .size-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      brushSize = Number(b.dataset.size);
      
      const dot = $('current-size-dot');
      if (dot) {
        dot.style.width = brushSize + 'px';
        dot.style.height = brushSize + 'px';
      }
      
      const sizePicker = $('size-picker');
      if (sizePicker) sizePicker.classList.remove('mobile-open');
    });
  });

  // Mobile popups logic
  const colorPreviewBtn = $('color-preview');
  const sizePreviewBtn = $('current-size-preview');
  const cg = $('color-grid');
  const sp = $('size-picker');
  const dotInit = $('current-size-dot');
  
  if (dotInit) {
    dotInit.style.width = '8px';
    dotInit.style.height = '8px';
  }


  // Premium Brush Size Slider Implementation
  const SIZES = [3, 8, 16, 32];
  let sizeIdx = 1;
  function applySizeSlider() {
    brushSize = SIZES[sizeIdx];
    const fill = $('size-fill');
    const dot = $('size-dot');
    const swatch = $('size-swatch');
    if (fill) fill.style.width = (sizeIdx / (SIZES.length - 1)) * 100 + '%';
    if (dot) dot.style.left = (sizeIdx / (SIZES.length - 1)) * 100 + '%';
    if (swatch) {
      const swPx = 14 + sizeIdx * 10;
      swatch.style.width = swPx + 'px';
      swatch.style.height = swPx + 'px';
      swatch.style.background = colorFromIdx(colorIndex);
    }
  }

  document.addEventListener('click', (ev) => {
    if (ev.target && ev.target.id === 'size-minus') {
      ev.preventDefault();
      sizeIdx = Math.max(0, sizeIdx - 1);
      applySizeSlider();
    }
    if (ev.target && ev.target.id === 'size-plus') {
      ev.preventDefault();
      sizeIdx = Math.min(SIZES.length - 1, sizeIdx + 1);
      applySizeSlider();
    }
  });

  // Undo / Redo Actions
  $('action-undo').addEventListener('click', () => {
    if (!drawingEnabled) return;
    if (strokeSizes.length === 0) return;
    const popCount = strokeSizes.pop();
    const poppedStroke = [];
    for (let i = 0; i < popCount; i++) {
      poppedStroke.push(drawCommands.pop());
    }
    undoneCommands.push(poppedStroke);
    send(21, drawCommands.length);
    redrawAll();
    updateRedoButtonState();
  });

  const redoBtn = $('action-redo');
  if (redoBtn) {
    redoBtn.addEventListener('click', () => {
      if (!drawingEnabled) return;
      if (undoneCommands.length === 0) return;
      const strokeToRedo = undoneCommands.pop();
      // strokeToRedo was built by popping from drawCommands (newest first),
      // so index 0 = last cmd, index N-1 = first cmd.
      // Re-push in original order: iterate from end to start.
      const orderedStroke = [];
      for (let i = strokeToRedo.length - 1; i >= 0; i--) {
        drawCommands.push(strokeToRedo[i]);
        orderedStroke.push(strokeToRedo[i]);
      }
      strokeSizes.push(strokeToRedo.length);
      // Send in original order and re-render in original order
      send(19, orderedStroke);
      orderedStroke.forEach(cmd => renderCommand(cmd));
      updateRedoButtonState();
    });
  }

  function updateRedoButtonState() {
    const btn = $('action-redo');
    if (btn) {
      btn.disabled = undoneCommands.length === 0;
    }
  }
  $('action-clear').addEventListener('click', () => {
    if (!drawingEnabled) return;
    drawCommands.length = 0;
    if (typeof strokeSizes !== 'undefined') strokeSizes.length = 0;
    undoneCommands.length = 0;
    send(20, null);
    clearCanvasLocal();
    updateRedoButtonState();
  });

  // ============================ DRAWING ============================
  let drawing = false;
  let strokeStart = null;
  let lastPoint = null;
  let prevPoint = null; // Used for smooth Bézier midpoint interpolation

  const SHAPE_MAP = {
    'line': 2,
    'rect': 3,
    'circle': 4,
    'curve': 5,
    'rrect': 6,
    'parallel': 7,
    'triangle': 8,
    'rtriangle': 9,
    'diamond': 10,
    'pentagon': 11,
    'hexagon': 12,
    'arrow-r': 13,
    'arrow-l': 14,
    'arrow-u': 15,
    'arrow-d': 16,
    'sparkle': 17,
    'star': 18,
    'burst': 19,
    'bubble': 20,
    'bubble2': 21,
    'cloud': 22,
    'heart': 23,
    'lightning': 24
  };

  let currentShapeType = 'line';
  const undoneCommands = [];
  const strokeSizes = [];
  let currentStrokeSize = 0;

  let rainbowHue = 0;
  let pendingDrawCmds = []; // Buffer for socket batching

  // Flush drawing commands to server at regular intervals to prevent socket flooding
  setInterval(() => {
    if (pendingDrawCmds.length > 0) {
      send(19, pendingDrawCmds);
      pendingDrawCmds = [];
    }
  }, 40);

  function randomHexColor() {
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
  }

  function canvasCoord(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (canvas.width / r.width);
    const y = (e.clientY - r.top) * (canvas.height / r.height);
    return { x: Math.round(x), y: Math.round(y) };
  }

  canvas.addEventListener('mousedown', (e) => {
    if (!drawingEnabled) return;
    const p = canvasCoord(e);
    drawing = true;
    strokeStart = p; lastPoint = p; prevPoint = null;
    undoneCommands.length = 0;
    currentStrokeSize = 0;
    updateRedoButtonState();

    if (tool === 'bucket') {
      const cmd = [1, colorIndex, brushSize, p.x, p.y, p.x, p.y];
      drawCommands.push(cmd); renderCommand(cmd); send(19, [cmd]);
      currentStrokeSize++;
      drawing = false;
    } else if (tool === 'pencil' || tool === 'eraser' || tool === 'rainbow') {
      let usedColor = colorIndex;
      if (tool === 'eraser') usedColor = secondaryColorIndex;
      else if (tool === 'rainbow') {
        usedColor = `hsl(${currentHue}, 100%, 50%)`;
        currentHue = (currentHue + 2) % 360;
      }
      // Draw an initial dot so a click with no movement is visible
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = brushSize;
      ctx.strokeStyle = colorFromIdx(usedColor);
      ctx.fillStyle = colorFromIdx(usedColor);
      ctx.beginPath(); ctx.arc(p.x, p.y, brushSize / 2, 0, Math.PI * 2); ctx.fill();
      const cmd = [0, usedColor, brushSize, p.x, p.y, p.x, p.y];
      drawCommands.push(cmd); pendingDrawCmds.push(cmd);
      currentStrokeSize++;
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!drawingEnabled) return;
    const p = canvasCoord(e);
    if (!drawing) return;
    if (tool === 'pencil' || tool === 'eraser' || tool === 'rainbow') {
      // Skip if barely moved (1px threshold — lower than before to capture slow strokes)
      const dx = p.x - lastPoint.x;
      const dy = p.y - lastPoint.y;
      if (dx * dx + dy * dy < 1) return;

      let usedColor = colorIndex;
      if (tool === 'eraser') usedColor = secondaryColorIndex;
      else if (tool === 'rainbow') {
        usedColor = `hsl(${currentHue}, 100%, 50%)`;
        currentHue = (currentHue + 2) % 360;
      }

      // === SMOOTH BEZIER MIDPOINT DRAWING ===
      // Use the midpoint between lastPoint and current point as the Bézier end,
      // and lastPoint as the control point. This produces buttery-smooth curves
      // with zero visible cuts at segment joints (same technique as tldraw/excalidraw).
      const mid = { x: (lastPoint.x + p.x) / 2, y: (lastPoint.y + p.y) / 2 };
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = brushSize;
      ctx.strokeStyle = colorFromIdx(usedColor);
      if (prevPoint) {
        const prevMid = { x: (prevPoint.x + lastPoint.x) / 2, y: (prevPoint.y + lastPoint.y) / 2 };
        ctx.beginPath();
        ctx.moveTo(prevMid.x, prevMid.y);
        ctx.quadraticCurveTo(lastPoint.x, lastPoint.y, mid.x, mid.y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(mid.x, mid.y);
        ctx.stroke();
      }

      // Store segment command for network sync and undo
      const cmd = [0, usedColor, brushSize, lastPoint.x, lastPoint.y, p.x, p.y];
      drawCommands.push(cmd);
      pendingDrawCmds.push(cmd);
      currentStrokeSize++;
      prevPoint = lastPoint;
      lastPoint = p;
    } else if (tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'shape') {
      redrawAll();
      drawShapePreview(strokeStart, p, tool === 'shape' ? currentShapeType : tool, colorIndex, brushSize);
    }
  });

  function endDraw(e) {
    if (!drawingEnabled || !drawing) return;
    const p = e && e.clientX !== undefined ? canvasCoord(e) : lastPoint;
    
    if (tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'shape') {
      const shapeType = tool === 'shape' ? currentShapeType : tool;
      const typeCode = SHAPE_MAP[shapeType] || 2;
      const cmd = [typeCode, colorIndex, brushSize, strokeStart.x, strokeStart.y, p.x, p.y];
      drawCommands.push(cmd); 
      renderCommand(cmd); 
      pendingDrawCmds.push(cmd);
      currentStrokeSize++;
      
      if (pendingDrawCmds.length > 0) {
        send(19, pendingDrawCmds);
        pendingDrawCmds = [];
      }
    } else {
      if (pendingDrawCmds.length > 0) {
        send(19, pendingDrawCmds);
        pendingDrawCmds = [];
      }
    }
    
    if (currentStrokeSize > 0) {
      strokeSizes.push(currentStrokeSize);
      currentStrokeSize = 0;
    }

    drawing = false; strokeStart = null; lastPoint = null; prevPoint = null;
  }

  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseleave', endDraw);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('touchstart', (e) => { if (!drawingEnabled) return; e.preventDefault(); const t = e.touches[0]; canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY })); }, { passive: false });
  canvas.addEventListener('touchmove',  (e) => { if (!drawingEnabled) return; e.preventDefault(); const t = e.touches[0]; canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY })); }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (!drawingEnabled) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: t.clientX, clientY: t.clientY }));
  }, { passive: false });

  function drawShapePath(type, x1, y1, x2, y2) {
    const w = x2 - x1;
    const h = y2 - y1;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;

    ctx.beginPath();
    
    if (type === 2 || type === 'line') {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    } else if (type === 3 || type === 'rect') {
      ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(w), Math.abs(h));
    } else if (type === 4 || type === 'circle') {
      const rx = Math.abs(w) / 2;
      const ry = Math.abs(h) / 2;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    } else if (type === 5 || type === 'curve') {
      ctx.moveTo(x1, y2);
      ctx.quadraticCurveTo(cx, y1, x2, y2);
    } else if (type === 6 || type === 'rrect') {
      const r = Math.min(Math.abs(w), Math.abs(h)) * 0.15;
      ctx.roundRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(w), Math.abs(h), r);
    } else if (type === 7 || type === 'parallel') {
      const offset = w * 0.2;
      ctx.moveTo(x1 + offset, y1);
      ctx.lineTo(x2, y1);
      ctx.lineTo(x2 - offset, y2);
      ctx.lineTo(x1, y2);
      ctx.closePath();
    } else if (type === 8 || type === 'triangle') {
      ctx.moveTo(cx, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x1, y2);
      ctx.closePath();
    } else if (type === 9 || type === 'rtriangle') {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1, y2);
      ctx.lineTo(x2, y2);
      ctx.closePath();
    } else if (type === 10 || type === 'diamond') {
      ctx.moveTo(cx, y1);
      ctx.lineTo(x2, cy);
      ctx.lineTo(cx, y2);
      ctx.lineTo(x1, cy);
      ctx.closePath();
    } else if (type === 11 || type === 'pentagon') {
      ctx.moveTo(cx, y1);
      ctx.lineTo(x1 + w * 0.95, y1 + h * 0.38);
      ctx.lineTo(x1 + w * 0.78, y2);
      ctx.lineTo(x1 + w * 0.22, y2);
      ctx.lineTo(x1 + w * 0.05, y1 + h * 0.38);
      ctx.closePath();
    } else if (type === 12 || type === 'hexagon') {
      ctx.moveTo(x1 + w * 0.25, y1);
      ctx.lineTo(x1 + w * 0.75, y1);
      ctx.lineTo(x2, cy);
      ctx.lineTo(x1 + w * 0.75, y2);
      ctx.lineTo(x1 + w * 0.25, y2);
      ctx.lineTo(x1, cy);
      ctx.closePath();
    } else if (type === 13 || type === 'arrow-r') {
      ctx.moveTo(x1, cy);
      ctx.lineTo(x2, cy);
      ctx.moveTo(x2, cy);
      ctx.lineTo(x2 - w * 0.25, y1);
      ctx.moveTo(x2, cy);
      ctx.lineTo(x2 - w * 0.25, y2);
    } else if (type === 14 || type === 'arrow-l') {
      ctx.moveTo(x2, cy);
      ctx.lineTo(x1, cy);
      ctx.moveTo(x1, cy);
      ctx.lineTo(x1 + w * 0.25, y1);
      ctx.moveTo(x1, cy);
      ctx.lineTo(x1 + w * 0.25, y2);
    } else if (type === 15 || type === 'arrow-u') {
      ctx.moveTo(cx, y2);
      ctx.lineTo(cx, y1);
      ctx.moveTo(cx, y1);
      ctx.lineTo(x1, y1 + h * 0.25);
      ctx.moveTo(cx, y1);
      ctx.lineTo(x2, y1 + h * 0.25);
    } else if (type === 16 || type === 'arrow-d') {
      ctx.moveTo(cx, y1);
      ctx.lineTo(cx, y2);
      ctx.moveTo(cx, y2);
      ctx.lineTo(x1, y2 - h * 0.25);
      ctx.moveTo(cx, y2);
      ctx.lineTo(x2, y2 - h * 0.25);
    } else if (type === 17 || type === 'sparkle') {
      ctx.moveTo(cx, y1);
      ctx.quadraticCurveTo(cx, cy, x2, cy);
      ctx.quadraticCurveTo(cx, cy, cx, y2);
      ctx.quadraticCurveTo(cx, cy, x1, cy);
      ctx.quadraticCurveTo(cx, cy, cx, y1);
    } else if (type === 18 || type === 'star') {
      const R = Math.max(Math.abs(w), Math.abs(h)) / 2;
      const r = R * 0.4;
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const radius = i % 2 === 0 ? R : r;
        const sx = cx + radius * Math.cos(angle);
        const sy = cy + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
    } else if (type === 19 || type === 'burst') {
      const R = Math.max(Math.abs(w), Math.abs(h)) / 2;
      const r = R * 0.65;
      for (let i = 0; i < 16; i++) {
        const angle = (i * Math.PI) / 8;
        const radius = i % 2 === 0 ? R : r;
        const sx = cx + radius * Math.cos(angle);
        const sy = cy + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
    } else if (type === 20 || type === 'bubble') {
      ctx.moveTo(x1 + w * 0.1, y1);
      ctx.lineTo(x1 + w * 0.9, y1);
      ctx.quadraticCurveTo(x2, y1, x2, y1 + h * 0.4);
      ctx.quadraticCurveTo(x2, y1 + h * 0.8, x1 + w * 0.9, y1 + h * 0.8);
      ctx.lineTo(x1 + w * 0.5, y1 + h * 0.8);
      ctx.lineTo(x1 + w * 0.3, y2);
      ctx.lineTo(x1 + w * 0.4, y1 + h * 0.8);
      ctx.lineTo(x1 + w * 0.1, y1 + h * 0.8);
      ctx.quadraticCurveTo(x1, y1 + h * 0.8, x1, y1 + h * 0.4);
      ctx.quadraticCurveTo(x1, y1, x1 + w * 0.1, y1);
    } else if (type === 21 || type === 'bubble2') {
      ctx.ellipse(cx, y1 + h * 0.45, Math.abs(w) * 0.45, Math.abs(h) * 0.35, 0, 0, Math.PI * 2);
      ctx.moveTo(x1 + w * 0.35, y1 + h * 0.8);
      ctx.lineTo(x1 + w * 0.2, y2);
      ctx.lineTo(x1 + w * 0.5, y1 + h * 0.77);
    } else if (type === 22 || type === 'cloud') {
      ctx.arc(cx - w * 0.2, cy, Math.abs(w) * 0.25, Math.PI, Math.PI * 1.8);
      ctx.arc(cx + w * 0.15, cy - h * 0.15, Math.abs(w) * 0.3, Math.PI * 1.3, Math.PI * 2.2);
      ctx.arc(cx + w * 0.25, cy + h * 0.05, Math.abs(w) * 0.2, Math.PI * 1.8, Math.PI * 0.3);
      ctx.lineTo(x1, cy + h * 0.25);
      ctx.closePath();
    } else if (type === 23 || type === 'heart') {
      ctx.moveTo(cx, y1 + h * 0.3);
      ctx.bezierCurveTo(x1, y1, x1, cy, cx, y2);
      ctx.bezierCurveTo(x2, cy, x2, y1, cx, y1 + h * 0.3);
    } else if (type === 24 || type === 'lightning') {
      ctx.moveTo(cx + w * 0.1, y1);
      ctx.lineTo(x1, cy + h * 0.1);
      ctx.lineTo(cx + w * 0.1, cy + h * 0.1);
      ctx.lineTo(cx - w * 0.1, y2);
      ctx.lineTo(x2, cy - h * 0.1);
      ctx.lineTo(cx - w * 0.1, cy - h * 0.1);
      ctx.closePath();
    }
  }

  let lastRenderedCmd = null;

  function renderCommand(c) {
    const [type, colIdx, size, x1, y1, x2, y2] = c;
    const color = colorFromIdx(colIdx);
    ctx.lineWidth = size;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (type === 0) {
      let isContinuous = false;
      let px1, py1, px2, py2;
      if (lastRenderedCmd && lastRenderedCmd[0] === 0) {
        px1 = lastRenderedCmd[3]; py1 = lastRenderedCmd[4]; px2 = lastRenderedCmd[5]; py2 = lastRenderedCmd[6];
        if (x1 === px2 && y1 === py2 && colIdx === lastRenderedCmd[1] && size === lastRenderedCmd[2]) {
          isContinuous = true;
        }
      }

      ctx.beginPath();
      if (isContinuous) {
        const prevMidX = (px1 + px2) / 2;
        const prevMidY = (py1 + py2) / 2;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        ctx.moveTo(prevMidX, prevMidY);
        ctx.quadraticCurveTo(x1, y1, midX, midY);
      } else {
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        ctx.moveTo(x1, y1);
        ctx.lineTo(midX, midY);
      }
      ctx.stroke();

      // Draw a dot for single-point clicks
      if (x1 === x2 && y1 === y2 && !isContinuous) { 
        ctx.beginPath(); ctx.arc(x1, y1, size / 2, 0, Math.PI * 2); ctx.fill(); 
      }
    } else if (type === 1) {
      floodFill(x1, y1, color);
    } else {
      drawShapePath(type, x1, y1, x2, y2);
      ctx.stroke();
    }
    
    lastRenderedCmd = c;
  }

  function drawShapePreview(p1, p2, t, colIdx, size) {
    const color = colorFromIdx(colIdx);
    ctx.lineWidth = size; ctx.strokeStyle = color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    drawShapePath(t, p1.x, p1.y, p2.x, p2.y);
    ctx.stroke();
  }

  function clearCanvasLocal() {
    ctx.save(); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore();
  }
  function redrawAll() {
    clearCanvasLocal();
    lastRenderedCmd = null;
    drawCommands.forEach(renderCommand);
  }

  function floodFill(x, y, color) {
    const w = canvas.width, h = canvas.height;
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    const idx = (x, y) => (y * w + x) * 4;
    const target = idx(x | 0, y | 0);
    const tr = data[target], tg = data[target + 1], tb = data[target + 2];
    const fill = hexToRgb(color);
    if (fill.r === tr && fill.g === tg && fill.b === tb) return;
    const stack = [[x | 0, y | 0]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      const i = idx(cx, cy);
      if (data[i] !== tr || data[i + 1] !== tg || data[i + 2] !== tb) continue;
      data[i] = fill.r; data[i + 1] = fill.g; data[i + 2] = fill.b; data[i + 3] = 255;
      stack.push([cx + 1, cy]); stack.push([cx - 1, cy]); stack.push([cx, cy + 1]); stack.push([cx, cy - 1]);
    }
    ctx.putImageData(img, 0, 0);
  }
  // Resolves ANY CSS color string (hex, hsl, rgb, named) to {r, g, b}
  // by drawing 1px on a tiny offscreen canvas and reading it back.
  const _colorResolveCanvas = document.createElement('canvas');
  _colorResolveCanvas.width = 1;
  _colorResolveCanvas.height = 1;
  const _colorResolveCtx = _colorResolveCanvas.getContext('2d');
  function hexToRgb(h) {
    if (!h) return { r: 0, g: 0, b: 0 };
    _colorResolveCtx.clearRect(0, 0, 1, 1);
    _colorResolveCtx.fillStyle = h;
    _colorResolveCtx.fillRect(0, 0, 1, 1);
    const d = _colorResolveCtx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  }

  // ============================ HOME ACTIONS ============================
  document.querySelectorAll('[data-avatar-dir]').forEach((b) => b.addEventListener('click', () => pickAvatar(Number(b.dataset.avatarDir))));

  // Custom Words Logic
  let customWordsArray = [];
  
  if ($('open-custom-words-modal')) {
    $('open-custom-words-modal').addEventListener('click', () => {
      $('custom-words-modal').style.display = 'flex';
      $('new-custom-word-input').focus();
      renderCustomWords();
    });
  }
  
  if ($('close-custom-words-modal')) {
    $('close-custom-words-modal').addEventListener('click', () => {
      $('custom-words-modal').style.display = 'none';
    });
  }
  
  if ($('add-custom-word-btn')) {
    $('add-custom-word-btn').addEventListener('click', addCustomWord);
  }
  
  if ($('new-custom-word-input')) {
    $('new-custom-word-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addCustomWord();
    });
  }
  
  function addCustomWord() {
    const input = $('new-custom-word-input');
    const word = input.value.trim();
    if (word && !customWordsArray.includes(word)) {
      customWordsArray.push(word);
      input.value = '';
      renderCustomWords();
    }
  }
  
  window.removeCustomWord = function(word) {
    customWordsArray = customWordsArray.filter(w => w !== word);
    renderCustomWords();
  };
  
  function renderCustomWords() {
    const list = $('custom-words-list');
    if (!list) return;
    list.innerHTML = '';
    customWordsArray.forEach(word => {
      const chip = document.createElement('div');
      chip.className = 'custom-word-chip';
      chip.textContent = word;
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '-';
      removeBtn.onclick = () => removeCustomWord(word);
      
      chip.appendChild(removeBtn);
      list.appendChild(chip);
    });
  }

  function withDebounce(btnId, cb) {
    const btn = $(btnId);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      if (btn.disabled) return;
      cb(e);
      btn.disabled = true;
      setTimeout(() => { btn.disabled = false; }, 2000);
    });
  }

  withDebounce('button-login-play', () => {
    const name = $('login-name').value.trim();
    if (!name) { toast('Enter a name first', 'error'); return; }
    connectAndJoin({ create: 0, lang: $('login-language').value });
  });

  withDebounce('button-login-create', () => {
    const name = $('login-name').value.trim();
    if (!name) { toast('Enter a name first', 'error'); return; }
    connectAndJoin({ create: 1, lang: $('login-language').value });
  });

  function extractRoomId(str) {
    if (!str) return '';
    str = str.trim();
    if (str.includes('room=')) {
      try {
        const u = new URL(str.startsWith('http') ? str : 'http://dummy/' + str);
        return u.searchParams.get('room') || '';
      } catch (e) {
        return '';
      }
    }
    return str;
  }

  withDebounce('button-login-join', () => {
    const raw = $('login-room').value;
    const code = extractRoomId(raw);
    if (!code) { toast('Enter an invite code', 'error'); return; }
    const name = $('login-name').value.trim();
    if (!name) { toast('Enter a name first', 'error'); return; }
    connectAndJoin({ join: code });
  });

  // Game bar actions
  $('leave-game-btn').addEventListener('click', () => {
    if (socket) { try { socket.disconnect(); } catch (_) { /* noop */ } socket = null; }
    show('home');
  });
  $('button-start-game').addEventListener('click', () => {
    const co = $('custom-words-only');
    const words = customWordsArray.join(',');
    const useOnly = !!(co && co.checked);
    if (words) {
      send(22, { words, useOnly: useOnly ? 1 : 0 });
    } else {
      send(22, '');
    }
  });
  
  $('button-invite')?.addEventListener('click', () => {
    if (!room) return;
    const link = window.location.origin + '/?room=' + room.id;
    copyToClipboard(link);
  });
  
  $('button-copy-invite')?.addEventListener('click', () => {
    if (!room) return;
    const link = window.location.origin + '/?room=' + room.id;
    copyToClipboard(link);
  });
  
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast('Invite link copied!', 'success'),
        () => toast('Link: ' + text, 'success')
      ).catch(() => toast('Link: ' + text, 'success'));
    } else {
      // Fallback
      const tempInput = document.createElement("input");
      tempInput.style = "position: absolute; left: -1000px; top: -1000px";
      tempInput.value = text;
      document.body.appendChild(tempInput);
      tempInput.select();
      try {
        document.execCommand("copy");
        toast('Invite link copied!', 'success');
      } catch (err) {
        toast('Link: ' + text, 'success');
      }
      document.body.removeChild(tempInput);
    }
  }

  // ============================ SHAPES GRID GENERATION ============================
  const SHAPES = [
    { id:'line',      svg:'<line x1="4" y1="20" x2="20" y2="4"/>' },
    { id:'curve',     svg:'<path d="M4 16 Q9 4 12 12 T20 8"/>' },
    { id:'circle',    svg:'<circle cx="12" cy="12" r="8"/>' },
    { id:'rect',      svg:'<rect x="4" y="6" width="16" height="12"/>' },
    { id:'rrect',     svg:'<rect x="4" y="6" width="16" height="12" rx="4"/>' },
    { id:'parallel',  svg:'<path d="M7 20 L11 4 L21 4 L17 20 Z"/>' },
    { id:'triangle',  svg:'<path d="M12 4 L20 20 L4 20 Z"/>' },
    { id:'rtriangle', svg:'<path d="M5 4 L5 20 L20 20 Z"/>' },
    { id:'diamond',   svg:'<path d="M12 3 L21 12 L12 21 L3 12 Z"/>' },
    { id:'pentagon',  svg:'<path d="M12 3 L21 10 L18 20 L6 20 L3 10 Z"/>' },
    { id:'hexagon',   svg:'<path d="M7 4 L17 4 L21 12 L17 20 L7 20 L3 12 Z"/>' },
    { id:'arrow-r',   svg:'<path d="M4 12 H18 M13 6 L19 12 L13 18"/>' },
    { id:'arrow-l',   svg:'<path d="M20 12 H6 M11 6 L5 12 L11 18"/>' },
    { id:'arrow-u',   svg:'<path d="M12 20 V6 M6 11 L12 5 L18 11"/>' },
    { id:'arrow-d',   svg:'<path d="M12 4 V18 M6 13 L12 19 L18 13"/>' },
    { id:'sparkle',   svg:'<path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"/>' },
    { id:'star',      svg:'<path d="M12 2 L14.6 9 L22 9.5 L16.2 14.2 L18 21.5 L12 17.5 L6 21.5 L7.8 14.2 L2 9.5 L9.4 9 Z"/>' },
    { id:'burst',     svg:'<path d="M12 2 L14 8 L20 6 L16 11 L22 12 L16 13 L20 18 L14 16 L12 22 L10 16 L4 18 L8 13 L2 12 L8 11 L4 6 L10 8 Z"/>' },
    { id:'bubble',    svg:'<path d="M4 5 H20 V16 H10 L6 20 V16 H4 Z"/>' },
    { id:'bubble2',   svg:'<ellipse cx="12" cy="11" rx="9" ry="7"/><path d="M8 17 L5 21 L11 18"/>' },
    { id:'cloud',     svg:'<path d="M7 17a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A4.5 4.5 0 0 1 17 17Z"/>' },
    { id:'heart',     svg:'<path d="M12 20 C4 14 2 9 6 6 C9 4 12 6 12 9 C12 6 15 4 18 6 C22 9 20 14 12 20 Z"/>' },
    { id:'lightning', svg:'<path d="M13 2 L4 14 H11 L9 22 L20 9 H13 Z"/>' }
  ];

  function buildShapesGrid() {
    const grid = $('shape-buttons');
    if (!grid) return;
    grid.innerHTML = '';
    SHAPES.forEach(s => {
      const b = el('button', 'shape-btn');
      b.type = 'button';
      b.dataset.shape = s.id;
      b.title = s.id;
      b.innerHTML = `<svg viewBox="0 0 24 24" style="stroke: currentColor; fill: none; stroke-width: 1.8; width: 60%; height: 60%;">${s.svg}</svg>`;
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        document.querySelectorAll('.shape-btn').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('#tool-buttons .tool-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        tool = 'shape';
        updateCanvasCursor();
        currentShapeType = s.id;
      });
      grid.appendChild(b);
    });
  }

  // ============================ BOOTSTRAP ============================
  document.addEventListener('auth:ready', async () => {
    const loginNameEl = $('login-name');
    if (loginNameEl) {
      const savedName = localStorage.getItem('advscribbl_name');
      if (savedName) loginNameEl.value = savedName;
      loginNameEl.addEventListener('input', updateHomeUI);
    }
    updateHomeUI();
    await loadLanguages();
    buildShapesGrid();
    buildPalette(false);
    setColor(11); setColor(0, true);
    setAvatar(Math.floor(Math.random() * HEAD_COLORS.length));
    const qs = new URLSearchParams(window.location.search);
    const r = extractRoomId(qs.get('room'));
    if (r) {
      connectAndJoin({ join: r });
    }
  });
  document.addEventListener('premium:unlocked', updateHomeUI);
})();
