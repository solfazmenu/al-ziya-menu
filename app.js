'use strict';

(function () {
  var grid = document.getElementById('grid');
  var view = document.getElementById('view-state');
  var inp = document.getElementById('search');
  var clr = document.getElementById('clear-search');
  var rail = document.getElementById('rail');
  var layout = document.getElementById('menu-layout');
  var stickyZone = document.querySelector('.sticky-zone');
  var rng = document.getElementById('price-range');
  var rangeWrap = document.getElementById('price-range-wrap');
  var valEl = document.getElementById('price-value');
  var openBtn = document.getElementById('filter-open');
  var dialog = document.getElementById('filter-dialog');
  var closeBtn = document.getElementById('filter-close');
  var applyBtn = document.getElementById('filter-show');
  var resetBtn = document.getElementById('filter-reset');
  var chipBtn = document.getElementById('filter-chip');
  var chipText = document.getElementById('filter-chip-text');
  var dot = document.getElementById('filter-dot');

  /* Console hygiene: uniform [menu] prefix, warnings/errors only, no log spam */
  function mkLog(consoleFn) {
    return function () {
      consoleFn.apply(console, ['[menu]'].concat([].slice.call(arguments)));
    };
  }
  var logWarn = mkLog(console.warn);
  var logError = mkLog(console.error);

  var cats = [], qry = '', bud = 0, skip = 0, cardSeq = 0;

  var END = ' could not be loaded properly. Please check back soon.';
  var LOAD = 'We could not load the menu. Check your connection and try again.';
  var SOON = 'New menu arriving soon.';
  var NONE = 'No items match your search.';
  var CLR = 'Clear search';
  var BUDGET_CLR = 'Show any price';

  /* Price wording — change these two to reword every price label */
  var LABEL_BASE = 'before SST';
  var LABEL_TOTAL = 'incl. SST';
  var LABEL_BUNGKUS = 'Bungkus';
  /* Addon strings */
  var BASE_BADGE = 'BASE';
  var ADDONS_HEADING = 'ADD YOUR FAVOURITES';
  var START_AT_LABEL = 'START AT';
  var CHOOSE_LABEL = 'Choose your base. Add what you love.';

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text != null) { n.textContent = text; }
    return n;
  }
  function S(v) { return typeof v === 'string' && v.trim().length > 0; }

  /* ---------- validation ---------- */

  function validateItem(raw, catId, index) {
    var reason = !raw || typeof raw !== 'object' ? 'not-an-object'
      : !S(raw.name) ? 'missing-name'
      : typeof raw.price !== 'number' || !isFinite(raw.price) || raw.price < 0 ? 'invalid-price' : '';
    if (reason) {
      logWarn('skipped item', index, catId, reason, raw);
      return null;
    }
    var image = null;
    if (raw.image !== undefined && raw.image !== null) {
      if (S(raw.image)) { image = raw.image; } // verbatim (never fabricate paths)
      else { logWarn('skipped image', raw.name, catId, raw); }
    }
    // harga is the base price; keep it only when the data has a real number.
    // Never recompute it here — the stored value is shown as-is.
    var harga = (typeof raw.harga === 'number' && isFinite(raw.harga) && raw.harga >= 0) ? raw.harga : null;
    if (raw.harga !== undefined && raw.harga !== null && harga === null) {
      logWarn('item without a usable harga shows the total only', raw.name, catId, raw);
    }
    // Optional one-line description; trimmed, capped, never a reason to drop the item.
    var description = null;
    if (raw.description !== undefined && raw.description !== null) {
      if (typeof raw.description === 'string' && raw.description.trim().length > 0) {
        description = raw.description.trim().slice(0, 140);
      } else {
        logWarn('skipped description', raw.name, catId, raw);
      }
    }
    // Optional takeaway price (stored, never computed): kept only when it is a real number.
    var bungkus = (typeof raw.bungkus === 'number' && isFinite(raw.bungkus) && raw.bungkus >= 0) ? raw.bungkus : null;
    var addons = null;
    if (Array.isArray(raw.addons)) {
      addons = raw.addons.filter(function (a) {
        return a && typeof a === 'object' && S(a.name) && typeof a.price === 'number' && isFinite(a.price) && a.price >= 0;
      });
      if (addons.length === 0) { addons = null; }
    }
    return { name: raw.name, price: raw.price, harga: harga, bungkus: bungkus, description: description, addons: addons, image: image };
  }

  function validateData(root) {
    if (!root || typeof root !== 'object' || !Array.isArray(root.categories)) {
      throw Error('schema');
    }
    var out = [];
    root.categories.forEach(function (c, i) {
      if (!c || typeof c !== 'object' || !S(c.id) || !S(c.name)) { logWarn('skipped category', i, c); return; }
      if (!Array.isArray(c.items)) { logWarn('skipped category', c.id, 'items!array', c); return; }
      var sourceCount = c.items.length;
      var items = [];
      c.items.forEach(function (raw, j) {
        var item = validateItem(raw, c.id, j);
        if (item) { items.push(item); } else { skip++; }
      });
      if (sourceCount > 0 && items.length === 0) {
        logWarn('category "' + c.id + '": ' + sourceCount + ' src items, 0 survived validation: not-empty');
      }
      out.push({ id: c.id, name: c.name, items: items, sourceCount: sourceCount });
    });
    return out;
  }

  /* ---------- state rendering ---------- */

  function clearView() {
    grid.innerHTML = '';
    view.innerHTML = '';
    rail.innerHTML = '';
    rail.hidden = true;
    layout.classList.add('no-rail');
    cardSeq = 0;
  }

  function showState(message, buttonLabel, onButton) {
    clearView();
    var wrap = h('div', 'empty-state');
    wrap.setAttribute('role', 'status');
    var icon = h('div', 'empty-icon');
    icon.setAttribute('aria-hidden', 'true');
    wrap.appendChild(icon);
    wrap.appendChild(h('p', 'empty-text', message));
    if (buttonLabel) {
      var btn = h('button', 'state-btn', buttonLabel);
      btn.addEventListener('click', onButton);
      wrap.appendChild(btn);
    }
    view.appendChild(wrap);
  }

  /* ---------- list rendering ---------- */

  function buildRow(item) {
    if (item.addons) {
      var row = h('article', 'row addons-card');
      var baseBlock = h('div', 'base-block');
      var imgWrap = h('div', 'row-img');
      if (item.image) {
        var img = document.createElement('img');
        img.width = 1024; img.height = 1024; img.decoding = 'async';
        if (cardSeq === 0) { img.setAttribute('fetchpriority', 'high'); } else { img.loading = 'lazy'; }
        img.src = item.image; img.alt = item.name;
        if (img.complete) { img.classList.add('loaded'); } else { img.onload = function () { img.classList.add('loaded'); }; }
        imgWrap.appendChild(img);
      }
      cardSeq++;
      var text = h('div', 'row-text');
      text.appendChild(h('span', 'base-badge', BASE_BADGE));
      text.appendChild(h('p', 'row-name', item.name));
      if (item.description) { text.appendChild(h('p', 'row-desc', item.description)); }
      var base = h('p', 'row-price-base');
      base.appendChild(h('span', 'price-amount', 'RM ' + item.harga.toFixed(2)));
      base.appendChild(h('span', 'price-tag', LABEL_BASE));
      text.appendChild(base);
      var total = h('p', 'row-price');
      total.appendChild(h('span', 'price-amount', 'RM ' + item.price.toFixed(2)));
      total.appendChild(h('span', 'price-tag', LABEL_TOTAL));
      text.appendChild(total);
      baseBlock.appendChild(imgWrap);
      baseBlock.appendChild(text);
      row.appendChild(baseBlock);

      row.appendChild(h('p', 'addons-label', ADDONS_HEADING));

      var list = h('ul', 'addon-list');
      list.setAttribute('aria-label', 'Add-ons');
      item.addons.forEach(function (a) {
        var li = h('li', 'addon-row');
        var ltext = h('div', 'addon-text');
        ltext.appendChild(h('p', 'addon-name', a.name));
        if (a.description) { ltext.appendChild(h('p', 'addon-desc', a.description)); }
        li.appendChild(ltext);
        var lprice = h('div', 'addon-price');
        lprice.appendChild(h('p', 'addon-price-base', '+ RM ' + a.harga.toFixed(2) + ' ' + LABEL_BASE));
        lprice.appendChild(h('p', 'addon-price-total', '+ RM ' + a.price.toFixed(2) + ' ' + LABEL_TOTAL));
        li.appendChild(lprice);
        list.appendChild(li);
      });
      row.appendChild(list);

      var footer = h('div', 'addons-footer');
      footer.appendChild(h('p', 'footer-top', START_AT_LABEL + ' RM ' + item.price.toFixed(2) + ' <span class="footer-small">' + LABEL_TOTAL + '</span>'));
      // inject HTML for span... actually keep it clean with appendChild
      var fTop = h('p', 'footer-top', START_AT_LABEL + ' RM ' + item.price.toFixed(2) + ' ');
      fTop.appendChild(h('span', 'footer-small', LABEL_TOTAL));
      footer.appendChild(fTop);
      footer.appendChild(h('p', 'footer-bottom', CHOOSE_LABEL));
      row.appendChild(footer);
      return row;
    }
    var row = h('article', 'row');
    var imgWrap = h('div', 'row-img');
    if (item.image) {
      var img = document.createElement('img');
      img.width = 1024; img.height = 1024; img.decoding = 'async';
      if (cardSeq === 0) { img.setAttribute('fetchpriority', 'high'); } else { img.loading = 'lazy'; }
      img.src = item.image; img.alt = item.name;
      if (img.complete) { img.classList.add('loaded'); } else { img.onload = function () { img.classList.add('loaded'); }; }
      imgWrap.appendChild(img);
    }
    cardSeq++;
    var text = h('div', 'row-text');
    text.appendChild(h('p', 'row-name', item.name));
    if (item.description) { text.appendChild(h('p', 'row-desc', item.description)); }
    if (item.harga !== null && item.harga !== undefined) {
      var base = h('p', 'row-price-base');
      base.appendChild(h('span', 'price-amount', 'RM ' + item.harga.toFixed(2)));
      base.appendChild(h('span', 'price-tag', LABEL_BASE));
      text.appendChild(base);
    }
    var total = h('p', 'row-price');
    total.appendChild(h('span', 'price-amount', 'RM ' + item.price.toFixed(2)));
    total.appendChild(h('span', 'price-tag', LABEL_TOTAL));
    text.appendChild(total);
    if (item.bungkus !== null && item.bungkus !== undefined) {
      var bk = h('p', 'row-price-bungkus');
      bk.appendChild(h('span', 'price-amount', LABEL_BUNGKUS + ' RM ' + item.bungkus.toFixed(2)));
      text.appendChild(bk);
    }
    row.appendChild(imgWrap);
    row.appendChild(text);
    return row;
  }

  function buildHeading(name, count) {
    var head = h('h2', 'group-heading');
    head.appendChild(h('span', 'group-name', name)); // verbatim
    var rule = h('span', 'group-rule');
    rule.setAttribute('aria-hidden', 'true');
    head.appendChild(rule);
    head.appendChild(h('span', 'group-count', String(count)));
    return head;
  }

  function matchesQuery(item) {
    // empty query: indexOf('') === 0 -> true for all (preserves "no filter" semantics)
    return item.name.toLowerCase().indexOf(qry) !== -1;
  }

  function matchesBudget(item) {
    // bud is the slider maximum; at the top of the range every item passes.
    return item.price <= bud;
  }

  function matches(item) {
    return matchesQuery(item) && matchesBudget(item);
  }

  function budgetMessage() {
    var limit = 'RM ' + bud.toFixed(2) + ' ' + LABEL_TOTAL;
    return qry.length > 0
      ? 'No items up to ' + limit + ' match this search.'
      : 'No items up to ' + limit + ' in this view.';
  }

  function render() {
    var anyValid = false, anyRejected = false, visible = [];
    cats.forEach(function (c) {
      if (c.sourceCount > 0 && c.items.length === 0) { anyRejected = true; }
      if (c.items.length > 0) { anyValid = true; }
      var items = c.items.filter(matches);
      if (items.length > 0) { visible.push({ cat: c, items: items }); }
    });
    var matched = visible.reduce(function (n, entry) { return n + entry.items.length; }, 0);
    applyBtn.textContent = 'Show ' + matched + ' items'; // stays right while searching
    if (!anyValid) { showState(anyRejected || skip > 0 ? 'The menu' + END : SOON); return; }
    if (visible.length === 0) {
      if (budgetLimited()) { showState(budgetMessage(), BUDGET_CLR, clearBudget); return; }
      showState(NONE, CLR, clearSearch);
      return;
    }
    clearView();
    buildRail(visible);
    visible.forEach(function (entry) {
      var section = h('section', 'cat-section');
      section.id = 'cat-' + entry.cat.id;
      section.appendChild(buildHeading(entry.cat.name, entry.items.length));
      var rows = h('div', 'rows');
      entry.items.forEach(function (item) { rows.appendChild(buildRow(item)); });
      section.appendChild(rows);
      grid.appendChild(section);
    });
    updateActiveSection(); // spy after a render, count/heading changes included
  }

  /* ---------- category rail ---------- */

  var activeCat = '';

  function stickyHeight() {
    return stickyZone ? stickyZone.getBoundingClientRect().height : 0;
  }

  function measureSticky() {
    document.documentElement.style.setProperty('--sticky-h', Math.round(stickyHeight()) + 'px');
    if (grid.children.length > 0) { updateActiveSection(); }
  }

  function buildRail(visible) {
    rail.innerHTML = '';
    activeCat = '';
    if (visible.length === 0) { return; }
    rail.hidden = false;
    layout.classList.remove('no-rail');
    visible.forEach(function (entry) {
      var btn = h('button', 'rail-item', entry.cat.name); // verbatim
      btn.type = 'button';
      btn.setAttribute('data-cat', entry.cat.id);
      rail.appendChild(btn);
    });
  }

  function setActiveRail(id) {
    if (id === activeCat) { return; }
    activeCat = id;
    var current = null;
    rail.querySelectorAll('.rail-item').forEach(function (btn) {
      var on = btn.getAttribute('data-cat') === id;
      btn.classList.toggle('active', on);
      if (on) { btn.setAttribute('aria-current', 'true'); current = btn; }
      else { btn.removeAttribute('aria-current'); }
    });
    if (current) {
      var top = rail.scrollTop, bottom = top + rail.clientHeight;
      if (current.offsetTop < top) { rail.scrollTop = current.offsetTop - 4; }
      else if (current.offsetTop + current.offsetHeight > bottom) {
        rail.scrollTop = current.offsetTop + current.offsetHeight - rail.clientHeight + 4;
      }
    }
  }

  function updateActiveSection() {
    var sections = grid.querySelectorAll('.cat-section');
    if (sections.length === 0) { return; }
    var threshold = stickyHeight() + 8;
    var current = sections[0];
    Array.prototype.forEach.call(sections, function (sec) {
      if (sec.getBoundingClientRect().top <= threshold + 1) { current = sec; }
    });
    setActiveRail(current.id.replace(/^cat-/, ''));
  }

  var spyRaf = 0;
  window.addEventListener('scroll', function () {
    if (spyRaf) { return; }
    spyRaf = window.requestAnimationFrame(function () { spyRaf = 0; updateActiveSection(); });
  }, { passive: true });
  window.addEventListener('resize', measureSticky);
  if (window.ResizeObserver && stickyZone) {
    new window.ResizeObserver(measureSticky).observe(stickyZone);
  }

  rail.addEventListener('click', function (e) {
    var btn = e.target.closest('.rail-item');
    if (!btn) { return; }
    var section = document.getElementById('cat-' + btn.getAttribute('data-cat'));
    if (!section) { return; }
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: section.getBoundingClientRect().top + window.pageYOffset - stickyHeight() - 8,
      behavior: reduced ? 'auto' : 'smooth'
    });
    btn.focus();
  });

  /* ---------- price slider ---------- */

  var rngMin = 0, rngMax = 1, rafId = 0;

  function priceBounds() {
    var lo = Infinity, hi = -Infinity;
    cats.forEach(function (c) {
      c.items.forEach(function (item) {
        if (item.price < lo) { lo = item.price; }
        if (item.price > hi) { hi = item.price; }
      });
    });
    if (!isFinite(lo)) { return null; }
    // round out to the nearest 0.50 so both ends are reachable
    return {
      min: Math.floor(lo * 2 + 1e-9) / 2,
      max: Math.ceil(hi * 2 - 1e-9) / 2
    };
  }

  function budgetLimited() {
    return bud < rngMax - 1e-9;
  }

  function priceLabel() {
    return budgetLimited() ? 'Up to RM ' + bud.toFixed(2) + ' ' + LABEL_TOTAL : 'Any price';
  }

  function countMatches() {
    var n = 0;
    cats.forEach(function (c) {
      c.items.forEach(function (item) { if (matches(item)) { n++; } });
    });
    return n;
  }

  var wasLimited = null;

  function syncFilterUI() {
    var label = priceLabel();
    var limited = budgetLimited();
    valEl.textContent = label;
    rng.setAttribute('aria-valuetext', label);
    dot.hidden = !limited;
    chipBtn.hidden = !limited;
    if (limited) {
      chipText.textContent = label;
      chipBtn.setAttribute('aria-label', 'Clear price limit (' + label + ')');
    }
    if (limited !== wasLimited) {
      wasLimited = limited;
      measureSticky(); // the active chip changes the sticky bar height
    }
    applyBtn.textContent = 'Show ' + countMatches() + ' items';
  }

  function paintRange() {
    var span = rngMax - rngMin;
    var f = span > 0 ? (bud - rngMin) / span : 1;
    f = Math.min(1, Math.max(0, f));
    rangeWrap.style.setProperty('--f', String(f));
    syncFilterUI();
  }

  function scheduleRangeUpdate() {
    if (rafId) { return; }
    rafId = window.requestAnimationFrame(function () {
      rafId = 0;
      var next = parseFloat(rng.value);
      if (!isFinite(next) || next === bud) { return; }
      bud = next;
      paintRange();
      render(); // category and search preserved while dragging
    });
  }

  rng.addEventListener('input', scheduleRangeUpdate);

  function initRange() {
    var b = priceBounds();
    if (!b) {
      rng.disabled = true;
      valEl.textContent = 'No prices';
      rng.setAttribute('aria-valuetext', 'No prices');
      return;
    }
    rngMin = b.min;
    rngMax = b.max;
    rng.min = String(rngMin);
    rng.max = String(rngMax);
    rng.step = '0.5';
    rng.value = String(rngMax);
    bud = rngMax;
    paintRange();
  }

  function clearBudget() {
    if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
    rng.value = String(rngMax);
    bud = rngMax;
    paintRange();
    render();
    if (dialog && dialog.open) { rng.focus(); }
    else { openBtn.focus(); }
  }

  /* ---------- filter sheet ---------- */

  function openFilters() {
    if (!dialog || typeof dialog.showModal !== 'function') { return; }
    if (dialog.open) { return; }
    dialog.showModal();
    openBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('is-locked');
    syncFilterUI(); // refresh the live count for the current search/category
  }

  function closeFilters() {
    if (dialog && dialog.open) { dialog.close(); }
  }

  openBtn.addEventListener('click', openFilters);
  closeBtn.addEventListener('click', closeFilters);
  applyBtn.addEventListener('click', closeFilters);
  chipBtn.addEventListener('click', clearBudget);
  resetBtn.addEventListener('click', function () {
    rng.value = String(rngMax);
    bud = rngMax;
    paintRange();
    render(); // sheet stays open; the list behind updates
    rng.focus();
  });
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) { closeFilters(); } // backdrop click
  });
  dialog.addEventListener('close', function () {
    openBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('is-locked');
    openBtn.focus(); // focus returns to the icon
  });

  /* ---------- search ---------- */

  function clearSearch() {
    inp.value = '';
    qry = '';
    clr.hidden = true;
    inp.focus(); // return focus to the input after clearing
    render();
  }

  inp.addEventListener('input', function () {
    qry = inp.value.trim().toLowerCase();
    clr.hidden = !qry;
    render();
  });

  clr.addEventListener('click', clearSearch);

  /* ---------- boot ---------- */

  fetch('menu.json')
    .then(function (res) {
      if (!res.ok) { throw Error(res.status); }
      return res.json(); // throws on malformed JSON -> caught below
    })
    .then(function (root) {
      cats = validateData(root);
      initRange();
      render();
    })
    .catch(function (err) {
      logError('failed to load:', err);
      showState(LOAD, 'Retry', function () { window.location.reload(); });
    });
})();
