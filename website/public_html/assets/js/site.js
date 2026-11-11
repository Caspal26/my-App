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

  /* ---------- Header: mega menus + mobile menu ---------- */
  const header = $('.site-header');
  const items = $$('.nav-item.has-mega');
  const menuToggle = $('.menu-toggle');
  let hoverTimer;
  const closeAll = (except) => items.forEach((it) => {
    if (it === except) return;
    it.classList.remove('is-open');
    $('.nav-trigger', it).setAttribute('aria-expanded', 'false');
  });
  const open = (it) => { closeAll(it); it.classList.add('is-open'); $('.nav-trigger', it).setAttribute('aria-expanded', 'true'); };
  const closeMobileMenu = () => {
    header?.classList.remove('menu-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
    const label = $('.menu-toggle .label'); if (label) label.textContent = 'Menu';
  };
  items.forEach((it) => {
    const trigger = $('.nav-trigger', it);
    trigger.addEventListener('click', () => {
      if (it.classList.contains('is-open')) { closeAll(); } else { open(it); }
    });
    it.addEventListener('mouseenter', () => { if (!desktop.matches) return; clearTimeout(hoverTimer); hoverTimer = setTimeout(() => open(it), 120); });
    it.addEventListener('mouseleave', () => { if (!desktop.matches) return; clearTimeout(hoverTimer); hoverTimer = setTimeout(() => { it.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); }, 220); });
  });
  document.addEventListener('click', (e) => { if (desktop.matches && header && !header.contains(e.target)) closeAll(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const openItem = items.find((it) => it.classList.contains('is-open'));
    if (openItem) { closeAll(); $('.nav-trigger', openItem).focus(); }
  });
  header?.addEventListener('focusout', (e) => { if (desktop.matches && !header.contains(e.relatedTarget)) closeAll(); });
  menuToggle?.addEventListener('click', () => {
    const isOpen = header.classList.toggle('menu-open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    $('.menu-toggle .label').textContent = isOpen ? 'Close' : 'Menu';
    if (!isOpen) closeAll();
  });
  desktop.addEventListener('change', () => { closeAll(); closeMobileMenu(); });

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
    if (!panel) return;
    lastFocus = document.activeElement;
    closeAll();
    panel.hidden = false;
    document.body.style.overflow = 'hidden';
    input.value = q;
    input.focus();
    runSearch();
  };
  const closeSearch = (restoreFocus = true) => {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    document.body.style.overflow = '';
    if (restoreFocus) lastFocus?.focus?.();
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

  window.OMC = { initPage, closeMenus: () => { closeAll(); closeMobileMenu(); }, closeSearch };
  if (!window.OMC_SINGLE_FILE) initPage(document, location.search);
})();
