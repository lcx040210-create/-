// ========== I18N ENGINE ==========
const I18nEngine = {
  currentLang: localStorage.getItem('resume-lang') || 'en',

  init() {
    this.applyLang(this.currentLang);
    this.updateToggleButton();
    document.getElementById('lang-toggle').addEventListener('click', () => this.toggle());
  },

  toggle() {
    const overlay = document.getElementById('portal-overlay');
    // Phase 1: expand portal
    overlay.classList.add('active');

    setTimeout(() => {
      // Phase 2: swap all text
      this.currentLang = this.currentLang === 'en' ? 'zh' : 'en';
      localStorage.setItem('resume-lang', this.currentLang);
      this.applyLang(this.currentLang);
      this.updateToggleButton();

      // Phase 3: collapse portal
      setTimeout(() => {
        overlay.classList.remove('active');
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

    // Skill panels carry their heading text on the panel itself as
    // data-en-title / data-zh-title; push it into the panel's <h3> so the
    // title switches language along with everything else.
    document.querySelectorAll('.skill-panel').forEach(panel => {
      const title = panel.getAttribute(`data-${lang}-title`);
      const h3 = panel.querySelector('h3');
      if (title && h3) {
        h3.textContent = title;
      }
    });

    // Handle structured content (lists with pipe-delimited items)
    document.querySelectorAll(`[data-${lang}]`).forEach(el => {
      const data = el.getAttribute(`data-${lang}`);
      if (data && el.tagName === 'UL') {
        el.innerHTML = data.split('|').map(item => `<li>${item.trim()}</li>`).join('');
      }
    });

    // Handle bullet lists on experience cards
    document.querySelectorAll('.exp-bullets').forEach(ul => {
      const data = ul.getAttribute(`data-${lang}`);
      if (data) {
        ul.innerHTML = data.split('|').map(item => `<li>${item.trim()}</li>`).join('');
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

// Temporary standalone init so the site works without Task 6's unified entry
// point. Task 6 will replace this with the combined I18n/Canvas/Eggs/Scroll
// initializer.
document.addEventListener('DOMContentLoaded', () => I18nEngine.init());

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

// Temporary standalone init so the site works without Task 6's unified entry
// point. Task 6 will replace this with the combined I18n/Canvas/Eggs/Scroll
// initializer.
document.addEventListener('DOMContentLoaded', () => PortalCanvas.init());
