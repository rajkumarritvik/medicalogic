(function () {
  // ---------- Sidebar (verifier page) ----------
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('vOverlay');
  var toggles = [document.getElementById('sidebarToggle'), document.getElementById('menuBtn')];

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
