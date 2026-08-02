// ============================================================
// LI CHENGXI — MULTIVERSE RESUME v2.5
// Portal Hub + Character Click + Audio + i18n + Interactive Cards
// ============================================================

// Global error catcher
window.onerror = function(msg, url, line) {
  var el = document.getElementById('character-bubbles');
  if (el) el.innerHTML = '<div style="position:fixed;top:10px;left:10px;z-index:999;background:#ff2d95;color:#fff;padding:10px;font-size:12px;max-width:90%;border-radius:8px;">JS Error: ' + msg + ' (line ' + line + ')</div>';
};

// ========== AUDIO ENGINE ==========
var AudioEngine = {
  ctx: null, enabled: false, melodyTimer: null,

  init: function() {
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { console.warn('Web Audio not available:', e); }
  },

  enable: function() {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!self.ctx) { resolve(); return; }
      try {
        if (self.ctx.state === 'suspended') {
          self.ctx.resume().then(function() {
            self.enabled = true;
            try { localStorage.setItem('resume-sound', 'on'); } catch(e) {}
            self.playTheme();
            resolve();
          }).catch(function(e) {
            console.warn('Audio resume failed:', e);
            resolve();
          });
        } else {
          self.enabled = true;
          try { localStorage.setItem('resume-sound', 'on'); } catch(e) {}
          self.playTheme();
          resolve();
        }
      } catch(e) { console.warn('Enable failed:', e); resolve(); }
    });
  },

  disable: function() {
    this.enabled = false;
    try { localStorage.setItem('resume-sound', 'off'); } catch(e) {}
    if (this.melodyTimer) { clearInterval(this.melodyTimer); this.melodyTimer = null; }
  },

  play: function(fn) { if (this.enabled && this.ctx) { try { fn(this.ctx); } catch(e) {} } },

  portalSound: function(up) {
    this.play(function(ctx) {
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sawtooth';
      if (up) {
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(1400, now + 0.3);
      } else {
        osc.frequency.setValueAtTime(1400, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.3);
      }
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.35);
    });
  },

  hoverHum: function(freq) {
    var f = freq || 520;
    this.play(function(ctx) {
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = f;
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.15);
    });
  },

  burp: function() {
    this.play(function(ctx) {
      var now = ctx.currentTime;
      var len = Math.floor(ctx.sampleRate * 0.15);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.018));
      var src = ctx.createBufferSource();
      var flt = ctx.createBiquadFilter();
      var gain = ctx.createGain();
      src.buffer = buf;
      flt.type = 'bandpass'; flt.frequency.value = 400; flt.Q.value = 2.5;
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      src.connect(flt); flt.connect(gain); gain.connect(ctx.destination);
      src.start(now);
    });
  },

  squeak: function() {
    this.play(function(ctx) {
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.12);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.15);
    });
  },

  playTheme: function() {
    if (!this.enabled || !this.ctx) return;
    if (this.melodyTimer) clearInterval(this.melodyTimer);
    var notes = [262,294,330,349,392,349,330,294, 262,330,392,523,392,330,294,262, 294,330,392,349,330,294,262,247, 262,294,330,392,349,330,294,262];
    var i = 0;
    var self = this;
    var tick = function() {
      if (!self.enabled || !self.ctx) { clearInterval(self.melodyTimer); return; }
      try {
        var ctx = self.ctx, now = ctx.currentTime;
        var osc = ctx.createOscillator(), gain = ctx.createGain();
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
var I18nEngine = {
  currentLang: 'en',

  init: function() {
    var self = this;
    try { this.currentLang = localStorage.getItem('resume-lang') || 'en'; } catch(e) {}
    this.applyLang(this.currentLang);
    var btn = document.getElementById('lang-toggle');
    if (btn) btn.addEventListener('click', function() { self.toggle(); });
  },

  toggle: function() {
    this.currentLang = this.currentLang === 'en' ? 'zh' : 'en';
    try { localStorage.setItem('resume-lang', this.currentLang); } catch(e) {}
    this.applyLang(this.currentLang);
    AudioEngine.play(function(ctx) {
      try {
        var now = ctx.currentTime;
        var osc = ctx.createOscillator(), gain = ctx.createGain();
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

  applyLang: function(lang) {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-en][data-zh]').forEach(function(el) {
      var val = el.getAttribute('data-' + lang);
      if (!val) return;
      if (el.classList.contains('hero-summary')) el.innerHTML = val;
      else el.textContent = val;
    });
    document.querySelectorAll('[data-' + lang + ']').forEach(function(el) {
      if (el.tagName !== 'UL') return;
      var data = el.getAttribute('data-' + lang);
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
var Starfield = {
  canvas: null, ctx: null, stars: [], frameId: null, w: 0, h: 0,

  init: function() {
    var self = this;
    this.canvas = document.getElementById('starfield-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) return;
    this.resize();
    window.addEventListener('resize', function() { self.resize(); });
    for (var i = 0; i < 200; i++) {
      this.stars.push({ x: Math.random() * this.w, y: Math.random() * this.h, s: Math.random() * 2 + 0.5, v: Math.random() * 0.3 + 0.05, o: Math.random() * 0.7 + 0.3, t: Math.random() * Math.PI * 2 });
    }
    for (var i = 0; i < 30; i++) {
      this.stars.push({ x: Math.random() * this.w, y: Math.random() * this.h, s: Math.random() * 3 + 1, v: Math.random() * 0.5 + 0.1, o: Math.random() * 0.5 + 0.3, t: Math.random() * Math.PI * 2, g: true, c: i % 6 });
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

    // Draw colorful nebula blobs
    var time = Date.now() * 0.0001;
    self.ctx.save();
    self.ctx.globalAlpha = 0.03;
    var nebulaColors = ['#39FF14','#00F0FF','#FF2D95','#FFE600','#B44CFF','#FF6B4A'];
    for (var n = 0; n < 3; n++) {
      var nx = self.w * (0.2 + n * 0.3);
      var ny = self.h * (0.3 + Math.sin(time + n) * 0.2);
      var grd = self.ctx.createRadialGradient(nx, ny, 0, nx, ny, self.w * 0.35);
      grd.addColorStop(0, nebulaColors[n * 2]);
      grd.addColorStop(0.5, nebulaColors[n * 2 + 1]);
      grd.addColorStop(1, 'transparent');
      self.ctx.fillStyle = grd;
      self.ctx.fillRect(0, 0, self.w, self.h);
    }
    self.ctx.restore();

    // Stars
    self.stars.forEach(function(s) {
      s.t += 0.02; s.y -= s.v;
      if (s.y < -5) { s.y = self.h + 5; s.x = Math.random() * self.w; }
      var alpha = s.o + Math.sin(s.t) * 0.2;
      self.ctx.beginPath();
      self.ctx.arc(s.x, s.y, s.s, 0, Math.PI * 2);
      if (s.g) {
        var colors = ['#39FF14','#00F0FF','#FF2D95','#FFE600','#B44CFF','#FF6B4A'];
        self.ctx.fillStyle = colors[s.c || 0].replace(')', ',' + alpha + ')').replace('rgb', 'rgba');
        self.ctx.fill();
        self.ctx.beginPath();
        self.ctx.arc(s.x, s.y, s.s * 3.5, 0, Math.PI * 2);
        self.ctx.fillStyle = colors[s.c || 0].replace(')', ',' + (alpha * 0.12) + ')').replace('rgb', 'rgba');
        self.ctx.fill();
      } else {
        self.ctx.fillStyle = 'rgba(240,244,248,' + alpha + ')';
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
  rick: { x: -50, y: 0, vx: 0.4, dir: 1, frame: 0, state: 'walk', timer: 0, reaction: null, reactTimer: 0 },
  morty: { x: -80, y: 0, vx: 0.7, dir: 1, frame: 0, state: 'follow', timer: 0, reaction: null, reactTimer: 0 },
  speechId: null,

  // Hit test for click
  hitTest: function(cx, cy) {
    var r = this.rick, m = this.morty;
    var rhw = 14, rhh = 25; // rick half-width, half-height
    var mhw = 12, mhh = 22;
    // Check Rick
    if (cx >= r.x - rhw && cx <= r.x + rhw && cy >= r.y - rhh && cy <= r.y + 10) return 'rick';
    // Check Morty
    if (cx >= m.x - mhw && cx <= m.x + mhw && cy >= m.y - mhh && cy <= m.y + 8) return 'morty';
    return null;
  },

  // React to click
  react: function(who) {
    var self = this;
    if (who === 'rick') {
      this.rick.reaction = 'rage';
      this.rick.reactTimer = 30;
      AudioEngine.burp();
      self.say('rick', true);
      // Spawn emoji pop
      this.emojiPop(this.rick.x, this.rick.y - 40, ['🤬','🍺','*burp*','👨‍🔬'][Math.floor(Math.random() * 4)]);
    } else if (who === 'morty') {
      this.morty.reaction = 'jump';
      this.morty.reactTimer = 25;
      AudioEngine.squeak();
      self.say('morty', true);
      this.emojiPop(this.morty.x, this.morty.y - 30, ['😱','💦','Ah jeez!','😰'][Math.floor(Math.random() * 4)]);
    }
  },

  emojiPop: function(x, y, text) {
    var el = document.createElement('div');
    el.className = 'char-emoji-pop';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    var container = document.getElementById('character-bubbles');
    if (container) container.appendChild(el);
    setTimeout(function() { if (el.parentNode) el.remove(); }, 1100);
  },

  init: function() {
    var self = this;
    this.rick.y = window.innerHeight - 80;
    this.morty.y = window.innerHeight - 60;
    this.schedule();
    window.addEventListener('resize', function() { self.onResize(); });

    // Show click hint after 3s
    setTimeout(function() {
      var hint = document.getElementById('char-hint');
      if (hint) hint.classList.add('show');
    }, 3000);
    // Hide hint after first click
    document.getElementById('starfield-canvas').addEventListener('click', function(e) {
      var rect = e.target.getBoundingClientRect();
      var cx = e.clientX - rect.left;
      var cy = e.clientY - rect.top;
      var hit = self.hitTest(cx, cy);
      if (hit) {
        self.react(hit);
        var hint = document.getElementById('char-hint');
        if (hint) hint.classList.remove('show');
      }
    });
  },

  onResize: function() {
    this.rick.y = window.innerHeight - 80;
    this.morty.y = window.innerHeight - 60;
  },

  schedule: function() {
    var self = this;
    clearTimeout(this.speechId);
    this.speechId = setTimeout(function() { self.say('auto'); self.schedule(); }, Math.random() * 20000 + 10000);
  },

  say: function(who, isReaction) {
    var lang = I18nEngine.getLang();
    var quotes;
    if (who === 'rick' || (who === 'auto' && Math.random() < 0.6)) {
      quotes = lang === 'zh' ?
        ['这份简历是*嗝*多元宇宙里最棒的！', 'Wubba lubba dub dub！', 'Morty！别碰那个传送门！', '我得喝一杯再继续看...', '*嗝* 我可是全宇宙最聪明的人！'] :
        ['This resume is *burp* the best in the multiverse!', 'Wubba lubba dub dub!', 'Morty! Don\'t touch that portal!', 'I need a drink before reading more...', '*burp* I\'m the smartest man in the universe!'];
    } else {
      quotes = lang === 'zh' ?
        ['啊天哪，Rick 又在乱搞了...', '这传送门看着好危险...', '我我我觉得这简历挺好的！', '别点我！啊好痒！'] :
        ['Oh jeez, Rick is messing around again...', 'That portal looks dangerous...', 'I-I think this resume is great!', 'Don\'t click me! That tickles!'];
    }

    var text = quotes[Math.floor(Math.random() * quotes.length)];
    var bubble = document.createElement('div');
    bubble.className = 'rick-speech';
    bubble.textContent = text;
    if (who === 'rick' || who === 'auto') {
      bubble.style.left = Math.max(10, this.rick.x - 80) + 'px';
      bubble.style.bottom = (window.innerHeight - this.rick.y + 50) + 'px';
      if (isReaction) { bubble.style.borderColor = '#FF2D95'; bubble.style.boxShadow = '0 0 25px rgba(255,45,149,0.6)'; }
    } else {
      bubble.style.left = Math.max(10, this.morty.x - 70) + 'px';
      bubble.style.bottom = (window.innerHeight - this.morty.y + 35) + 'px';
      if (isReaction) { bubble.style.borderColor = '#FFE600'; bubble.style.boxShadow = '0 0 25px rgba(255,230,0,0.6)'; }
    }
    var container = document.getElementById('character-bubbles');
    if (container) container.appendChild(bubble);
    var dur = isReaction ? 3000 : 5200;
    setTimeout(function() { if (bubble.parentNode) bubble.remove(); }, dur);
    if (Math.random() < 0.35 && who !== 'morty') AudioEngine.burp();
  },

  update: function() {
    var w = window.innerWidth;
    var r = this.rick, m = this.morty;

    // Handle reaction timer
    if (r.reactTimer > 0) { r.reactTimer--; if (r.reactTimer === 0) r.reaction = null; }
    if (m.reactTimer > 0) { m.reactTimer--; if (m.reactTimer === 0) m.reaction = null; }

    r.timer++;
    if (r.reaction === 'rage') {
      // Shake in place
      r.x += (Math.random() - 0.5) * 6;
      r.frame += 0.15;
    } else if (r.timer > 300) {
      r.timer = 0;
      var states = ['walk','walk','walk','pause','turn'];
      r.state = states[Math.floor(Math.random() * states.length)];
    }
    if (r.state === 'walk') { r.x += r.vx * r.dir; r.frame += 0.05; if (r.x > w + 10) r.dir = -1; if (r.x < -10) r.dir = 1; }
    else if (r.state === 'pause') { r.frame = 0; }
    else if (r.state === 'turn') { r.dir *= -1; r.state = 'walk'; }

    if (m.reaction === 'jump') {
      m.y += Math.sin(m.reactTimer * 0.6) * 5;
      m.frame += 0.12;
    } else {
      m.dir = r.dir;
      m.x += (r.x - 50 * r.dir - m.x) * 0.05;
      m.frame = r.frame;
      m.state = r.state === 'pause' ? 'nervous' : 'follow';
    }
  },

  draw: function(ctx) {
    this.update();
    var r = this.rick, m = this.morty;

    // Rick glow when reacting
    if (r.reaction === 'rage') {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#FF2D95';
      ctx.beginPath();
      ctx.arc(r.x + 12, r.y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    this.sprite(ctx, r.x, r.y, 'rick', r.frame, r.dir, r.reaction === 'rage');

    // Morty glow when reacting
    if (m.reaction === 'jump') {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#FFE600';
      ctx.beginPath();
      ctx.arc(m.x + 12, m.y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    this.sprite(ctx, m.x, m.y, 'morty', m.frame, m.dir, m.reaction === 'jump');
  },

  sprite: function(ctx, x, y, type, frame, dir, reacting) {
    ctx.save();
    var fx = dir < 0 ? x + 24 : x;
    if (dir < 0) { ctx.translate(fx, y); ctx.scale(-1, 1); x = 0; y = 0; }
    else ctx.translate(x, y);
    var bob = Math.sin(frame * Math.PI) * 2;

    if (type === 'rick') {
      // Hair
      ctx.fillStyle = '#5bc0eb'; ctx.fillRect(6, -10, 12, 8); ctx.fillRect(4, -12, 4, 12); ctx.fillRect(16, -12, 4, 12);
      // Face
      ctx.fillStyle = '#f5d6c3'; ctx.fillRect(6, -2, 12, 10);
      // Eyebrow (angry when reacting)
      if (reacting) {
        ctx.fillStyle = '#333'; ctx.fillRect(7, -1, 10, 3);
        // Mouth open
        ctx.fillStyle = '#000'; ctx.fillRect(8, 5, 8, 4);
      }
      // Lab coat
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(4, 8, 16, 16);
      // Belt
      ctx.fillStyle = '#555'; ctx.fillRect(4, 22, 16, 2);
      // Pants
      ctx.fillStyle = '#8B7355'; ctx.fillRect(4, 24, 7, 12 + bob); ctx.fillRect(13, 24, 7, 12 - bob);
      // Portal gun
      ctx.fillStyle = '#888'; ctx.fillRect(18, 10, 6, 3);
      ctx.fillStyle = '#39FF14'; ctx.fillRect(22, 9, 4, 5);
      // Shoes
      ctx.fillStyle = '#333'; ctx.fillRect(4, 36 + Math.max(bob, 0), 7, 5); ctx.fillRect(13, 36 + Math.max(-bob, 0), 7, 5);
    } else {
      // Hair
      ctx.fillStyle = '#8B4513'; ctx.fillRect(8, -2, 8, 9);
      // Face
      if (reacting) {
        // Sweating
        ctx.fillStyle = '#87CEEB'; ctx.fillRect(2, -2, 3, 4);
        ctx.fillStyle = '#f5d6c3'; ctx.fillRect(8, -2, 8, 9);
        // Wide eyes
        ctx.fillStyle = '#fff'; ctx.fillRect(9, 0, 2, 3); ctx.fillRect(13, 0, 2, 3);
        ctx.fillStyle = '#000'; ctx.fillRect(10, 1, 1, 1); ctx.fillRect(14, 1, 1, 1);
      }
      // Yellow shirt
      ctx.fillStyle = '#f5e642'; ctx.fillRect(5, 7, 14, 12);
      // Blue pants
      ctx.fillStyle = '#4169E1'; ctx.fillRect(5, 19, 6, 10 + bob); ctx.fillRect(13, 19, 6, 10 - bob);
      if (this.morty.state === 'nervous' || reacting) { var shake = Math.sin(Date.now() * 0.05) * 2; ctx.translate(shake, 0); }
    }
    ctx.restore();
  }
};

// ========== CONTENT MANAGER ==========
var ContentMgr = {
  current: null, busy: false, safetyTimer: null,

  resetBusy: function() {
    this.busy = false;
    this.safetyTimer = null;
  },

  init: function() {
    this.placePortals();
    var self = this;
    window.addEventListener('resize', function() { self.placePortals(); });

    // Portal click + hover
    document.querySelectorAll('.portal').forEach(function(p) {
      p.addEventListener('click', function(e) { e.stopPropagation(); if (!self.busy) self.open(p.getAttribute('data-section')); });
      p.addEventListener('mouseenter', function() {
        var colorIdx = parseInt(p.getAttribute('data-color')) || 0;
        var freqs = [520, 600, 420, 700, 550, 480];
        AudioEngine.hoverHum(freqs[colorIdx] || 520);
      });
      p.addEventListener('touchend', function(e) { e.preventDefault(); e.stopPropagation(); if (!self.busy) self.open(p.getAttribute('data-section')); });
    });

    // Back button
    document.querySelectorAll('.back-btn').forEach(function(b) {
      b.addEventListener('click', function(e) { e.stopPropagation(); self.close(); });
      b.addEventListener('touchend', function(e) { e.preventDefault(); e.stopPropagation(); self.close(); });
    });

    // Escape key
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && self.current) self.close(); });

    // === CLICK-TO-REVEAL: Click card to toggle details (accordion: only one open per section) ===
    document.querySelectorAll('.overlay-panel .console-card, .overlay-panel .skill-panel').forEach(function(card) {
      card.addEventListener('click', function(e) {
        // Don't toggle if clicking a link, button, or nested interactive
        if (e.target.closest('a, button, .back-btn')) return;
        // If clicking .card-toggle, let its own handler manage it
        if (e.target.closest('.card-toggle')) return;
        e.stopPropagation();

        var isExpanded = card.classList.contains('expanded');
        // Find the parent overlay panel
        var panel = card.closest('.overlay-panel');
        // Close ALL cards in this panel first
        if (panel) {
          panel.querySelectorAll('.console-card.expanded, .skill-panel.expanded').forEach(function(c) {
            c.classList.remove('expanded');
          });
        }
        // If this card wasn't expanded, expand it now
        if (!isExpanded) {
          card.classList.add('expanded');
        }
        AudioEngine.hoverHum(660);
      });
    });

    // Keep card-toggle clicks working (they also toggle the card)
    document.querySelectorAll('.card-toggle').forEach(function(toggle) {
      toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        var card = toggle.closest('.console-card') || toggle.closest('.skill-panel');
        if (card) card.classList.toggle('expanded');
      });
    });

    // Tag click — highlight
    document.querySelectorAll('.tag-cloud span').forEach(function(tag) {
      tag.addEventListener('click', function(e) {
        e.stopPropagation();
        var was = tag.style.background;
        tag.style.background = 'rgba(57,255,20,0.15)';
        tag.style.color = 'var(--c0)';
        setTimeout(function() { tag.style.background = ''; tag.style.color = ''; }, 500);
      });
    });
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
    if (this.busy) return;
    this.busy = true;
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
    this.safetyTimer = setTimeout(function() { self.resetBusy(); }, 2000);
    try { AudioEngine.portalSound(true); } catch(e) {}
    var overlay = document.getElementById('portal-overlay');
    if (!overlay) { this.resetBusy(); return; }
    overlay.classList.add('active');
    setTimeout(function() {
      try {
        var hub = document.getElementById('portal-hub');
        if (hub) hub.style.display = 'none';
        document.querySelectorAll('.overlay-panel').forEach(function(p) { p.classList.remove('active', 'closing'); });
        var panel = document.getElementById('overlay-' + id);
        if (panel) { panel.classList.add('active'); var scroll = panel.querySelector('.overlay-scroll'); if (scroll) scroll.scrollTop = 0; self.current = id; }
        // Reset all cards to collapsed
        document.querySelectorAll('.overlay-panel .console-card.expanded, .overlay-panel .skill-panel.expanded').forEach(function(c) { c.classList.remove('expanded'); });
        setTimeout(function() {
          try { overlay.classList.remove('active'); } catch(e) {}
          self.resetBusy();
        }, 200);
      } catch(e) {
        self.resetBusy();
      }
    }, 350);
  },

  close: function() {
    var self = this;
    if (!this.current || this.busy) return;
    this.busy = true;
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
    this.safetyTimer = setTimeout(function() { self.resetBusy(); }, 2000);
    try { AudioEngine.portalSound(false); } catch(e) {}
    var overlay = document.getElementById('portal-overlay');
    if (!overlay) { this.resetBusy(); return; }
    overlay.classList.add('active');
    var panel = document.getElementById('overlay-' + this.current);
    if (panel) { panel.classList.remove('active'); panel.classList.add('closing'); setTimeout(function() { try { panel.classList.remove('closing'); } catch(e) {} }, 400); }
    setTimeout(function() {
      try {
        var hub = document.getElementById('portal-hub');
        if (hub) hub.style.display = '';
        self.current = null;
        setTimeout(function() {
          try { overlay.classList.remove('active'); } catch(e) {}
          self.resetBusy();
        }, 200);
      } catch(e) {
        self.resetBusy();
      }
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
  catch(e) { console.error('Starfield FAIL:', e); }

  try { Chars.init(); console.log('2/5 Chars OK'); }
  catch(e) { console.error('Chars FAIL:', e); }

  try { I18nEngine.init(); console.log('3/5 I18n OK'); }
  catch(e) { console.error('I18n FAIL:', e); }

  try { ContentMgr.init(); console.log('4/5 ContentMgr OK'); }
  catch(e) { console.error('ContentMgr FAIL:', e); }

  try { initSound(); console.log('5/5 Sound OK'); }
  catch(e) { console.error('Sound FAIL:', e); }

  setTimeout(function() { ContentMgr.placePortals(); }, 600);
  console.log('v2.5 — Neon Multiverse ready');
});
