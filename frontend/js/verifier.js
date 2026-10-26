/* MedicaLogic - Claim Verifier page logic (English + Arabic).
 * - Sends the claim to the backend (POST /api/verify) and fills the Answer Card + Manipulation Meter.
 * - Saves every checked claim in this browser (Recent Chats), with Search Chats to filter them.
 * - "download report" saves the current answer as a text file.
 * Backend address: change API_BASE below if the server runs somewhere else.
 */
(function () {
  var API_BASE = window.MEDICALOGIC_API || 'http://localhost:5000';
  var HISTORY_KEY = 'medicalogic_history_v1';
  var MAX_HISTORY = 30;

  var lang = (document.documentElement.lang || 'en').slice(0, 2) === 'ar' ? 'ar' : 'en';
  var T = {
    en: {
      verifying: 'Verifying…', verify: 'Verify Claim', wait: 'Checking PubMed and MedlinePlus… This can take up to 20 seconds.',
      verdicts: { Supported: 'Supported by evidence', Refuted: 'Not supported by evidence', Divergent: 'Divergent / Evolving Evidence', Insufficient: 'Insufficient verified evidence' },
      summary: 'Summary', trueP: 'a. What’s true', overP: 'b. What’s overstated', none: 'Nothing to add here.',
      noSources: 'No verified sources were found for this claim.', direct: 'Direct', indirect: 'Indirect',
      fromDb: 'Answered from the MedicaLogic research database', fromLive: 'Answered from a live PubMed search', fromNone: 'Not enough verified research found',
      risk: 'Risk level', advice: 'What to do instead', checked: 'Evidence last checked', newChat: 'New Claim',
      noChats: 'No chats yet', searchPh: 'Search your chats…', clear: 'Clear history', clearQ: 'Delete all saved chats on this device?',
      errNet: "Can't reach the MedicaLogic server. Make sure it is running (node server.js) and try again.",
      reportTitle: 'MedicaLogic report', claim: 'Claim', verdict: 'Verdict', sources: 'Sources', meter: 'Emotional Manipulation Meter', tags: 'Tags', generated: 'Generated',
      dots: ['Supported', 'Divergent / evolving', 'Not supported'], more: 'Learn more',
    },
    ar: {
      verifying: 'جارٍ التحقق…', verify: 'تحقق من الادعاء', wait: 'نبحث في PubMed وMedlinePlus… قد يستغرق ذلك حتى 20 ثانية.',
      verdicts: { Supported: 'مدعوم بالأدلة', Refuted: 'غير مدعوم بالأدلة', Divergent: 'أدلة متضاربة', Insufficient: 'أدلة موثّقة غير كافية' },
      summary: 'الملخص', trueP: 'أ. ما هو صحيح', overP: 'ب. ما هو مبالغ فيه', none: 'لا شيء لإضافته هنا.',
      noSources: 'لم يتم العثور على مصادر موثّقة لهذا الادعاء.', direct: 'مباشر', indirect: 'غير مباشر',
      fromDb: 'الإجابة من قاعدة بيانات MedicaLogic البحثية', fromLive: 'الإجابة من بحث مباشر في PubMed', fromNone: 'لم نجد أبحاثاً موثّقة كافية',
      risk: 'مستوى الخطورة', advice: 'ماذا تفعل بدلاً من ذلك', checked: 'آخر تحقق من الأدلة', newChat: 'ادعاء جديد',
      noChats: 'لا توجد محادثات بعد', searchPh: 'ابحث في محادثاتك…', clear: 'مسح السجل', clearQ: 'حذف جميع المحادثات المحفوظة على هذا الجهاز؟',
      errNet: 'تعذّر الوصول إلى خادم MedicaLogic. تأكد من تشغيله ثم حاول مرة أخرى.',
      errors: {
        QUERY_TOO_SHORT: 'اكتب ادعاءً صحياً (3 أحرف على الأقل).',
        QUERY_TOO_LONG: 'يجب ألا يتجاوز الادعاء أو النص 2000 حرف.',
        RATE_LIMITED: 'طلبات كثيرة خلال وقت قصير. انتظر قليلاً ثم حاول مرة أخرى.',
        AI_UNAVAILABLE: 'خدمة الذكاء الاصطناعي لا تستجيب الآن. حاول مرة أخرى.',
        BAD_MODEL_OUTPUT: 'أعاد الذكاء الاصطناعي إجابة غير مفهومة. حاول مرة أخرى.',
        SOURCES_UNAVAILABLE: 'قاعدة PubMed لا تستجيب الآن. حاول مرة أخرى بعد دقيقة.',
        SERVER_ERROR: 'حدث خطأ في الخادم. حاول مرة أخرى.',
      },
      reportTitle: 'تقرير MedicaLogic', claim: 'الادعاء', verdict: 'الحكم', sources: 'المصادر', meter: 'مقياس التلاعب العاطفي', tags: 'الوسوم', generated: 'تاريخ التقرير',
      dots: ['مدعوم', 'أدلة متضاربة', 'غير مدعوم'], more: 'اعرف المزيد',
    },
  }[lang];

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var claimEl = $('#claim'), verifyBtn = $('#verifyBtn'), empty = $('#vEmpty'), result = $('#vResult'), pasted = $('#pastedText');
  if (!verifyBtn || !claimEl) return;

  var current = null; // { query, data, time }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /** Text for the card. On the Arabic page, English-only text (e.g. our team's curated advice) is shown left-to-right. */
  function txt(s) {
    var e = esc(s);
    return (lang === 'ar' && s && !/[\u0600-\u06FF]/.test(s)) ? '<span dir="ltr" lang="en">' + e + '</span>' : e;
  }
  var RISK_AR = { High: 'مرتفع', Medium: 'متوسط', Low: 'منخفض' };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /** Pasted text with the manipulative words highlighted (<mark>). */
  function highlight(text, m) {
    var words = [];
    if (m && m.matches) ['absolutism', 'fear', 'sensational'].forEach(function (k) { words = words.concat(m.matches[k] || []); });
    var out = esc(text);
    words.sort(function (a, b) { return b.length - a.length; }).forEach(function (w) {
      var safe = esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp('(' + safe + ')', 'gi'), '<mark>$1</mark>');
    });
    return out.replace(/<mark>(<mark>)+/g, '<mark>').replace(/(<\/mark>)+<\/mark>/g, '</mark>');
  }

  // ---------- history (stored only in this browser) ----------
  function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (e) { return []; } }
  function saveHistory(list) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY))); } catch (e) {} }
  function addToHistory(query, data) {
    var list = loadHistory().filter(function (h) { return h.query !== query || h.lang !== lang; });
    list.unshift({ id: Date.now(), query: query, lang: lang, time: new Date().toISOString(), data: data });
    saveHistory(list);
    renderSidebar();
  }

  var sideList = $('.side-list');
  var filterText = '';
  function renderSidebar() {
    if (!sideList) return;
    var items = sideList.querySelectorAll('.side-item:not(.side-new)');
    var searchItem = items[0], recentItem = items[1];
    sideList.querySelectorAll('.side-sub, .side-search, .side-new, .side-clear').forEach(function (n) { n.remove(); });

    var newItem = el('li', 'side-item side-new', '<i class="fa-solid fa-plus"></i> ' + esc(T.newChat));
    newItem.addEventListener('click', function () { resetView(); closeSidebar(); });
    sideList.insertBefore(newItem, searchItem);

    if (searchItem && searchItem.classList.contains('searching')) {
      var box = el('li', 'side-search');
      var input = el('input'); input.type = 'search'; input.placeholder = T.searchPh; input.value = filterText;
      input.addEventListener('input', function () { filterText = input.value; renderChats(); });
      box.appendChild(input);
      searchItem.after(box);
      setTimeout(function () { input.focus(); }, 0);
    }
    renderChats();

    function renderChats() {
      sideList.querySelectorAll('.side-sub, .side-clear').forEach(function (n) { n.remove(); });
      var q = filterText.trim().toLowerCase();
      var list = loadHistory().filter(function (h) { return !q || h.query.toLowerCase().indexOf(q) !== -1; });
      var anchor = recentItem;
      if (!list.length) {
        var none = el('li', 'side-sub muted', esc(T.noChats));
        anchor.after(none);
        return;
      }
      list.slice(0, 15).forEach(function (h) {
        var title = h.query.length > 38 ? h.query.slice(0, 38) + '…' : h.query;
        var li = el('li', 'side-sub' + (current && current.id === h.id ? ' active' : ''), esc(title));
        li.title = h.query;
        li.addEventListener('click', function () {
          claimEl.value = h.query;
          current = { id: h.id, query: h.query, data: h.data, time: h.time };
          render(h.query, h.data);
          renderSidebar();
          closeSidebar();
        });
        anchor.after(li);
        anchor = li;
      });
      var clear = el('li', 'side-sub side-clear', '<i class="fa-solid fa-trash-can"></i> ' + esc(T.clear));
      clear.addEventListener('click', function () {
        if (window.confirm(T.clearQ)) { saveHistory([]); renderSidebar(); }
      });
      anchor.after(clear);
    }
  }
  if (sideList) {
    var firstItem = sideList.querySelector('.side-item:not(.side-new)');
    if (firstItem) firstItem.addEventListener('click', function () {
      firstItem.classList.toggle('searching');
      if (!firstItem.classList.contains('searching')) filterText = '';
      renderSidebar();
    });
  }
  function closeSidebar() {
    var sb = $('#sidebar'), ov = $('#vOverlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.classList.remove('show');
  }

  // ---------- rendering the answer ----------
  function render(query, d) {
    pasted.textContent = query;
    var m = d.manipulation || null;

    // Left blue box: the pasted text with pressure words highlighted
    var claimBox = $('.claim-box p', result);
    if (claimBox) claimBox.innerHTML = highlight(query, m);

    // Verdict + dots (Supported | Divergent | Refuted)
    var card = $('.answer-card', result);
    card.setAttribute('data-verdict', d.verdict);
    $('.card-head h4', card).textContent = T.verdicts[d.verdict] || d.verdict;
    var dots = card.querySelectorAll('.dots span');
    var idx = { Supported: 0, Divergent: 1, Refuted: 2 }[d.verdict];
    dots.forEach(function (s, i) { s.classList.toggle('active', i === idx); s.title = T.dots[i] || ''; });

    // Scientific summary
    var boxes = card.querySelectorAll('.blue-box');
    var sumBox = boxes[0], srcBox = boxes[1];
    var source = d.tier === 'curated' ? T.fromDb : d.tier === 'live' ? T.fromLive : T.fromNone;
    var html = '<h5>' + esc(T.summary) + '</h5><p>' + txt(d.summary || T.none) + '</p>' +
      '<h5>' + esc(T.trueP) + '</h5><p>' + txt(d.true_part || T.none) + '</p>' +
      '<h5>' + esc(T.overP) + '</h5><p>' + txt(d.overstated_part || T.none) + '</p>';
    if (d.curated) {
      if (d.curated.risk_level) html += '<h5>' + esc(T.risk) + '</h5><p>' + esc(lang === 'ar' ? (RISK_AR[d.curated.risk_level] || d.curated.risk_level) : d.curated.risk_level) + (d.curated.risk_rationale ? ' · ' + txt(d.curated.risk_rationale) : '') + '</p>';
      if (d.curated.recommended_action) {
        html += '<h5>' + esc(T.advice) + '</h5><p>' + txt(d.curated.recommended_action) +
          (d.curated.advice_source ? ' <a class="src-link" href="' + esc(d.curated.advice_source) + '" target="_blank" rel="noopener">' + esc(T.more) + ' ↗</a>' : '') + '</p>';
      }
    }
    html += '<p class="v-meta">' + esc(source) + ' · ' + esc(T.checked) + ': ' + esc(d.evidence_last_checked || '') + '</p>';
    sumBox.innerHTML = html;

    // Sources and audit trail
    var lines = [];
    (d.consumer_info || []).forEach(function (c) {
      lines.push('<p><a class="src-link" href="' + esc(c.url) + '" target="_blank" rel="noopener">MedlinePlus: ' + esc(c.title) + '</a></p>');
    });
    (d.sources || []).forEach(function (s) {
      lines.push('<p><a class="src-link" href="' + esc(s.url) + '" target="_blank" rel="noopener">PubMed · PMID: ' + esc(s.pmid) +
        ' · ' + esc(s.study_type) + (s.year ? ' · ' + esc(s.year) : '') + ' (' + esc(s.relevance === 'direct' ? T.direct : T.indirect) + ')</a>' +
        '<span class="src-title" dir="ltr">' + esc(s.title) + '</span>' + (s.note ? '<span class="src-note">' + txt(s.note) + '</span>' : '') + '</p>');
    });
    if (!(d.sources || []).length) lines.push('<p>' + esc(T.noSources) + '</p>');
    srcBox.innerHTML = lines.join('');

    // Bottom line: disclaimer
    var v = $('.verdict', card);
    if (v) v.textContent = d.disclaimer || v.textContent;

    // Emotional Manipulation Meter
    var meter = $('.meter-card', result);
    if (meter && m) {
      $('.score', meter).textContent = m.score + '/100';
      meter.setAttribute('data-level', m.level);
      var p = $('p', meter); if (p) p.textContent = m.explanation;
      var tags = $('.tags', meter);
      if (tags) tags.innerHTML = (m.tags || []).map(function (t) { return '<li>' + esc(t.label) + '</li>'; }).join('') || '<li>—</li>';
    }

    empty.style.display = 'none';
    result.classList.add('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetView() {
    current = null;
    result.classList.remove('show');
    empty.style.display = '';
    claimEl.value = '';
    setError('');
    renderSidebar();
    claimEl.focus();
  }

  // ---------- talking to the server ----------
  var errBox = el('div', 'v-error');
  verifyBtn.after(errBox);
  function setError(msg) { errBox.textContent = msg; errBox.style.display = msg ? 'block' : 'none'; }
  setError('');

  function setLoading(on) {
    verifyBtn.disabled = on;
    verifyBtn.classList.toggle('loading', on);
    verifyBtn.textContent = on ? T.verifying : T.verify;
    errBox.className = on ? 'v-error v-wait' : 'v-error';
    errBox.textContent = on ? T.wait : '';
    errBox.style.display = on ? 'block' : 'none';
  }

  function verify(text) {
    setLoading(true);
    fetch(API_BASE + '/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text, lang: lang }),
    })
      .then(function (res) { return res.json().catch(function () { return { success: false, error: { message: 'HTTP ' + res.status } }; }); })
      .then(function (data) {
        setLoading(false);
        if (!data.success) {
          var e = data.error || {};
          setError((T.errors && T.errors[e.code]) || e.message || T.errNet);
          return;
        }
        setError('');
        addToHistory(text, data);
        current = { id: loadHistory()[0].id, query: text, data: data, time: new Date().toISOString() };
        render(text, data);
        renderSidebar();
      })
      .catch(function () { setLoading(false); setError(T.errNet); });
  }

  verifyBtn.addEventListener('click', function () {
    var text = claimEl.value.trim();
    if (!text) {
      claimEl.classList.remove('shake'); void claimEl.offsetWidth; claimEl.classList.add('shake'); claimEl.focus();
      return;
    }
    verify(text);
  });
  claimEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) verifyBtn.click();
  });

  // ---------- download report ----------
  var dl = $('.v-report .dl-btn', result);
  if (dl) dl.addEventListener('click', function (e) {
    e.preventDefault();
    if (!current) return;
    var d = current.data, m = d.manipulation || {};
    var rows = [
      T.reportTitle, '='.repeat(40), '',
      T.claim + ': ' + current.query, '',
      T.verdict + ': ' + (T.verdicts[d.verdict] || d.verdict),
      T.summary + ': ' + (d.summary || ''),
      T.trueP + ': ' + (d.true_part || ''),
      T.overP + ': ' + (d.overstated_part || ''), '',
      T.sources + ':',
    ];
    (d.sources || []).forEach(function (s) {
      rows.push('- PMID ' + s.pmid + ' (' + s.study_type + (s.year ? ', ' + s.year : '') + ', ' + (s.relevance === 'direct' ? T.direct : T.indirect) + '): ' + s.title + ' ' + s.url);
      if (s.note) rows.push('    ' + s.note);
    });
    (d.consumer_info || []).forEach(function (c) { rows.push('- MedlinePlus: ' + c.title + ' ' + c.url); });
    if (!(d.sources || []).length) rows.push('- ' + T.noSources);
    rows.push('', T.meter + ': ' + (m.score != null ? m.score + '/100' : '-') + ' ' + (m.explanation || ''));
    rows.push(T.tags + ': ' + ((m.tags || []).map(function (t) { return t.label; }).join(', ') || '-'));
    rows.push('', T.checked + ': ' + (d.evidence_last_checked || ''), T.generated + ': ' + new Date().toLocaleString(), '', d.disclaimer || '');
    var blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'medicalogic-report.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // ---------- start ----------
  renderSidebar();
  var saved = null;
  try { saved = sessionStorage.getItem('claim'); sessionStorage.removeItem('claim'); } catch (e) {}
  if (saved) { claimEl.value = saved; verify(saved); }

  window.MLVerifier = { verify: verify, reset: resetView };
})();
