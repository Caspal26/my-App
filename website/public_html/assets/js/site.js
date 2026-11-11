(() => {
  'use strict';
  const root = document.documentElement.dataset.root || '';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktop = window.matchMedia('(min-width: 961px)');
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ================= Site-wide (runs once) ================= */

  /* ---------- Slide helper (a smooth slideDown / slideUp) ---------- */
  const SLIDE_MS = reduceMotion ? 0 : 260;
  const slides = new WeakMap();
  // Animates el's height and vertical padding from its current size to open or closed.
  // The caller makes el displayable before opening; `done` runs once a close has finished.
  const slide = (el, opening, done, from) => {
    const cs = getComputedStyle(el);
    const running = slides.get(el);
    // Opening from closed starts at zero; reversing a slide in progress starts where it is now.
    const start = from || (opening && !running
      ? { h: 0, pt: '0px', pb: '0px' }
      : { h: el.getBoundingClientRect().height, pt: cs.paddingTop, pb: cs.paddingBottom });
    running?.cancel();
    el.style.overflow = 'hidden';
    const natural = getComputedStyle(el);
    const end = opening
      ? { h: el.getBoundingClientRect().height, pt: natural.paddingTop, pb: natural.paddingBottom }
      : { h: 0, pt: '0px', pb: '0px' };
    const finish = () => { if (done) done(); el.style.overflow = ''; slides.delete(el); };
    if (!SLIDE_MS || !el.animate || (opening && start.h === end.h)) { finish(); return; }
    const anim = el.animate([
      { height: start.h + 'px', paddingTop: start.pt, paddingBottom: start.pb },
      { height: end.h + 'px', paddingTop: end.pt, paddingBottom: end.pb },
    ], { duration: SLIDE_MS, easing: opening ? 'cubic-bezier(.2,.7,.2,1)' : 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    slides.set(el, anim);
    anim.onfinish = () => { finish(); anim.cancel(); };
  };

  /* ---------- Header: mega menus + mobile menu ---------- */
  const header = $('.site-header');
  const items = $$('.nav-item.has-mega');
  const menuToggle = $('.menu-toggle');
  const nav = $('.primary-nav');
  const trig = (it) => $('.nav-trigger', it);
  const megaOf = (it) => $('.mega', it);
  const isOpen = (it) => trig(it).getAttribute('aria-expanded') === 'true';
  let openTimer, closeTimer;
  const hideNow = (it) => {
    const mega = megaOf(it);
    slides.get(mega)?.cancel();
    slides.delete(mega);
    mega.style.overflow = '';
    it.classList.remove('is-open');
    trig(it).setAttribute('aria-expanded', 'false');
  };
  const closeItem = (it, instant) => {
    if (!it.classList.contains('is-open')) return;
    if (instant) { hideNow(it); return; }
    if (!isOpen(it)) return; // already closing
    trig(it).setAttribute('aria-expanded', 'false');
    slide(megaOf(it), false, () => it.classList.remove('is-open'));
  };
  const closeAll = (except, instant) => items.forEach((it) => { if (it !== except) closeItem(it, instant); });
  const open = (it) => {
    if (isOpen(it)) return;
    let from;
    if (desktop.matches) {
      // Moving between menus: morph from the visible panel's size instead of closing and reopening.
      const prev = items.find((x) => x !== it && x.classList.contains('is-open'));
      if (prev) {
        const pm = megaOf(prev), cs = getComputedStyle(pm);
        from = { h: pm.getBoundingClientRect().height, pt: cs.paddingTop, pb: cs.paddingBottom };
        hideNow(prev);
      }
      closeAll(it, true);
    }
    it.classList.add('is-open');
    trig(it).setAttribute('aria-expanded', 'true');
    slide(megaOf(it), true, null, from);
  };
  const setMenuLabel = (txt) => { const l = $('.menu-toggle .label'); if (l) l.textContent = txt; };
  const openMobileMenu = () => {
    header.classList.add('menu-open');
    menuToggle.setAttribute('aria-expanded', 'true');
    setMenuLabel('Close');
    slide(nav, true);
  };
  const closeMobileMenu = (instant) => {
    if (!header?.classList.contains('menu-open')) return;
    menuToggle?.setAttribute('aria-expanded', 'false');
    setMenuLabel('Menu');
    const done = () => { header.classList.remove('menu-open'); closeAll(null, true); };
    if (instant || desktop.matches) { slides.get(nav)?.cancel(); nav.style.overflow = ''; done(); }
    else slide(nav, false, done);
  };
  items.forEach((it) => {
    trig(it).addEventListener('click', () => { if (isOpen(it)) closeItem(it); else open(it); });
    // Hover intent: open after a short pause; stay open briefly after the pointer leaves.
    it.addEventListener('mouseenter', () => {
      if (!desktop.matches) return;
      clearTimeout(closeTimer); clearTimeout(openTimer);
      if (items.some(isOpen)) open(it); else openTimer = setTimeout(() => open(it), 90);
    });
    it.addEventListener('mouseleave', () => {
      if (!desktop.matches) return;
      clearTimeout(openTimer);
      closeTimer = setTimeout(() => closeItem(it), 380);
    });
  });
  document.addEventListener('click', (e) => { if (desktop.matches && header && !header.contains(e.target)) closeAll(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const openItem = items.find(isOpen);
    if (openItem) { closeAll(); trig(openItem).focus(); }
  });
  header?.addEventListener('focusout', (e) => { if (desktop.matches && !header.contains(e.relatedTarget)) closeAll(); });
  menuToggle?.addEventListener('click', () => {
    if (menuToggle.getAttribute('aria-expanded') === 'true') closeMobileMenu(); else openMobileMenu();
  });
  desktop.addEventListener('change', () => { closeAll(null, true); closeMobileMenu(true); });

  /* ---------- Site search ---------- */
  const panel = $('#search-panel');
  const input = $('#search-input');
  const results = $('#search-results');
  const hint = $('#search-hint');
  let searchIndex = null, lastFocus = null;
  const loadIndex = () => new Promise((resolve) => {
    if (searchIndex) return resolve(searchIndex);
    if (window.OMC_SEARCH) { searchIndex = window.OMC_SEARCH; return resolve(searchIndex); }
    const s = document.createElement('script');
    s.src = root + 'assets/js/search-index.js';
    s.onload = () => { searchIndex = window.OMC_SEARCH || []; resolve(searchIndex); };
    s.onerror = () => { searchIndex = []; resolve(searchIndex); };
    document.head.appendChild(s);
  });
  const runSearch = async () => {
    const q = norm(input.value.trim());
    const list = await loadIndex();
    if (!q) { results.innerHTML = ''; hint.textContent = 'Search practice areas, insights, people and pages.'; return; }
    const terms = q.split(/\s+/);
    const scored = list.map((item) => {
      const title = norm(item.t), body = norm(item.t + ' ' + item.d + ' ' + (item.k || ''));
      if (!terms.every((t) => body.includes(t))) return null;
      return { item, score: terms.reduce((n, t) => n + (title.includes(t) ? 3 : 1), 0) };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 12);
    results.innerHTML = scored.map(({ item }) => `<li><a href="${esc(root + item.u)}"><strong>${esc(item.t)}</strong><span>${esc(item.s || '')}${item.s ? ' · ' : ''}${esc(item.d)}</span></a></li>`).join('');
    hint.textContent = scored.length ? `${scored.length} result${scored.length === 1 ? '' : 's'}` : 'No results. Try a different word, or contact us directly.';
  };
  const openSearch = (q = '') => {
    if (!panel || panel.dataset.closing) return;
    lastFocus = document.activeElement;
    closeAll();
    panel.hidden = false;
    document.body.style.overflow = 'hidden';
    input.value = q;
    input.focus();
    runSearch();
  };
  const closeSearch = (restoreFocus = true, instant = false) => {
    if (!panel || panel.hidden || panel.dataset.closing) return;
    const hide = () => { panel.hidden = true; delete panel.dataset.closing; document.body.style.overflow = ''; };
    if (restoreFocus) lastFocus?.focus?.();
    if (instant || reduceMotion || !panel.animate) { hide(); return; }
    panel.dataset.closing = '1';
    panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease' }).onfinish = hide;
  };
  // Delegated so that "Search" buttons inside swapped-in page content also work.
  document.addEventListener('click', (e) => { if (e.target.closest?.('[data-open-search]')) openSearch(); });
  input?.addEventListener('input', runSearch);
  $('#search-form')?.addEventListener('submit', (e) => { e.preventDefault(); $('#search-results a')?.click(); });
  $('.search-close')?.addEventListener('click', () => closeSearch());
  panel?.addEventListener('click', (e) => { if (e.target === panel) closeSearch(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
    const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !typing && panel?.hidden) { e.preventDefault(); openSearch(); }
  });
  panel?.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = $$('input, button, a[href]', panel).filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  /* ================= Per page (re-run when page content changes) ================= */
  function initPage(scope = document, query = location.search) {
    const params = new URLSearchParams(query);
    const cleanups = [];
    const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };

    /* ---------- Hero carousel ---------- */
    const hero = $('.hero', scope);
    if (hero) {
      const slides = $$('.hero-slide', hero);
      const dots = $$('.hero-dot', hero);
      const pauseBtn = $('.hero-pause', hero);
      const interval = Number(hero.dataset.interval || 7000);
      hero.style.setProperty('--interval', interval + 'ms');
      let index = 0, timer = null, userPaused = reduceMotion, hoverPaused = false;
      const playing = () => !userPaused && !hoverPaused && slides.length > 1;
      const restart = () => {
        clearTimeout(timer);
        hero.classList.remove('is-playing');
        if (!playing()) return;
        void hero.offsetWidth; // restart the progress animation
        hero.classList.add('is-playing');
        timer = setTimeout(() => show(index + 1), interval);
      };
      const show = (n) => {
        index = (n + slides.length) % slides.length;
        slides.forEach((s, i) => {
          const active = i === index;
          s.classList.toggle('is-active', active);
          s.setAttribute('aria-hidden', String(!active));
          $$('a, button', s).forEach((el) => { el.tabIndex = active ? 0 : -1; });
        });
        dots.forEach((d, i) => d.setAttribute('aria-current', String(i === index)));
        restart();
      };
      const setPauseUi = () => {
        if (!pauseBtn) return;
        pauseBtn.setAttribute('aria-label', userPaused ? 'Play slideshow' : 'Pause slideshow');
        pauseBtn.setAttribute('aria-pressed', String(userPaused));
        pauseBtn.innerHTML = userPaused
          ? '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>'
          : '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" fill="currentColor"/></svg>';
      };
      dots.forEach((d, i) => d.addEventListener('click', () => show(i)));
      pauseBtn?.addEventListener('click', () => { userPaused = !userPaused; setPauseUi(); restart(); });
      hero.addEventListener('mouseenter', () => { hoverPaused = true; restart(); });
      hero.addEventListener('mouseleave', () => { hoverPaused = false; restart(); });
      hero.addEventListener('focusin', () => { hoverPaused = true; restart(); });
      hero.addEventListener('focusout', (e) => { if (!hero.contains(e.relatedTarget)) { hoverPaused = false; restart(); } });
      let startX = null;
      hero.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
      hero.addEventListener('touchend', (e) => {
        if (startX === null) return;
        const dx = e.changedTouches[0].clientX - startX; startX = null;
        if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
      });
      listen(document, 'visibilitychange', () => { hoverPaused = document.hidden; restart(); });
      cleanups.push(() => clearTimeout(timer));
      setPauseUi();
      show(0);
    }

    /* ---------- Card carousels ---------- */
    $$('[data-carousel]', scope).forEach((wrap) => {
      const track = $('.card-track', wrap);
      const prev = $('[data-prev]', wrap), next = $('[data-next]', wrap);
      if (!track) return;
      const step = () => { const card = $('.card', track); return card ? card.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || 28) : track.clientWidth; };
      const update = () => {
        const max = track.scrollWidth - track.clientWidth - 2;
        if (prev) prev.disabled = track.scrollLeft <= 2;
        if (next) next.disabled = track.scrollLeft >= max;
      };
      prev?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: reduceMotion ? 'auto' : 'smooth' }));
      next?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: reduceMotion ? 'auto' : 'smooth' }));
      track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
      listen(window, 'resize', update);
      update();
    });

    /* ---------- Insight topic filter ---------- */
    const chips = $$('[data-filter-topic]', scope);
    if (chips.length) {
      const cards = $$('[data-topic]', scope);
      const apply = (topic) => {
        chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filterTopic === topic)));
        cards.forEach((c) => { c.hidden = topic !== 'all' && c.dataset.topic !== topic; });
      };
      chips.forEach((c) => c.addEventListener('click', () => apply(c.dataset.filterTopic)));
      const initial = params.get('topic');
      apply(initial && chips.some((c) => c.dataset.filterTopic === initial) ? initial : 'all');
    }

    /* ---------- People finder ---------- */
    const peopleSearch = $('#people-search', scope);
    if (peopleSearch) {
      const practice = $('#people-practice', scope);
      const people = $$('.person', scope);
      const empty = $('#people-empty', scope);
      const apply = () => {
        const q = norm(peopleSearch.value.trim());
        const p = practice.value;
        let shown = 0;
        people.forEach((el) => {
          const ok = (!q || norm(el.dataset.search).includes(q)) && (!p || el.dataset.practices.split('|').includes(p));
          el.hidden = !ok; if (ok) shown++;
        });
        empty.hidden = shown > 0;
      };
      peopleSearch.value = params.get('q') || '';
      if (params.get('practice')) practice.value = params.get('practice');
      peopleSearch.addEventListener('input', apply);
      practice.addEventListener('change', apply);
      apply();
    }

    /* ---------- Side navigation highlight ---------- */
    const sideLinks = $$('.side-nav a[href^="#"]', scope);
    if (sideLinks.length && 'IntersectionObserver' in window) {
      const map = new Map(sideLinks.map((a) => [a.getAttribute('href').slice(1), a]));
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          sideLinks.forEach((a) => a.classList.remove('is-active'));
          map.get(en.target.id)?.classList.add('is-active');
        });
      }, { rootMargin: '-20% 0px -70% 0px' });
      map.forEach((_, id) => { const el = document.getElementById(id); if (el) io.observe(el); });
      cleanups.push(() => io.disconnect());
    }

    /* ---------- Contact form ---------- */
    const form = $('#contact-form', scope);
    if (form) {
      const status = $('#form-status', scope);
      const started = $('input[name="started"]', form);
      if (started) started.value = String(Math.floor(Date.now() / 1000));
      const topicSelect = $('#topic', form), wanted = params.get('topic');
      if (topicSelect && wanted) { const opt = Array.from(topicSelect.options).find((o) => o.value === wanted); if (opt) topicSelect.value = wanted; }
      const sent = params.get('sent'), err = params.get('error');
      const messages = {
        missing: 'Please complete your name, a valid email address, your message and the privacy consent.',
        spam: 'Your message could not be sent. Please try again in a moment, or email us directly.',
        server: 'Sorry, the message could not be sent right now. Please email or call us instead.'
      };
      if (sent === '1') { status.hidden = false; status.className = 'form-status ok'; status.textContent = 'Thank you. Your message has been sent and we will be in touch shortly.'; }
      else if (err) { status.hidden = false; status.className = 'form-status err'; status.textContent = messages[err] || messages.server; }
      if (sent || err) status.focus();
      if (document.documentElement.dataset.preview) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          status.hidden = false;
          status.className = 'form-status err';
          status.textContent = 'This is a preview copy of the website, so messages are not sent from here. The form will work once the site is published at omcadvocates.co.ke.';
          status.focus();
        });
      }
    }

    return () => cleanups.splice(0).forEach((fn) => fn());
  }

  window.OMC = { initPage, closeMenus: (instant = true) => { closeAll(null, instant); closeMobileMenu(instant); }, closeSearch };
  if (!window.OMC_SINGLE_FILE) initPage(document, location.search);
})();
