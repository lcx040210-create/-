// ========== I18N ENGINE ==========
const I18nEngine = {
  // localStorage can throw (e.g. blocked cookies / privacy mode), which would
  // otherwise kill the whole script at load. Fall back to 'en'.
  currentLang: (() => {
    try { return localStorage.getItem('resume-lang') || 'en'; }
    catch (e) { return 'en'; }
  })(),

  init() {
    this.applyLang(this.currentLang);
    this.updateToggleButton();
    document.getElementById('lang-toggle').addEventListener('click', () => this.toggle());
  },

  // Debounce flag: prevents re-entrant toggles while the portal animation
  // (300ms expand + 150ms collapse) is still running.
  busy: false,

  toggle() {
    if (this.busy) return;
    this.busy = true;
    const overlay = document.getElementById('portal-overlay');
    // Phase 1: expand portal
    overlay.classList.add('active');

    setTimeout(() => {
      // Phase 2: swap all text
      this.currentLang = this.currentLang === 'en' ? 'zh' : 'en';
      try { localStorage.setItem('resume-lang', this.currentLang); }
      catch (e) { /* storage unavailable — language still switches in-memory */ }
      this.applyLang(this.currentLang);
      this.updateToggleButton();

      // Phase 3: collapse portal
      setTimeout(() => {
        overlay.classList.remove('active');
        this.busy = false;
      }, 150);
    }, 300);
  },

  applyLang(lang) {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

    // Standard text swap for every container carrying both data attributes.
    // The hero-summary stores <br> paragraph breaks inside its data-en/data-zh
    // values, so it must be written via innerHTML (not textContent) for the
    // <br> tags to render as line breaks instead of literal text.
    document.querySelectorAll('[data-en][data-zh]').forEach(el => {
      const value = el.getAttribute(`data-${lang}`);
      if (el.classList.contains('hero-summary')) {
        el.innerHTML = value;
      } else {
        el.textContent = value;
      }
    });

    // Handle structured content (lists with pipe-delimited items). This covers
    // every list carrying data-en/data-zh, including .exp-bullets ULs. Bullet
    // text may contain **strong** markdown that must become <strong> tags
    // instead of rendering as literal asterisks.
    document.querySelectorAll(`[data-${lang}]`).forEach(el => {
      const data = el.getAttribute(`data-${lang}`);
      if (data && el.tagName === 'UL') {
        el.innerHTML = data.split('|')
          .map(item => `<li>${item.trim().replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</li>`)
          .join('');
      }
    });
  },

  updateToggleButton() {
    const btn = document.getElementById('lang-toggle');
    const enLabel = btn.querySelector('.lang-label:first-child');
    const zhLabel = btn.querySelector('.lang-label:last-child');
    if (this.currentLang === 'en') {
      enLabel.style.fontWeight = '700';
      enLabel.style.color = 'var(--portal-green)';
      zhLabel.style.fontWeight = '400';
      zhLabel.style.color = 'var(--text-dim)';
    } else {
      zhLabel.style.fontWeight = '700';
      zhLabel.style.color = 'var(--portal-green)';
      enLabel.style.fontWeight = '400';
      enLabel.style.color = 'var(--text-dim)';
    }
  },

  getLang() { return this.currentLang; }
};

// ========== CANVAS PARTICLE BACKGROUND ==========
const PortalCanvas = {
  canvas: null, ctx: null,
  particles: [], vortices: [], characters: [],
  animFrame: null,
  width: 0, height: 0,

  init() {
    this.canvas = document.getElementById('portal-canvas');
    if (!this.canvas) return; // guard: canvas must exist (Task 1 HTML)
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    // Mobile optimization: fewer particles below 768px viewport width
    const isMobile = window.innerWidth < 768;
    const particleCount = isMobile ? 18 : 48;
    const vortexCount = isMobile ? 3 : 9;
    const charCount = isMobile ? 0 : 3;

    // Floating particles (80% of 60 = 48 desktop / 18 mobile)
    for (let i = 0; i < particleCount; i++) {
      this.particles.push(new FloatingParticle(this.width, this.height));
    }
    // Portal vortex rings (15% of 60 = 9 desktop / 3 mobile)
    for (let i = 0; i < vortexCount; i++) {
      this.vortices.push(new PortalVortexParticle(this.width, this.height));
    }
    // Pixel characters (5% of 60 = 3 desktop / 0 mobile)
    const charTypes = ['rick', 'morty', 'rick'];
    for (let i = 0; i < charCount; i++) {
      this.characters.push(new PixelCharacter(this.width, this.height, charTypes[i % charTypes.length]));
    }

    this.animate();
  },

  resize() {
    this.width = this.canvas.width = window.innerWidth;
    this.height = this.canvas.height = window.innerHeight;
    // Keep every active particle's bounds in sync with the viewport
    this.particles.forEach(p => p.updateBounds(this.width, this.height));
    this.vortices.forEach(v => v.updateBounds(this.width, this.height));
    this.characters.forEach(c => c.updateBounds(this.width, this.height));
  },

  animate() {
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.particles.forEach(p => { p.update(); p.draw(this.ctx); });
    this.vortices.forEach(v => { v.update(); v.draw(this.ctx); });
    this.characters.forEach(c => { c.update(); c.draw(this.ctx); });

    this.animFrame = requestAnimationFrame(() => this.animate());
  },

  // Teardown hook for Task 6's unified entry point / SPA navigation.
  destroy() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = null;
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this.particles = [];
    this.vortices = [];
    this.characters = [];
  }
};

// ========== FLOATING PARTICLE ==========
class FloatingParticle {
  constructor(w, h) {
    this.x = Math.random() * w;
    this.y = Math.random() * h;
    this.size = Math.random() * 2.5 + 1;
    this.speedX = (Math.random() - 0.5) * 0.3;
    this.speedY = (Math.random() - 0.5) * 0.3 - 0.2; // slight upward drift
    this.opacity = Math.random() * 0.5 + 0.2;
    this.width = w; this.height = h;
  }

  updateBounds(w, h) { this.width = w; this.height = h; }

  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    // Wrap around edges
    if (this.x < -5) this.x = this.width + 5;
    if (this.x > this.width + 5) this.x = -5;
    if (this.y < -5) this.y = this.height + 5;
    if (this.y > this.height + 5) this.y = -5;
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(151, 206, 76, ${this.opacity})`;
    ctx.fill();
    // Small glow
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(151, 206, 76, ${this.opacity * 0.15})`;
    ctx.fill();
  }
}

// ========== PORTAL VORTEX PARTICLE ==========
class PortalVortexParticle {
  constructor(w, h) {
    this.reset(w, h);
  }

  reset(w, h) {
    this.x = Math.random() * w;
    this.y = Math.random() * h;
    this.radius = 0;
    this.maxRadius = Math.random() * 40 + 20;
    this.growing = true;
    this.life = 0;
    this.maxLife = Math.random() * 180 + 120; // 3-5 seconds at 60fps
    this.width = w; this.height = h;
  }

  updateBounds(w, h) { this.width = w; this.height = h; }

  update() {
    this.life++;
    if (this.growing) {
      this.radius += 0.4;
      if (this.radius >= this.maxRadius) this.growing = false;
    } else {
      this.radius -= 0.3;
    }
    if (this.life >= this.maxLife) this.reset(this.width, this.height);
  }

  draw(ctx) {
    // Guard: update() shrinks radius by 0.3/frame after it stops growing, and
    // a long-lived vortex can outlive its shrink-to-zero time. A negative
    // radius throws IndexSizeError from ctx.arc()/createRadialGradient(),
    // which would propagate out of the rAF callback and freeze every particle.
    if (this.radius < 0) this.radius = 0;
    const alpha = 1 - (this.life / this.maxLife);
    // Outer ring
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 181, 204, ${alpha * 0.6})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Inner glow
    const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
    gradient.addColorStop(0, `rgba(151, 206, 76, ${alpha * 0.4})`);
    gradient.addColorStop(1, `rgba(151, 206, 76, 0)`);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}

// ========== PIXEL CHARACTER ==========
class PixelCharacter {
  constructor(w, h, type) {
    this.type = type; // 'rick' or 'morty'
    this.size = type === 'rick' ? 8 : 6;
    this.x = Math.random() * w;
    this.y = h - 40 - Math.random() * 200;
    this.speed = type === 'rick' ? 0.5 : 1.2;
    this.direction = Math.random() > 0.5 ? 1 : -1;
    this.walkFrame = 0;
    this.active = Math.random() > 0.7; // 30% chance to be visible at start
    this.cooldown = Math.floor(Math.random() * 300);
    this.width = w; this.height = h;
    // Simple pixel art: Rick = green spikes, Morty = yellow shirt
    this.color = type === 'rick' ? '#97ce4c' : '#f5e642';
    this.secondary = type === 'rick' ? '#00b5cc' : '#e8a850';
  }

  updateBounds(w, h) { this.width = w; this.height = h; }

  update() {
    if (!this.active) {
      this.cooldown--;
      if (this.cooldown <= 0) {
        this.active = true;
        this.x = this.direction > 0 ? -20 : this.width + 20;
        this.y = this.height - 40 - Math.random() * 100;
        this.cooldown = Math.floor(Math.random() * 600 + 300);
      }
      return;
    }
    this.x += this.speed * this.direction;
    this.walkFrame = (this.walkFrame + 0.1) % 2;
    // Walk off screen
    if (this.x > this.width + 30 || this.x < -30) {
      this.active = false;
      this.direction *= -1;
    }
  }

  draw(ctx) {
    if (!this.active) return;
    const s = this.size;
    const x = Math.floor(this.x);
    const y = Math.floor(this.y + (this.walkFrame > 1 ? 1 : 0));
    // Body
    ctx.fillStyle = this.color;
    ctx.fillRect(x, y + s, s * 2, s * 2);
    // Head
    ctx.fillStyle = this.secondary;
    ctx.fillRect(x + s / 2, y, s, s);
    // Legs (alternating walk)
    const step = Math.floor(this.walkFrame);
    ctx.fillStyle = '#555';
    ctx.fillRect(x, y + s * 3 + (step ? 1 : 0), s, s);
    ctx.fillRect(x + s, y + s * 3 + (step ? 0 : 1), s, s);
  }
}

// ========== EASTER EGG SYSTEM ==========
const EasterEggs = {
  quotes: {
    en: [
      "This resume is *burp* the best in the multiverse, Morty!",
      "You gotta pump those numbers up, those are rookie numbers!",
      "Wubba lubba dub dub! Hire this guy!",
      "I turned myself into a resume, Morty! I'm Resume Rick!",
      "In an infinite multiverse, this is the best hire you'll make.",
      "Don't think about it, just hire him, Morty!"
    ],
    zh: [
      "这份简历是*嗝*多元宇宙里最棒的，Morty！",
      "你得把那些数字搞上去，这都是菜鸟水平！",
      "Wubba lubba dub dub！快雇这个人！",
      "我把自己变成了一份简历，Morty！我是简历 Rick！",
      "在无限多元宇宙里，这是你能做出的最好招聘。",
      "别想了，就雇他吧，Morty！"
    ]
  },
  bubbleTimer: null,

  init() {
    this.scheduleBubble();
    this.initPortalGunCursor();
    this.initTitleGlitch();
  },

  scheduleBubble() {
    const delay = Math.random() * 15000 + 15000; // 15-30 seconds
    this.bubbleTimer = setTimeout(() => {
      this.showBubble();
      this.scheduleBubble();
    }, delay);
  },

  showBubble() {
    const layer = document.getElementById('easter-egg-layer');
    if (!layer) return; // guard: layer must exist (Task 1 HTML)

    const lang = I18nEngine.getLang();
    const quotes = this.quotes[lang] || this.quotes.en;
    const quote = quotes[Math.floor(Math.random() * quotes.length)];

    const bubble = document.createElement('div');
    bubble.className = 'rick-bubble';
    bubble.innerHTML = `
      <div class="bubble-avatar">🧪</div>
      <div class="bubble-text">${quote}</div>
    `;
    layer.appendChild(bubble);

    // Float up and fade out
    setTimeout(() => {
      bubble.style.animation = 'floatUp 1.5s ease forwards';
      setTimeout(() => bubble.remove(), 1500);
    }, 5000);
  },

  // Portal gun cursor in hero area
  initPortalGunCursor() {
    const hero = document.getElementById('hero');
    if (!hero) return; // guard: hero must exist (Task 1 HTML)
    const portalCursorSVG = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      '<circle cx="12" cy="12" r="6" fill="none" stroke="#97ce4c" stroke-width="2"/>' +
      '<circle cx="12" cy="12" r="2" fill="#97ce4c"/>' +
      '<line x1="12" y1="6" x2="12" y2="2" stroke="#97ce4c" stroke-width="1.5"/>' +
      '<line x1="18" y1="12" x2="22" y2="12" stroke="#97ce4c" stroke-width="1.5"/>' +
      '</svg>'
    )}`;

    hero.addEventListener('mouseenter', () => {
      hero.style.cursor = `url('${portalCursorSVG}') 12 12, auto`;
    });
    hero.addEventListener('mouseleave', () => {
      hero.style.cursor = 'default';
    });
  },

  // Random title character glitch (Rick's influence)
  initTitleGlitch() {
    setInterval(() => {
      if (Math.random() > 0.85) { // 15% chance every 3 seconds
        const name = document.querySelector('.hero-name');
        if (!name) return; // guard: name must exist (Task 1 HTML)
        const glitchText = name.textContent.split('').map(c =>
          Math.random() > 0.9 ? String.fromCharCode(33 + Math.random() * 90) : c
        ).join('');
        name.textContent = glitchText;
        setTimeout(() => { name.textContent = I18nEngine.getLang() === 'zh' ?
          name.getAttribute('data-zh') : name.getAttribute('data-en'); }, 150);
      }
    }, 3000);
  }
};

// ========== SCROLL EFFECTS ==========
const ScrollEffects = {
  init() {
    this.initProgressBar();
    this.initFadeInObserver();
  },

  initProgressBar() {
    const bar = document.getElementById('scroll-progress');
    window.addEventListener('scroll', () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      bar.style.height = `${Math.min(progress, 100)}%`;
    }, { passive: true });
  },

  initFadeInObserver() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.console-card').forEach(card => {
      observer.observe(card);
    });
  }
};

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
  I18nEngine.init();
  PortalCanvas.init();
  EasterEggs.init();
  ScrollEffects.init();
  console.log('🧪 Resume site initialized — Wubba lubba dub dub!');
});
