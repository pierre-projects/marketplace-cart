/**
 * Landing page motion:
 *
 *   [data-reveal]       fades and rises in once, the first time it scrolls into view
 *   [data-tilt]         the hero screenshot flattens from a 14° tilt as the hero scrolls away
 *   [data-parallax=n]   drifts at n × the scroll offset from the viewport centre
 *   [data-story]        sticky story: the active step decides which screenshot shows
 *   [data-count-to=n]   counts up from 0 when revealed
 *
 * Everything is progressive. Nothing is hidden until this script has run and
 * confirmed motion is allowed, so without JS (or with reduced motion) the page
 * is complete and static.
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionOK = !reduceMotion.matches && 'IntersectionObserver' in window;

// ── Reveal ──────────────────────────────────────────────────────────────

function initReveal() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (!motionOK || !targets.length) return;

  document.documentElement.classList.add('motion-ready');
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      entry.target.querySelectorAll('[data-count-to]').forEach(countUp);
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });

  targets.forEach((el) => io.observe(el));

  // Never leave content hidden: anything still waiting after the page has
  // settled (a print, a very tall screen, a missed callback) is shown.
  window.addEventListener('load', () => {
    setTimeout(() => targets.forEach((el) => el.classList.add('is-in')), 4000);
  }, { once: true });
}

function countUp(el) {
  const to = Number(el.dataset.countTo);
  if (!Number.isFinite(to) || el.dataset.counted) return;
  el.dataset.counted = '1';
  const start = performance.now();
  const duration = 900;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(to * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  el.textContent = '0';
  requestAnimationFrame(step);
}

// ── Scroll-linked: tilt + parallax (one rAF per frame, transforms only) ──

function initScrollEffects() {
  if (reduceMotion.matches) return;

  const tilt = document.querySelector('[data-tilt]');
  const stage = document.querySelector('[data-hero-stage]');
  const layers = [...document.querySelectorAll('[data-parallax]')].map((el) => ({
    el,
    speed: Number(el.dataset.parallax) || 0,
  }));
  if (!tilt && !layers.length) return;

  let queued = false;
  const update = () => {
    queued = false;
    const vh = window.innerHeight;

    if (tilt && stage) {
      // 1 when the stage top sits at the bottom of the viewport, 0 once it
      // has risen to 25% from the top.
      const top = stage.getBoundingClientRect().top;
      const p = Math.min(1, Math.max(0, (top - vh * 0.25) / (vh * 0.6)));
      tilt.style.setProperty('--tilt', p.toFixed(3));
    }

    for (const { el, speed } of layers) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) continue;
      const fromCentre = r.top + r.height / 2 - vh / 2;
      el.style.transform = `translate3d(0, ${(fromCentre * speed).toFixed(1)}px, 0)`;
    }
  };

  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}

// ── Sticky story ────────────────────────────────────────────────────────

function initStory() {
  const story = document.querySelector('[data-story]');
  if (!story || !('IntersectionObserver' in window)) return;

  const steps = [...story.querySelectorAll('[data-story-step]')];
  const shots = [...story.querySelectorAll('[data-story-shot]')];
  const progress = story.querySelector('[data-story-progress]');

  const activate = (index) => {
    steps.forEach((s, i) => s.classList.toggle('is-active', i === index));
    shots.forEach((s, i) => s.classList.toggle('is-active', i === index));
    progress?.parentElement.style.setProperty('--progress', ((index + 1) / steps.length).toFixed(3));
  };

  // A step is "current" while it crosses the middle band of the viewport.
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) activate(Number(entry.target.dataset.storyStep));
    }
  }, { rootMargin: '-45% 0px -45% 0px' });

  steps.forEach((s) => io.observe(s));
  activate(0);
}

initReveal();
initScrollEffects();
initStory();
