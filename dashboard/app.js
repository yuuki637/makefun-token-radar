// Token Radar's dashboard (model radar-3). It reads window.RADAR, written beside dashboard/ by
// main.ts, and renders the ranked board, the fitted curve and the blind test that chose it, the
// live-token comps behind the fit, a coverage view that accounts for every protocol in the
// snapshot, and a detail drawer for every protocol with its model equation, value band, farm
// economics and farm plan. No network: every byte it shows arrived in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;
  var V = DATA.validation;
  var state = {
    q: '', category: 'all', chain: 'all', minTvl: 0, watchOnly: false, verdict: 'all',
    tab: 'board', sort: 'implied', dir: -1, selected: null, compare: [],
  };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n === null || n === undefined ? 'n/a' : n.toFixed(3) + 'x'; }
  function fmtFactor(n) { return 'x/' + n.toFixed(2); }

  // The page check, the same arithmetic as lib/model.ts: the printed multiple is the rounded
  // one, so TVL x that multiple is the row's board value, up to the final dollar rounding.
  function checkOf(row) { return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple)); }
  function capitalFor(tvl) {
    if (tvl >= 1e9) return 1000;
    if (tvl >= 2.5e8) return 750;
    if (tvl >= 1e8) return 500;
    if (tvl >= 2.5e7) return 300;
    if (tvl >= 1e7) return 200;
    return 100;
  }
  function rowBySlug(slug) {
    var found = null;
    DATA.rows.forEach(function (x) { if (x.slug === slug) found = x; });
    return found;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('v')) state.verdict = params.get('v');
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('tab') === 'live' || params.get('tab') === 'coverage') state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('v', state.verdict);
    if (state.watchOnly) params.set('watch', '1');
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && r.farm_economics.verdict !== state.verdict) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  var VERDICT_ORDER = { farm: 0, thin: 1, skip: 2 };
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.peer_multiple; bv = b.peer_multiple; }
      else if (key === 'verdict') { av = VERDICT_ORDER[a.farm_economics.verdict]; bv = VERDICT_ORDER[b.farm_economics.verdict]; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      if (key === 'verdict' && a.implied_value_usd !== b.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  var RINGS = '<svg class="rings" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">' +
    '<circle cx="20" cy="20" r="18" fill="none" stroke="#223041" stroke-width="1.5"/>' +
    '<circle cx="20" cy="20" r="12" fill="none" stroke="#223041" stroke-width="1.5"/>' +
    '<circle cx="20" cy="20" r="6" fill="none" stroke="#223041" stroke-width="1.5"/>' +
    '<path d="M20 20 L20 2 A18 18 0 0 1 35.6 11 Z" fill="#2fe6c8" opacity="0.35"/>' +
    '<circle cx="29" cy="13" r="2.4" fill="#2fe6c8"/><circle cx="20" cy="20" r="2" fill="#e9eff6"/></svg>';

  function header() {
    var brand = el('div', { class: 'brand' });
    brand.innerHTML = RINGS;
    brand.appendChild(el('div', null,
      el('div', { class: 'brand-name', text: 'TOKEN RADAR' }),
      el('div', { class: 'brand-sub', text: 'pre-token launch values, priced by a curve fitted to live comps' })));
    return el('header', { class: 'top' }, brand,
      el('div', { class: 'top-meta' },
        el('span', null, 'snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'model ', el('b', { text: DATA.model_version })),
        el('span', null, 'peers ', el('b', { text: String(DATA.peer_count) })),
        el('span', null, 'curve slope ', el('b', { text: DATA.curve.b.toFixed(4) }))));
  }

  function lede() {
    var f = DATA.funnel;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Every protocol with no token on record, ranked by what its launch would be worth' }),
        el('p', null,
          'The snapshot holds ', el('b', { text: String(f.protocols) }), ' protocols. ',
          el('b', { text: String(f.pre_token) }), ' record no token; ', el('b', { text: String(f.set_aside) }),
          ' of those are set aside as wrapped, staked or bridged products of a token that already trades, an exchange, or a versioned pool. The remaining ',
          el('b', { text: String(f.ranked) }), ' are ranked below, each priced by a curve fitted to the snapshot\'s own live-token protocols and each with a farm plan whose fees are netted into a verdict. The house watchlist of ',
          el('b', { text: String(f.watchlist) }), ' is the floor of this board, never its ceiling. An implied value is this model\'s claim, not a promise that a token will exist.')),
      el('div', { class: 'funnel' },
        el('div', { class: 'fact' }, el('span', { text: 'Protocols scanned' }), el('b', { text: String(f.protocols) })),
        el('div', { class: 'fact' }, el('span', { text: 'Record no token' }), el('b', { text: String(f.pre_token) })),
        el('div', { class: 'fact' }, el('span', { text: 'Wrapped / exchange / versioned, set aside' }), el('b', { text: String(f.set_aside) })),
        el('div', { class: 'fact' }, el('span', { text: 'Ranked on the board' }), el('b', { text: String(f.ranked) })),
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: f.watchlist + ' / ' + f.watchlist }))));
  }

  function scoreLine(scores, key) {
    var found = null;
    scores.forEach(function (s) { if (s.key === key) found = s; });
    return found;
  }

  function modelStrip() {
    var own = scoreLine(V.scores, 'radar3');
    var flat = scoreLine(V.scores, 'flat');
    var wf = scoreLine(V.walk_forward.scores, 'radar3');
    return el('div', { class: 'model-strip' },
      el('span', { class: 'formula' }, 'implied = TVL ', el('i', { text: 'x curve multiple' }), ' — the multiple falls as TVL grows (slope ' + DATA.curve.b.toFixed(2) + '), shifted by category'),
      el('span', { class: 'note', text: 'Blind test, ' + V.folds + '-fold over ' + V.peers + ' live peers: this curve\'s typical miss is ' + fmtFactor(own.median_factor) + ' (' + own.within_2x_pct.toFixed(1) + '% priced within 2x), walk-forward ' + fmtFactor(wf.median_factor) + '; the flat 0.25x misses by ' + fmtFactor(flat.median_factor) + '.' }),
      el('a', { href: '#model', text: 'How the model works' }));
  }

  function exportCsv() {
    var list = sortedRows(visibleRows());
    var lines = ['rank,name,category,chains,tvl_usd,change_7d_pct,curve_multiple,implied_value_usd,value_low_usd,value_high_usd,verdict,fees_usd,capital_usd'];
    list.forEach(function (r) {
      var cells = [r.rank, r.name, r.category || '', (r.chains || []).join(';'), r.tvl_usd,
        r.change_7d === null ? '' : r.change_7d, r.peer_multiple, r.implied_value_usd,
        r.value_low_usd, r.value_high_usd, r.farm_economics.verdict, r.farm_economics.fees_usd, r.farm_economics.capital_usd];
      lines.push(cells.map(function (c) {
        var s = String(c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(','));
    });
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'token-radar-board.csv' });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function select(id, label, values, current, onchange) {
      var sel = el('select', { id: id, 'aria-label': label },
        values.map(function (v) {
          var o = el('option', { value: v.value, text: v.text });
          if (v.value === current) o.setAttribute('selected', 'selected');
          return o;
        }));
      sel.addEventListener('change', function () { onchange(sel.value); writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), sel);
    }
    var catSel = select('category', 'Category',
      [{ value: 'all', text: 'All categories' }].concat(categories.map(function (c) { return { value: c, text: c }; })),
      state.category, function (v) { state.category = v; });
    var chainSel = select('chain', 'Chain',
      [{ value: 'all', text: 'All chains' }].concat(chains.map(function (c) { return { value: c, text: c }; })),
      state.chain, function (v) { state.chain = v; });
    var tvlSel = select('mintvl', 'Minimum TVL',
      [{ value: '0', text: 'Any TVL' }, { value: '10000000', text: '$10M+' }, { value: '50000000', text: '$50M+ (watchlist floor)' }, { value: '100000000', text: '$100M+' }, { value: '250000000', text: '$250M+' }],
      String(state.minTvl), function (v) { state.minTvl = Number(v); });
    var verdictSel = select('verdict', 'Verdict',
      [{ value: 'all', text: 'All verdicts' }, { value: 'farm', text: 'Farm' }, { value: 'thin', text: 'Thin' }, { value: 'skip', text: 'Skip' }],
      state.verdict, function (v) { state.verdict = v; });
    var watch = el('button', {
      type: 'button', class: 'toggle', 'aria-pressed': state.watchOnly ? 'true' : 'false', text: 'Watchlist only',
      onclick: function () { state.watchOnly = !state.watchOnly; writeHash(); render(); },
    });
    function tabBtn(key, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === key ? 'true' : 'false', text: label, onclick: function () { state.tab = key; writeHash(); render(); } });
    }
    var count = state.tab === 'board' ? visibleRows().length + ' of ' + DATA.rows.length + ' rows shown'
      : state.tab === 'live' ? DATA.live.length + ' live-token protocols'
      : DATA.accounting.set_aside.length + ' set aside, ' + DATA.accounting.tokenized + ' already tokenised';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      catSel, chainSel, tvlSel, verdictSel,
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Watchlist' }), watch),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }),
        el('div', { class: 'tabs' }, tabBtn('board', 'Pre-token board'), tabBtn('live', 'Live comps'), tabBtn('coverage', 'Coverage'))),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Export' }),
        el('button', { type: 'button', class: 'toggle', text: 'CSV', onclick: exportCsv })),
      el('span', { class: 'count', text: count }));
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }

  function confCell(r) {
    var label = r.confidence === 'high' ? 'high' : r.confidence === 'medium' ? 'med' : 'low';
    return el('span', { class: 'conf ' + r.confidence },
      el('span', { class: 'num', text: fmtMult(r.peer_multiple) }),
      el('small', { text: ' n=' + r.peer_count + ' ' + label }));
  }

  function verdictChip(r) {
    var v = r.farm_economics.verdict;
    return el('span', { class: 'verdict ' + v, text: v.toUpperCase() });
  }

  function toggleCompare(slug) {
    var at = state.compare.indexOf(slug);
    if (at >= 0) state.compare.splice(at, 1);
    else {
      state.compare.push(slug);
      if (state.compare.length > 2) state.compare.shift();
    }
    render();
  }

  function compareBar() {
    if (state.compare.length === 0) return null;
    var cards = state.compare.map(function (slug) {
      var r = rowBySlug(slug);
      if (!r) return null;
      return el('div', { class: 'cmp-card' },
        el('div', { class: 'cmp-head' },
          el('b', { text: '#' + r.rank + ' ' + r.name }),
          el('button', { type: 'button', class: 'pin on', text: 'pinned', onclick: function () { toggleCompare(slug); } })),
        el('div', { class: 'cmp-grid' },
          el('span', null, 'TVL ', el('b', { text: fmtUsd(r.tvl_usd) })),
          el('span', null, 'curve x ', el('b', { text: fmtMult(r.peer_multiple) })),
          el('span', null, 'implied ', el('b', { text: fmtUsd(r.implied_value_usd) })),
          el('span', null, 'band ', el('b', { text: fmtUsd(r.value_low_usd) + ' – ' + fmtUsd(r.value_high_usd) })),
          el('span', null, 'fees ', el('b', { text: '$' + r.farm_economics.fees_usd + ' (' + r.farm_economics.fee_load_pct.toFixed(1) + '%)' })),
          el('span', null, 'verdict ', verdictChip(r))));
    });
    var note = null;
    if (state.compare.length === 2) {
      var a = rowBySlug(state.compare[0]);
      var b = rowBySlug(state.compare[1]);
      if (a && b) {
        note = el('p', { class: 'cmp-note', text: a.name + ' prices at ' + (a.implied_value_usd / b.implied_value_usd).toFixed(2) + 'x ' + b.name + ' on ' + (a.tvl_usd / b.tvl_usd).toFixed(2) + 'x its TVL: the curve pays the smaller book a richer multiple, and the categories shift it the rest of the way.' });
      }
    }
    return el('div', { class: 'comparebar' },
      el('span', { class: 'lab', text: 'Compare' }), cards, note,
      el('button', { type: 'button', class: 'button', text: 'Clear', onclick: function () { state.compare = []; render(); } }));
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or widen the filters to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchOnly = false; state.verdict = 'all'; writeHash(); render(); } })));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var pinned = state.compare.indexOf(r.slug) >= 0;
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub' },
            (r.category || 'Uncategorised') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') + '  ',
            el('button', { type: 'button', class: 'pin' + (pinned ? ' on' : ''), text: pinned ? 'pinned' : 'compare',
              onclick: function (e) { e.stopPropagation(); toggleCompare(r.slug); } })))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, confCell(r)),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))),
        el('td', null, verdictChip(r)),
        el('td', null, r.watchlist ? el('span', { class: 'chip', text: 'watchlist' }) : el('span', { class: 'chip plain', text: 'early' })));
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'Pre-token protocols by implied launch value. Select any row for its model equation, value band and farm plan; pin two rows to compare them.' }),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('multiple', 'Curve x'),
          sortHeader('implied', 'Implied value'), sortHeader('verdict', 'Verdict'), el('th', { scope: 'col', text: 'List' }))),
        tbody)));
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', null, el('span', { class: 'chip plain', text: 'token trades' }))));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'The largest live-token protocols in the same snapshot. The curve is fitted to all ' + DATA.peer_count + ' of their kind, not only these; they are never ranked as launch candidates.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
          el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Actual x' }),
          el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Status' }))),
        tbody)));
  }

  function coverageView() {
    var f = DATA.funnel;
    var tbody = el('tbody');
    DATA.accounting.set_aside.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: r.category || 'Uncategorised' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'sub', text: r.reason })));
    });
    return el('div', null,
      el('div', { class: 'panel' },
        el('h2', { text: 'Every one of the ' + f.protocols + ' protocols, accounted for' }),
        el('p', { class: 'sub', text: DATA.accounting.tokenized + ' already record a token: they are the comps universe the curve is fitted to, never launch candidates. ' + f.pre_token + ' record no token; ' + f.ranked + ' of those are ranked on the board, and the ' + f.set_aside + ' below are set aside by the watchlist\'s own exclusion rule, each with its reason. Nothing is dropped silently.' })),
      el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Set aside: pre-token protocols that are a product of a token that already trades, an exchange, or a versioned pool.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Why it is set aside' }))),
          tbody))));
  }

  function scoreTable(caption, scores) {
    var tbody = el('tbody');
    scores.forEach(function (s) {
      tbody.appendChild(el('tr', s.key === 'radar3' ? { class: 'own' } : null,
        el('td', { text: s.label }),
        el('td', { class: 'num', text: fmtFactor(s.median_factor) }),
        el('td', { class: 'num', text: s.within_2x_pct.toFixed(1) + '%' })));
    });
    return el('table', null,
      el('caption', { class: 'sub', text: caption }),
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Pricing' }), el('th', { scope: 'col', text: 'Typical miss' }), el('th', { scope: 'col', text: 'Within 2x' }))),
      tbody);
  }

  function modelSection() {
    var top = DATA.offsets.slice(0, 14);
    var tbody = el('tbody');
    top.forEach(function (o) {
      tbody.appendChild(el('tr', null,
        el('td', { text: o.category }),
        el('td', { class: 'num', text: String(o.peers) }),
        el('td', { class: 'num', text: (o.offset > 0 ? '+' : '') + o.offset.toFixed(4) }),
        el('td', { class: 'num', text: fmtMult(o.multiplier) })));
    });
    var offsetsTable = el('table', null,
      el('caption', { class: 'sub', text: 'Category offsets: how far each category\'s live peers sit from the curve, shrunk toward zero. The categories with the most peers are shown; the rest are in data.js.' }),
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live peers' }),
        el('th', { scope: 'col', text: 'Offset (log)' }), el('th', { scope: 'col', text: 'Shift' }))),
      tbody);
    return el('section', { class: 'panel model', id: 'model' },
      el('div', null,
        el('h2', { text: 'How the model works' }),
        el('p', { class: 'sub', text: 'Model ' + DATA.model_version + '. One function scores every row; no protocol name is special-cased anywhere in it.' })),
      el('div', { class: 'cols' },
        el('div', null, offsetsTable),
        el('ul', null,
          el('li', null, el('b', { text: 'The curve. ' }), 'Least squares of log market cap on log TVL over ' + DATA.peer_count + ' live-token protocols (CEX set aside, ratios outside 0.002x to 6x dropped): value = e^' + DATA.curve.a.toFixed(2) + ' x TVL^' + DATA.curve.b.toFixed(4) + '. A slope under 1 means the market pays a smaller multiple the larger a protocol already is; a flat multiple hands the giants value they have never traded at.'),
          el('li', null, el('b', { text: 'Category offsets. ' }), 'Each category\'s peers leave residuals around the curve; their median, shrunk toward zero with ' + M.shrink_peers + ' pseudo-peers of weight, shifts the curve for that category. Lending trades cheap for its size, Derivatives rich; a category with no live peers is priced by the bare curve.'),
          el('li', null, el('b', { text: 'Tested, not asserted. ' }), 'The tables below are recomputed from the snapshot on every run of the entry: a ' + V.folds + '-fold blind test (each peer predicted by a fit that never saw it) and a walk-forward split at ' + V.walk_forward.cutoff + ' (fit on ' + V.walk_forward.train + ' earlier listings, predict ' + V.walk_forward.test + ' later ones).'),
          el('li', null, el('b', { text: 'Terms the test rejected. ' }), 'Growth (7-day TVL change), maturity (age) and breadth (chain count) adjustments were each put through the same blind test on top of the curve and none of them earned its place, so this model does not use them. They are still printed on every row as information, never as price.'),
          el('li', null, el('b', { text: 'Verdicts. ' }), 'Each farm plan nets its own fees: skip when fees would eat over ' + (M.farm_skip_fee_load * 100) + '% of the capital at work, thin when they pass ' + (M.farm_thin_fee_load * 100) + '%, the comp set is thin, or the launch prices under ' + fmtUsd(M.farm_thin_value) + '.'),
          el('li', null, el('b', { text: 'Honest limits. ' }), 'The snapshot records no revenue, no users and no token supply, so this model prices size and comps only. Its own blind test says a typical row is within ' + fmtFactor(V.band_factor) + ' of the mark either way; every row carries that band. It says what a launch would be worth if the record stayed as it is; it does not predict that a token will be issued.'))),
      el('div', { class: 'cols' },
        el('div', null, scoreTable('Blind test: ' + V.folds + '-fold over ' + V.peers + ' live peers. The board\'s pricing is the last row.', V.scores)),
        el('div', null, scoreTable('Walk-forward: fit on peers listed before ' + V.walk_forward.cutoff + ', predict the ' + V.walk_forward.test + ' listed since.', V.walk_forward.scores))));
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Source: ' + DATA.source + '. Snapshot date ' + DATA.as_of + '; the figures do not move after that date.' }),
      el('span', { text: 'This page renders with no network. Every number on it is recomputed from data.js by the code in app.js, and the board it shows is board.json.' }));
  }

  function openDetail(slug) {
    state.selected = slug;
    writeHash();
    render();
    var d = document.querySelector('.detail');
    if (d) d.scrollTop = 0;
  }
  function closeDetail() {
    state.selected = null;
    writeHash();
    render();
  }

  function detail() {
    if (!state.selected) return el('aside', { class: 'detail', hidden: 'hidden' });
    var r = rowBySlug(state.selected);
    if (!r) return el('aside', { class: 'detail', hidden: 'hidden' });
    var econ = r.farm_economics;
    var confText = r.confidence === 'high' ? 'high confidence' : r.confidence === 'medium' ? 'medium confidence' : 'low confidence (thin comp set)';
    var why = el('p', { class: 'why' },
      el('b', { text: r.name }), ' ranks ', el('b', { text: '#' + r.rank }), ' of ' + DATA.rows.length + ': ',
      'at ' + fmtUsd(r.tvl_usd) + ' of TVL the fitted curve\'s base multiple is ' + fmtMult(r.base_multiple) + ', and the ' +
      (r.category || 'market-wide') + ' offset from ' + r.peer_count + ' live peer' + (r.peer_count === 1 ? '' : 's') +
      ' (' + confText + ') shifts it to ' + fmtMult(r.peer_multiple) + '. The blind test\'s typical error puts the launch between ' +
      fmtUsd(r.value_low_usd) + ' and ' + fmtUsd(r.value_high_usd) + '.');
    var eq = el('div', { class: 'equation' },
      el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(r.tvl_usd) })),
      el('div', null, el('span', { text: 'curve base multiple at this TVL (slope ' + DATA.curve.b.toFixed(4) + ')' }), el('b', { text: fmtMult(r.base_multiple) })),
      el('div', null, el('span', { text: 'x category offset (' + (r.category || 'none') + ', n=' + r.peer_count + ')' }), el('b', { text: fmtMult(r.offset_multiplier) })),
      el('div', null, el('span', { text: '= effective multiple' }), el('b', { text: fmtMult(r.peer_multiple) })),
      el('div', { class: 'total' }, el('span', { text: 'Implied launch value' }), el('b', { text: fmtUsd(r.implied_value_usd) })),
      el('div', null, el('span', { text: 'blind-test band (' + fmtFactor(V.band_factor) + ')' }), el('b', { text: fmtUsd(r.value_low_usd) + ' – ' + fmtUsd(r.value_high_usd) })));
    var steps = el('ol', { class: 'steps' }, r.farm_steps.map(function (s) { return el('li', { text: s }); }));
    return el('aside', { class: 'detail', role: 'dialog', 'aria-label': r.name + ' detail' },
      el('div', { class: 'detail-head' },
        el('div', null,
          el('span', { class: 'chip', text: 'rank #' + r.rank }),
          ' ',
          r.watchlist ? el('span', { class: 'chip', text: 'watchlist' }) : el('span', { class: 'chip plain', text: 'early radar' }),
          ' ',
          verdictChip(r),
          el('h2', { text: r.name }),
          el('div', { class: 'sub', text: (r.category || 'Uncategorised') + ' · records no token · snapshot ' + DATA.as_of })),
        el('button', { class: 'close', type: 'button', text: 'Close', onclick: closeDetail })),
      why,
      el('div', { class: 'facts' },
        el('span', { class: 'chip', text: 'capital at work: $' + capitalFor(r.tvl_usd) }),
        el('span', { class: 'chip', text: 'plan fees: $' + econ.fees_usd + ' (' + econ.fee_load_pct.toFixed(1) + '% of capital)' }),
        el('span', { class: 'chip', text: 'hold: ' + econ.hold_days + ' days' }),
        el('span', { class: 'chip', text: 'chains: ' + (!r.chains || !r.chains.length ? 'none listed' : r.chains.length <= 5 ? r.chains.join(', ') : r.chains.slice(0, 5).join(', ') + ' +' + (r.chains.length - 5) + ' more') }),
        el('span', { class: 'chip', text: 'listed: ' + (r.listed_at || 'not reported') })),
      el('p', { class: 'why' }, el('b', { text: 'Verdict ' + econ.verdict.toUpperCase() + ': ' }), econ.verdict_reason + '.'),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'The model, rebuilt from its inputs' }),
        eq,
        el('div', { class: 'checkline', text: 'Page check: TVL x the printed multiple gives ' + fmtUsd(checkOf(r)) + ', the value board.json carries for this row.' })),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Farm plan: ' + r.farm_steps.length + ' steps' }),
        steps));
  }

  function render() {
    var kids = [header(), lede(), modelStrip(), controls()];
    if (state.tab === 'board') {
      var bar = compareBar();
      if (bar) kids.push(bar);
      kids.push(boardTable());
    } else if (state.tab === 'live') {
      kids.push(liveTable());
    } else {
      kids.push(coverageView());
    }
    kids.push(modelSection());
    kids.push(footer());
    kids.push(detail());
    var shell = el('div', { class: 'shell' }, kids);
    app.textContent = '';
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
})();
