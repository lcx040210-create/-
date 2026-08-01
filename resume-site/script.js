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
