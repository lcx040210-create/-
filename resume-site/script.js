// ============================================================
// LI CHENGXI — MULTIVERSE RESUME v2
// Portal Hub + Characters + Audio + i18n
// ============================================================

// ========== AUDIO ENGINE ==========
const AudioEngine = {
  ctx: null, enabled: false, melodyTimer: null,

  init() {
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { console.warn('Web Audio not available'); }
  },

  async enable() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.enabled = true;
    localStorage.setItem('resume-sound', 'on');
    this.playTheme();
  },

  disable() {
    this.enabled = false;
    localStorage.setItem('resume-sound', 'off');
    if (this.melodyTimer) { clearInterval(this.melodyTimer); this.melodyTimer = null; }
  },

  play(fn) { if (this.enabled && this.ctx) fn(this.ctx); },

  // Portal whoosh — rising
  portalOpen() {
    this.play(ctx => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.3);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.35);
    });
  },

  // Portal whoosh — falling (return)
  portalClose() {
    this.play(ctx => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.3);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.35);
    });
  },

  // Hover hum
  hoverHum() {
    this.play(ctx => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.2);
    });
  },

  // Rick burp
  burp() {
    this.play(ctx => {
      const now = ctx.currentTime;
      const bufferSize = ctx.sampleRate * 0.15;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.02));
      }
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      source.buffer = buffer;
      filter.type = 'bandpass';
      filter.frequency.value = 400;
      filter.Q.value = 2;
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      source.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      source.start(now);
    });
  },

  // 8-bit style simple melody loop
  playTheme() {
    if (!this.enabled || !this.ctx) return;
    if (this.melodyTimer) clearInterval(this.melodyTimer);

    const notes = [
      262, 294, 330, 349, 392, 349, 330, 294,
      262, 330, 392, 523, 392, 330, 294, 262,
      294, 330, 392, 349, 330, 294, 262, 247,
      262, 294, 330, 392, 349, 330, 294, 262
    ];
    let i = 0;
    const playNote = () => {
      if (!this.enabled) { clearInterval(this.melodyTimer); return; }
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = notes[i % notes.length];
      gain.gain.setValueAtTime(0.025, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.2);
      i++;
    };
    playNote();
    this.melodyTimer = setInterval(playNote, 220);
  }
};

// ========== I18N ENGINE ==========
const I18nEngine = {
  currentLang: (() => { try { return localStorage.getItem('resume-lang') || 'en'; } catch(e) { return 'en'; } })(),

  init() {
    this.applyLang(this.currentLang);
    const btn = document.getElementById('lang-toggle');
    if (btn) btn.addEventListener('click', () => this.toggle());
  },

  toggle() {
    this.currentLang = this.currentLang === 'en' ? 'zh' : 'en';
    try { localStorage.setItem('resume-lang', this.currentLang); } catch(e) {}
    this.applyLang(this.currentLang);
    AudioEngine.play(ctx => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523, now);
      osc.frequency.setValueAtTime(659, now + 0.08);
      osc.frequency.setValueAtTime(784, now + 0.16);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.25);
    });
  },

  applyLang(lang) {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

    // Text elements
    document.querySelectorAll('[data-en][data-zh]').forEach(el => {
      if (el.classList.contains('hero-summary')) {
        el.innerHTML = el.getAttribute(`data-${lang}`);
      } else {
        el.textContent = el.getAttribute(`data-${lang}`);
      }
    });

    // UL elements with pipe-delimited items
    document.querySelectorAll(`[data-${lang}]`).forEach(el => {
      if (el.tagName !== 'UL') return;
      const data = el.getAttribute(`data-${lang}`);
      if (!data) return;
      el.innerHTML = data.split('|').map(item =>
        `<li>${item.trim().replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</li>`
      ).join('');
    });

    // Update lang toggle UI
    document.querySelectorAll('.lang-opt').forEach(opt => {
      const isActive = opt.getAttribute('data-lang') === lang;
      opt.classList.toggle('active', isActive);
    });
  },

  getLang() { return this.currentLang; }
};

// ========== STARFIELD CANVAS ==========
const StarfieldCanvas = {
  canvas: null, ctx: null,
  stars: [], animFrame: null,
  width: 0, height: 0,

  init() {
    this.canvas = document.getElementById('starfield-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Create starfield: 200 stars + 20 green portal particles
    for (let i = 0; i < 200; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 0.3 + 0.05,
        opacity: Math.random() * 0.7 + 0.3,
        twinkle: Math.random() * Math.PI * 2
      });
    }
    // Portal particles
    for (let i = 0; i < 20; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: Math.random() * 3 + 1,
        speed: Math.random() * 0.5 + 0.1,
        opacity: Math.random() * 0.5 + 0.3,
        twinkle: Math.random() * Math.PI * 2,
        green: true
      });
    }
    this.animate();
  },

  resize() {
    this.width = this.canvas.width = window.innerWidth;
    this.height = this.canvas.height = window.innerHeight;
  },

  animate() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.stars.forEach(s => {
      s.twinkle += 0.02;
      const alpha = s.opacity + Math.sin(s.twinkle) * 0.2;
      s.y -= s.speed;
      if (s.y < -5) { s.y = this.height + 5; s.x = Math.random() * this.width; }

      this.ctx.beginPath();
      this.ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      if (s.green) {
        this.ctx.fillStyle = `rgba(151,206,76,${alpha})`;
        // Glow for portal particles
        this.ctx.beginPath();
        this.ctx.arc(s.x, s.y, s.size * 3, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(151,206,76,${alpha * 0.1})`;
        this.ctx.fill();
      } else {
        this.ctx.fillStyle = `rgba(224,240,232,${alpha})`;
      }
      this.ctx.fill();
    });
    this.animFrame = requestAnimationFrame(() => this.animate());
  }
};

// ========== CHARACTER SYSTEM ==========
const CharacterSystem = {
  rick: { x: 0, y: 0, vx: 0.4, dir: 1, frame: 0, state: 'walk', stateTimer: 0 },
  morty: { x: 0, y: 0, vx: 0.7, dir: 1, frame: 0, state: 'follow', stateTimer: 0 },
  speechTimer: null,

  init() {
    // Position characters on canvas
    this.rick.x = -50;
    this.rick.y = window.innerHeight - 80;
    this.morty.x = -80;
    this.morty.y = window.innerHeight - 60;
    this.scheduleSpeech();
    window.addEventListener('resize', () => {
      this.rick.y = window.innerHeight - 80;
      this.morty.y = window.innerHeight - 60;
    });

    // Draw characters on the starfield canvas
    this.drawLoop();
  },

  scheduleSpeech() {
    const delay = Math.random() * 20000 + 10000;
    this.speechTimer = setTimeout(() => {
      this.showSpeech();
      this.scheduleSpeech();
    }, delay);
  },

  showSpeech() {
    const quotes = I18nEngine.getLang() === 'zh' ? [
      '这份简历是*嗝*多元宇宙里最棒的！',
      'Wubba lubba dub dub！',
      '我得喝一杯再继续看...',
      'Morty！别碰那个传送门！',
      '这人比我聪明——就聪明那么一点点。'
    ] : [
      'This resume is *burp* the best in the multiverse!',
      'Wubba lubba dub dub!',
      'I need a drink before reading more...',
      'Morty! Don\'t touch that portal!',
      'This guy is smarter than me — just a little bit.'
    ];
    const text = quotes[Math.floor(Math.random() * quotes.length)];

    const bubble = document.createElement('div');
    bubble.className = 'rick-speech';
    bubble.textContent = text;
    bubble.style.left = Math.max(10, this.rick.x - 80) + 'px';
    bubble.style.bottom = (window.innerHeight - this.rick.y + 50) + 'px';
    document.getElementById('character-bubbles').appendChild(bubble);

    setTimeout(() => { if (bubble.parentNode) bubble.remove(); }, 5200);

    // 40% chance of burp with speech
    if (Math.random() < 0.4) AudioEngine.burp();
  },

  update() {
    const w = window.innerWidth;

    // Rick behavior
    this.rick.stateTimer++;
    if (this.rick.stateTimer > 300) {
      this.rick.stateTimer = 0;
      const states = ['walk', 'walk', 'walk', 'pause', 'turn'];
      this.rick.state = states[Math.floor(Math.random() * states.length)];
    }

    switch (this.rick.state) {
      case 'walk':
        this.rick.x += this.rick.vx * this.rick.dir;
        this.rick.frame += 0.05;
        if (this.rick.x > w + 10) this.rick.dir = -1;
        if (this.rick.x < -10) this.rick.dir = 1;
        break;
      case 'pause':
        this.rick.frame = 0;
        break;
      case 'turn':
        this.rick.dir *= -1;
        this.rick.state = 'walk';
        break;
    }

    // Morty follows Rick with offset
    this.morty.dir = this.rick.dir;
    this.morty.x += (this.rick.x - 50 * this.rick.dir - this.morty.x) * 0.05;
    this.morty.frame = this.rick.frame;
    if (this.rick.state === 'pause') this.morty.state = 'nervous';
    else this.morty.state = 'follow';
  },

  drawPixelChar(ctx, x, y, type, frame, dir) {
    ctx.save();
    if (dir < 0) { ctx.translate(x + 24, y); ctx.scale(-1, 1); x = 0; }
    else ctx.translate(x, y);

    const bob = Math.sin(frame * Math.PI) * 2;

    if (type === 'rick') {
      // Hair spikes
      ctx.fillStyle = '#5bc0eb';
      ctx.fillRect(6, -10, 12, 8);
      ctx.fillRect(4, -12, 4, 12);
      ctx.fillRect(16, -12, 4, 12);
      // Head
      ctx.fillStyle = '#f5d6c3';
      ctx.fillRect(6, -2, 12, 10);
      // Lab coat
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(4, 8, 16, 16);
      // Belt
      ctx.fillStyle = '#555';
      ctx.fillRect(4, 22, 16, 2);
      // Pants
      ctx.fillStyle = '#8B7355';
      ctx.fillRect(4, 24, 7, 12 + bob);
      ctx.fillRect(13, 24, 7, 12 - bob);
      // Portal gun
      ctx.fillStyle = '#888';
      ctx.fillRect(18, 10, 6, 3);
      ctx.fillStyle = '#97ce4c';
      ctx.fillRect(22, 9, 4, 5);
    } else {
      // Morty
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(8, -2, 8, 9);
      // Yellow shirt
      ctx.fillStyle = '#f5e642';
      ctx.fillRect(5, 7, 14, 12);
      // Blue pants
      ctx.fillStyle = '#4169E1';
      ctx.fillRect(5, 19, 6, 10 + bob);
      ctx.fillRect(13, 19, 6, 10 - bob);
      // Nervous shake when stopped
      if (this.morty.state === 'nervous') {
        ctx.translate(Math.sin(Date.now() * 0.05) * 2, 0);
      }
    }
    // Legs alternate with frame
    ctx.fillStyle = '#333';
    ctx.fillRect(6, 29 + Math.max(bob, 0), 4, 6);
    ctx.fillRect(14, 29 + Math.max(-bob, 0), 4, 6);

    ctx.restore();
  },

};

// Hook character drawing into starfield animation
StarfieldCanvas.animate = function() {
  this.ctx.clearRect(0, 0, this.width, this.height);
  this.stars.forEach(s => {
    s.twinkle += 0.02;
    const alpha = s.opacity + Math.sin(s.twinkle) * 0.2;
    s.y -= s.speed;
    if (s.y < -5) { s.y = this.height + 5; s.x = Math.random() * this.width; }
    this.ctx.beginPath();
    this.ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    if (s.green) {
      this.ctx.fillStyle = `rgba(151,206,76,${alpha})`;
      this.ctx.beginPath();
      this.ctx.arc(s.x, s.y, s.size * 3, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(151,206,76,${alpha * 0.1})`;
      this.ctx.fill();
    } else {
      this.ctx.fillStyle = `rgba(224,240,232,${alpha})`;
    }
    this.ctx.fill();
  });

  // Draw characters
  const r = CharacterSystem.rick;
  const m = CharacterSystem.morty;
  CharacterSystem.update();
  CharacterSystem.drawPixelChar(this.ctx, r.x, r.y, 'rick', r.frame, r.dir);
  CharacterSystem.drawPixelChar(this.ctx, m.x, m.y, 'morty', m.frame, m.dir);

  this.animFrame = requestAnimationFrame(() => this.animate());
};

// ========== CONTENT MANAGER ==========
const ContentManager = {
  currentSection: null,
  transitioning: false,

  init() {
    // Position portals with JS (not CSS sin/cos — better compatibility)
    this.positionPortals();
    window.addEventListener('resize', () => this.positionPortals());

    // Bind portal clicks
    document.querySelectorAll('.portal').forEach(portal => {
      portal.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.transitioning) return;
        const section = portal.getAttribute('data-section');
        this.navigateTo(section);
      });
      portal.addEventListener('mouseenter', () => AudioEngine.hoverHum());
    });

    // Bind back buttons
    document.querySelectorAll('.back-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.navigateBack();
      });
    });

    // Keyboard: Escape to go back
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.currentSection) this.navigateBack();
    });
  },

  positionPortals() {
    const hub = document.getElementById('portal-hub');
    if (!hub) return;
    const cx = hub.offsetWidth / 2;
    const cy = hub.offsetHeight / 2;
    const radius = window.innerWidth < 768 ? 160 : 260;

    document.querySelectorAll('.portal').forEach((portal, i) => {
      const angleDeg = i * 60; // 6 portals, 60° apart
      const angleRad = (angleDeg * Math.PI) / 180;
      const x = cx + radius * Math.cos(angleRad);
      const y = cy + radius * Math.sin(angleRad);
      portal.style.left = x + 'px';
      portal.style.top = y + 'px';
    });
  },

  navigateTo(sectionId) {
    if (this.transitioning) return;
    this.transitioning = true;
    AudioEngine.portalOpen();

    const overlay = document.getElementById('portal-overlay');
    overlay.classList.add('active');

    setTimeout(() => {
      // Hide hub
      document.getElementById('portal-hub').style.display = 'none';

      // Show target overlay
      const panel = document.getElementById(`overlay-${sectionId}`);
      if (panel) {
        document.querySelectorAll('.overlay-panel').forEach(p => p.classList.remove('active', 'closing'));
        panel.classList.add('active');
        panel.querySelector('.overlay-scroll').scrollTop = 0;
        this.currentSection = sectionId;
      }

      setTimeout(() => {
        overlay.classList.remove('active');
        this.transitioning = false;
      }, 200);
    }, 350);
  },

  navigateBack() {
    if (this.transitioning) return;
    this.transitioning = true;
    AudioEngine.portalClose();

    const overlay = document.getElementById('portal-overlay');
    overlay.classList.add('active');

    // Close current panel
    const panel = document.getElementById(`overlay-${this.currentSection}`);
    if (panel) {
      panel.classList.remove('active');
      panel.classList.add('closing');
      setTimeout(() => panel.classList.remove('closing'), 400);
    }

    setTimeout(() => {
      document.getElementById('portal-hub').style.display = '';
      this.currentSection = null;

      setTimeout(() => {
        overlay.classList.remove('active');
        this.transitioning = false;
      }, 200);
    }, 350);
  }
};

// ========== SOUND TOGGLE ==========
function initSoundToggle() {
  const btn = document.getElementById('sound-toggle');
  if (!btn) return;

  const wasEnabled = (() => { try { return localStorage.getItem('resume-sound') === 'on'; } catch(e) { return false; } })();

  const updateBtn = () => {
    const on = AudioEngine.enabled;
    btn.textContent = on ? '🔊 Sound On' : '🔇 Sound Off';
    btn.classList.toggle('on', on);
  };

  if (wasEnabled) {
    AudioEngine.init();
    AudioEngine.enable().then(updateBtn);
  } else {
    AudioEngine.init();
    updateBtn();
  }

  btn.addEventListener('click', async () => {
    if (AudioEngine.enabled) {
      AudioEngine.disable();
    } else {
      await AudioEngine.enable();
    }
    updateBtn();
  });
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
  StarfieldCanvas.init();
  CharacterSystem.init();
  I18nEngine.init();
  ContentManager.init();
  initSoundToggle();
  // Re-position portals after fonts/layout settle
  setTimeout(() => ContentManager.positionPortals(), 500);
  window.addEventListener('resize', () => ContentManager.positionPortals());
  console.log('🧪 Multiverse Resume ready — Wubba lubba dub dub!');
});
