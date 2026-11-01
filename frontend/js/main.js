(function () {
  // ---------- Sidebar (verifier page) ----------
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('vOverlay');
  var toggles = [document.getElementById('sidebarToggle'), document.getElementById('menuBtn')];

  // Phones: put the menu button in its own row under the page links, with the title below it
  var menuBtn = document.getElementById('menuBtn');
  var vMainHero = document.querySelector('.v-main > .hero');
  if (menuBtn && vMainHero) {
    var row = document.createElement('div');
    row.className = 'v-menu-row';
    vMainHero.after(row);
    row.appendChild(menuBtn);
  }

  function setSidebar(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    if (overlay) overlay.classList.toggle('show', open);
  }
  toggles.forEach(function (btn) {
    if (btn) btn.addEventListener('click', function () {
      setSidebar(!sidebar.classList.contains('open'));
    });
  });
  if (overlay) overlay.addEventListener('click', function () { setSidebar(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setSidebar(false); });

  // ---------- Home page: send the claim to the verifier ----------
  var homeBtn = document.querySelector('[data-verify-home]');
  if (homeBtn) {
    homeBtn.addEventListener('click', function () {
      var ta = document.getElementById('claim');
      var text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      try { sessionStorage.setItem('claim', text); } catch (e) {}
      window.location.href = homeBtn.getAttribute('data-href');
    });
  }

  // ---------- Verifier page ----------
  var verifyBtn = document.getElementById('verifyBtn');
  // The real verifier lives in js/verifier.js; this block is only a fallback if that file is missing.
  if (verifyBtn && !window.MLVerifier) {
    var claim = document.getElementById('claim');
    var empty = document.getElementById('vEmpty');
    var result = document.getElementById('vResult');
    var pasted = document.getElementById('pastedText');

    function showResult(text) {
      pasted.textContent = text;
      empty.style.display = 'none';
      result.classList.add('show');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    verifyBtn.addEventListener('click', function () {
      var text = claim.value.trim();
      if (!text) {
        claim.classList.remove('shake');
        void claim.offsetWidth;
        claim.classList.add('shake');
        claim.focus();
        return;
      }
      showResult(text);
    });

    var saved = null;
    try { saved = sessionStorage.getItem('claim'); sessionStorage.removeItem('claim'); } catch (e) {}
    if (saved) showResult(saved);
  }
})();

// ---------- Scroll reveal: sections fade up as you scroll to them ----------
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('ml-anim');
  var groups = ['.section-title', '.tools .tool-text', '.tools .answer-wrapper', '.tools .meter-card', '.how-it-works .step-card',
    '.educator .resource-card', '.more-wrapper', '.cta-button-wrapper', '.dl-text', '.dl-card', '.step-pill', '.evidence',
    '.team-card', '.sub-intro', '.footer .container', '.tools.prev > .container > .dl-btn'];
  var els = [];
  groups.forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (el) {
      if (el.closest('.v-result') || el.classList.contains('reveal')) return; // the result page animates itself
      var sibs = Array.prototype.filter.call(el.parentNode.children, function (c) { return c.matches(sel); });
      el.style.setProperty('--d', Math.min(sibs.indexOf(el), 5) * 0.09 + 's');
      el.classList.add('reveal');
      els.push(el);
    });
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach(function (el) { io.observe(el); });
})();
