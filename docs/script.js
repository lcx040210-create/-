// ============================================================
// LI CHENGXI — MULTIVERSE RESUME v2.1
// Portal Hub + Characters + Audio + i18n
// ============================================================

// Global error catcher
window.onerror = function(msg, url, line) {
  var el = document.getElementById('character-bubbles');
  if (el) el.innerHTML = '<div style="position:fixed;top:10px;left:10px;z-index:999;background:red;color:#fff;padding:10px;font-size:12px;max-width:90%;">JS Error: ' + msg + ' (line ' + line + ')</div>';
};

// ========== AUDIO ENGINE ==========
const AudioEngine = {
  ctx: null, enabled: false, melodyTimer: null,

  init() {
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { console.warn('Web Audio not available:', e); }
  },

  async enable() {
    if (!this.ctx) return;
    try { if (this.ctx.state === 'suspended') await this.ctx.resume(); }
    catch(e) { console.warn('Audio resume failed:', e); return; }
    this.enabled = true;
    try { localStorage.setItem('resume-sound', 'on'); } catch(e) {}
    this.playTheme();
  },

  disable() {
    this.enabled = false;
    try { localStorage.setItem('resume-sound', 'off'); } catch(e) {}
    if (this.melodyTimer) { clearInterval(this.melodyTimer); this.melodyTimer = null; }
  },

  play(fn) { if (this.enabled && this.ctx) { try { fn(this.ctx); } catch(e) {} } },

  portalSound(up) {
    this.play(ctx => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      if (up) {
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.3);
      } else {
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.3);
      }
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.35);
    });
  },

  hoverHum() {
    this.play(ctx => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 520;
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.15);
    });
  },

  burp() {
    this.play(ctx => {
      const now = ctx.currentTime;
      const len = ctx.sampleRate * 0.12;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
      const src = ctx.createBufferSource();
      const flt = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      src.buffer = buf;
      flt.type = 'bandpass'; flt.frequency.value = 400; flt.Q.value = 2;
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      src.connect(flt); flt.connect(gain); gain.connect(ctx.destination);
      src.start(now);
    });
  },

  playTheme() {
    if (!this.enabled || !this.ctx) return;
    if (this.melodyTimer) clearInterval(this.melodyTimer);
    const notes = [262,294,330,349,392,349,330,294, 262,330,392,523,392,330,294,262, 294,330,392,349,330,294,262,247, 262,294,330,392,349,330,294,262];
    let i = 0;
    const tick = () => {
      if (!this.enabled || !this.ctx) { clearInterval(this.melodyTimer); return; }
      try {
        const ctx = this.ctx, now = ctx.currentTime;
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'square'; osc.frequency.value = notes[i % notes.length];
        gain.gain.setValueAtTime(0.02, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now); osc.stop(now + 0.2);
        i++;
      } catch(e) {}
    };
    tick();
    this.melodyTimer = setInterval(tick, 220);
  }
};

// ========== I18N ENGINE ==========
const I18nEngine = {
  currentLang: 'en',

  init() {
    try { this.currentLang = localStorage.getItem('resume-lang') || 'en'; } catch(e) {}
    this.applyLang(this.currentLang);
    const btn = document.getElementById('lang-toggle');
    if (btn) btn.addEventListener('click', () => this.toggle());
  },

  toggle() {
    this.currentLang = this.currentLang === 'en' ? 'zh' : 'en';
    try { localStorage.setItem('resume-lang', this.currentLang); } catch(e) {}
    this.applyLang(this.currentLang);
    AudioEngine.play(ctx => {
      try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, now);
        osc.frequency.setValueAtTime(659, now + 0.08);
        osc.frequency.setValueAtTime(784, now + 0.16);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now); osc.stop(now + 0.25);
      } catch(e) {}
    });
  },

  applyLang(lang) {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-en][data-zh]').forEach(el => {
      const val = el.getAttribute('data-' + lang);
      if (!val) return;
      if (el.classList.contains('hero-summary')) el.innerHTML = val;
      else el.textContent = val;
    });
    document.querySelectorAll('[data-' + lang + ']').forEach(el => {
      if (el.tagName !== 'UL') return;
      const data = el.getAttribute('data-' + lang);
      if (!data) return;
      el.innerHTML = data.split('|').map(function(item) {
        return '<li>' + item.trim().replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') + '</li>';
      }).join('');
    });
    document.querySelectorAll('.lang-opt').forEach(function(opt) {
      opt.classList.toggle('active', opt.getAttribute('data-lang') === lang);
    });
  },

  getLang: function() { return this.currentLang; }
};

// ========== STARFIELD CANVAS ==========
const Starfield = {
  canvas: null, ctx: null, stars: [], frameId: null, w: 0, h: 0,

  init: function() {
    this.canvas = document.getElementById('starfield-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) return;
    this.resize();
    window.addEventListener('resize', this.resize.bind(this));
    for (var i = 0; i < 200; i++) {
      this.stars.push({ x: Math.random() * this.w, y: Math.random() * this.h, s: Math.random() * 2 + 0.5, v: Math.random() * 0.3 + 0.05, o: Math.random() * 0.7 + 0.3, t: Math.random() * Math.PI * 2 });
    }
    for (var i = 0; i < 20; i++) {
      this.stars.push({ x: Math.random() * this.w, y: Math.random() * this.h, s: Math.random() * 3 + 1, v: Math.random() * 0.5 + 0.1, o: Math.random() * 0.5 + 0.3, t: Math.random() * Math.PI * 2, g: true });
    }
    this.loop();
  },

  resize: function() {
    this.w = this.canvas.width = window.innerWidth;
    this.h = this.canvas.height = window.innerHeight;
  },

  loop: function() {
    var self = this;
    if (!self.ctx) return;
    self.ctx.clearRect(0, 0, self.w, self.h);
    self.stars.forEach(function(s) {
      s.t += 0.02; s.y -= s.v;
      if (s.y < -5) { s.y = self.h + 5; s.x = Math.random() * self.w; }
      var alpha = s.o + Math.sin(s.t) * 0.2;
      self.ctx.beginPath();
      self.ctx.arc(s.x, s.y, s.s, 0, Math.PI * 2);
      self.ctx.fillStyle = s.g ? 'rgba(151,206,76,' + alpha + ')' : 'rgba(224,240,232,' + alpha + ')';
      self.ctx.fill();
      if (s.g) {
        self.ctx.beginPath();
        self.ctx.arc(s.x, s.y, s.s * 3, 0, Math.PI * 2);
        self.ctx.fillStyle = 'rgba(151,206,76,' + (alpha * 0.1) + ')';
        self.ctx.fill();
      }
    });
    // Draw characters
    Chars.draw(self.ctx);
    self.frameId = requestAnimationFrame(function() { self.loop(); });
  }
};

// ========== CHARACTER SYSTEM ==========
var Chars = {
  rick: { x: -50, y: 0, vx: 0.4, dir: 1, frame: 0, state: 'walk', timer: 0 },
  morty: { x: -80, y: 0, vx: 0.7, dir: 1, frame: 0, state: 'follow', timer: 0 },
  speechId: null,

  init: function() {
    this.rick.y = window.innerHeight - 80;
    this.morty.y = window.innerHeight - 60;
    this.schedule();
    window.addEventListener('resize', this.onResize.bind(this));
  },

  onResize: function() {
    this.rick.y = window.innerHeight - 80;
    this.morty.y = window.innerHeight - 60;
  },

  schedule: function() {
    var self = this;
    clearTimeout(this.speechId);
    this.speechId = setTimeout(function() { self.say(); self.schedule(); }, Math.random() * 20000 + 10000);
  },

  say: function() {
    var lang = I18nEngine.getLang();
    var quotes = lang === 'zh' ?
      ['这份简历是*嗝*多元宇宙里最棒的！', 'Wubba lubba dub dub！', 'Morty！别碰那个传送门！', '我得喝一杯再继续看...'] :
      ['This resume is *burp* the best in the multiverse!', 'Wubba lubba dub dub!', 'Morty! Don\'t touch that portal!', 'I need a drink before reading more...'];
    var text = quotes[Math.floor(Math.random() * quotes.length)];
    var bubble = document.createElement('div');
    bubble.className = 'rick-speech';
    bubble.textContent = text;
    bubble.style.left = Math.max(10, this.rick.x - 80) + 'px';
    bubble.style.bottom = (window.innerHeight - this.rick.y + 50) + 'px';
    var container = document.getElementById('character-bubbles');
    if (container) container.appendChild(bubble);
    setTimeout(function() { if (bubble.parentNode) bubble.remove(); }, 5200);
    if (Math.random() < 0.4) AudioEngine.burp();
  },

  update: function() {
    var w = window.innerWidth;
    var r = this.rick, m = this.morty;
    r.timer++;
    if (r.timer > 300) { r.timer = 0; var states = ['walk','walk','walk','pause','turn']; r.state = states[Math.floor(Math.random() * states.length)]; }
    if (r.state === 'walk') { r.x += r.vx * r.dir; r.frame += 0.05; if (r.x > w + 10) r.dir = -1; if (r.x < -10) r.dir = 1; }
    else if (r.state === 'pause') { r.frame = 0; }
    else if (r.state === 'turn') { r.dir *= -1; r.state = 'walk'; }
    m.dir = r.dir;
    m.x += (r.x - 50 * r.dir - m.x) * 0.05;
    m.frame = r.frame;
    m.state = r.state === 'pause' ? 'nervous' : 'follow';
  },

  draw: function(ctx) {
    this.update();
    var r = this.rick, m = this.morty;
    this.sprite(ctx, r.x, r.y, 'rick', r.frame, r.dir);
    this.sprite(ctx, m.x, m.y, 'morty', m.frame, m.dir);
  },

  sprite: function(ctx, x, y, type, frame, dir) {
    ctx.save();
    var fx = dir < 0 ? x + 24 : x;
    if (dir < 0) { ctx.translate(fx, y); ctx.scale(-1, 1); x = 0; y = 0; }
    else ctx.translate(x, y);
    var bob = Math.sin(frame * Math.PI) * 2;
    if (type === 'rick') {
      ctx.fillStyle = '#5bc0eb'; ctx.fillRect(6, -10, 12, 8); ctx.fillRect(4, -12, 4, 12); ctx.fillRect(16, -12, 4, 12);
      ctx.fillStyle = '#f5d6c3'; ctx.fillRect(6, -2, 12, 10);
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(4, 8, 16, 16);
      ctx.fillStyle = '#555'; ctx.fillRect(4, 22, 16, 2);
      ctx.fillStyle = '#8B7355'; ctx.fillRect(4, 24, 7, 12 + bob); ctx.fillRect(13, 24, 7, 12 - bob);
      ctx.fillStyle = '#888'; ctx.fillRect(18, 10, 6, 3);
      ctx.fillStyle = '#97ce4c'; ctx.fillRect(22, 9, 4, 5);
    } else {
      ctx.fillStyle = '#8B4513'; ctx.fillRect(8, -2, 8, 9);
      ctx.fillStyle = '#f5e642'; ctx.fillRect(5, 7, 14, 12);
      ctx.fillStyle = '#4169E1'; ctx.fillRect(5, 19, 6, 10 + bob); ctx.fillRect(13, 19, 6, 10 - bob);
      if (this.morty.state === 'nervous') { var shake = Math.sin(Date.now() * 0.05) * 2; ctx.translate(shake, 0); }
    }
    ctx.fillStyle = '#333'; ctx.fillRect(6, 29 + Math.max(bob, 0), 4, 6); ctx.fillRect(14, 29 + Math.max(-bob, 0), 4, 6);
    ctx.restore();
  }
};

// ========== CONTENT MANAGER ==========
var ContentMgr = {
  current: null, busy: false,

  init: function() {
    this.placePortals();
    window.addEventListener('resize', this.placePortals.bind(this));
    var self = this;
    document.querySelectorAll('.portal').forEach(function(p) {
      p.addEventListener('click', function(e) { e.stopPropagation(); if (!self.busy) self.open(p.getAttribute('data-section')); });
      p.addEventListener('mouseenter', function() { AudioEngine.hoverHum(); });
    });
    document.querySelectorAll('.back-btn').forEach(function(b) {
      b.addEventListener('click', function(e) { e.stopPropagation(); self.close(); });
    });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && self.current) self.close(); });
  },

  placePortals: function() {
    var cx = window.innerWidth / 2;
    var cy = window.innerHeight / 2;
    var r = window.innerWidth < 768 ? 160 : 260;
    document.querySelectorAll('.portal').forEach(function(p, i) {
      var rad = (i * 60 * Math.PI) / 180;
      p.style.left = (cx + r * Math.cos(rad)) + 'px';
      p.style.top = (cy + r * Math.sin(rad)) + 'px';
    });
  },

  open: function(id) {
    var self = this;
    this.busy = true;
    AudioEngine.portalSound(true);
    var overlay = document.getElementById('portal-overlay');
    overlay.classList.add('active');
    setTimeout(function() {
      var hub = document.getElementById('portal-hub');
      if (hub) hub.style.display = 'none';
      document.querySelectorAll('.overlay-panel').forEach(function(p) { p.classList.remove('active', 'closing'); });
      var panel = document.getElementById('overlay-' + id);
      if (panel) { panel.classList.add('active'); panel.querySelector('.overlay-scroll').scrollTop = 0; self.current = id; }
      setTimeout(function() { overlay.classList.remove('active'); self.busy = false; }, 200);
    }, 350);
  },

  close: function() {
    var self = this;
    if (!this.current) return;
    this.busy = true;
    AudioEngine.portalSound(false);
    var overlay = document.getElementById('portal-overlay');
    overlay.classList.add('active');
    var panel = document.getElementById('overlay-' + this.current);
    if (panel) { panel.classList.remove('active'); panel.classList.add('closing'); setTimeout(function() { panel.classList.remove('closing'); }, 400); }
    setTimeout(function() {
      var hub = document.getElementById('portal-hub');
      if (hub) hub.style.display = '';
      self.current = null;
      setTimeout(function() { overlay.classList.remove('active'); self.busy = false; }, 200);
    }, 350);
  }
};

// ========== SOUND TOGGLE ==========
function initSound() {
  var btn = document.getElementById('sound-toggle');
  if (!btn) return;
  var wasOn = false;
  try { wasOn = localStorage.getItem('resume-sound') === 'on'; } catch(e) {}
  var update = function() {
    var on = AudioEngine.enabled;
    btn.textContent = on ? '🔊 Sound On' : '🔇 Sound Off';
    if (on) btn.classList.add('on'); else btn.classList.remove('on');
  };
  AudioEngine.init();
  update();
  if (wasOn) { AudioEngine.enable().then(update).catch(function(){}); }
  btn.addEventListener('click', function() {
    if (AudioEngine.enabled) { AudioEngine.disable(); update(); }
    else { AudioEngine.enable().then(update).catch(function(){}); }
  });
}

// ========== BOOT ==========
document.addEventListener('DOMContentLoaded', function() {
  try { Starfield.init(); console.log('1/5 Starfield OK'); }
  catch(e) { console.error('Starfield FAIL:', e); window.onerror('Starfield: '+e.message, '', 0); }

  try { Chars.init(); console.log('2/5 Chars OK'); }
  catch(e) { console.error('Chars FAIL:', e); window.onerror('Chars: '+e.message, '', 0); }

  try { I18nEngine.init(); console.log('3/5 I18n OK'); }
  catch(e) { console.error('I18n FAIL:', e); window.onerror('I18n: '+e.message, '', 0); }

  try { ContentMgr.init(); console.log('4/5 ContentMgr OK'); }
  catch(e) { console.error('ContentMgr FAIL:', e); window.onerror('ContentMgr: '+e.message, '', 0); }

  try { initSound(); console.log('5/5 Sound OK'); }
  catch(e) { console.error('Sound FAIL:', e); window.onerror('Sound: '+e.message, '', 0); }

  setTimeout(function() { ContentMgr.placePortals(); }, 600);
  console.log('All modules initialized');
});
