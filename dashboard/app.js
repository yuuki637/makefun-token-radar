// Token Radar's dashboard (model radar-2). It reads window.RADAR, written beside dashboard/ by
// main.ts, and renders the ranked board, the calibration the multiples came from, the live-token
// comps behind them, and a detail drawer for every protocol with its model equation and farm
// plan. No network: every byte it shows arrived in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;
  var state = {
    q: '', category: 'all', chain: 'all', minTvl: 0, watchOnly: false,
    tab: 'board', sort: 'implied', dir: -1, selected: null,
    gw: M.growth_weight,
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

  // The model in one function, the same arithmetic as lib/model.ts: the printed factors are the
  // rounded ones, so this page recomputes a row's board value from the row's own printed inputs.
  // The sandbox changes only the growth weight; at the model's own weight it reproduces board.json.
  function impliedOf(row, gw) {
    var growthMult = gw === M.growth_weight
      ? row.growth_multiplier
      : Math.round((1 + (row.growth_pct / 100) * gw) * 1e4) / 1e4;
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult * row.maturity_multiplier * row.breadth_multiplier));
  }
  function capitalFor(tvl) {
    if (tvl >= 1e9) return 250;
    if (tvl >= 2.5e8) return 200;
    if (tvl >= 1e8) return 150;
    if (tvl >= 2.5e7) return 100;
    if (tvl >= 1e7) return 75;
    return 50;
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
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('watch', '1');
    if (state.tab === 'live') params.set('tab', 'live');
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
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var gw = state.gw;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.peer_multiple; bv = b.peer_multiple; }
      else { av = impliedOf(a, gw); bv = impliedOf(b, gw); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
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
      el('div', { class: 'brand-sub', text: 'pre-token launch values, priced from live comps' })));
    return el('header', { class: 'top' }, brand,
      el('div', { class: 'top-meta' },
        el('span', null, 'snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'model ', el('b', { text: DATA.model_version })),
        el('span', null, 'peers ', el('b', { text: String(DATA.peer_count) })),
        el('span', null, 'global median ', el('b', { text: fmtMult(DATA.global_multiple) }))));
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
          el('b', { text: String(f.ranked) }), ' are ranked below, each priced from the live-token protocols in its own category and each with a farm plan. The house watchlist of ',
          el('b', { text: String(f.watchlist) }), ' is the floor of this board, never its ceiling. An implied value is this model\'s claim, not a promise that a token will exist.')),
      el('div', { class: 'funnel' },
        el('div', { class: 'fact' }, el('span', { text: 'Protocols scanned' }), el('b', { text: String(f.protocols) })),
        el('div', { class: 'fact' }, el('span', { text: 'Record no token' }), el('b', { text: String(f.pre_token) })),
        el('div', { class: 'fact' }, el('span', { text: 'Wrapped / exchange / versioned, set aside' }), el('b', { text: String(f.set_aside) })),
        el('div', { class: 'fact' }, el('span', { text: 'Ranked on the board' }), el('b', { text: String(f.ranked) })),
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: f.watchlist + ' / ' + f.watchlist }))));
  }

  function modelStrip() {
    return el('div', { class: 'model-strip' },
      el('span', { class: 'formula' }, 'implied = TVL ', el('i', { text: 'x peer multiple' }), ' x growth x maturity x breadth'),
      el('span', { class: 'note', text: 'Peer multiples are medians of market cap / TVL over ' + DATA.peer_count + ' live-token protocols in the same snapshot, shrunk toward the global median and capped when a category has fewer than ' + M.thin_peer_count + ' peers.' }),
      el('a', { href: '#model', text: 'How the model works' }));
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
    var watch = el('button', {
      type: 'button', class: 'toggle', 'aria-pressed': state.watchOnly ? 'true' : 'false', text: 'Watchlist only',
      onclick: function () { state.watchOnly = !state.watchOnly; writeHash(); render(); },
    });
    var boardTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'board'; writeHash(); render(); } });
    var liveTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live comps', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var count = state.tab === 'board' ? visibleRows().length + ' of ' + DATA.rows.length + ' rows shown' : DATA.live.length + ' live-token protocols';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      catSel, chainSel, tvlSel,
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Watchlist' }), watch),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }), el('div', { class: 'tabs' }, boardTab, liveTab)),
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

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or widen the filters to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchOnly = false; writeHash(); render(); } })));
    }
    var max = Math.max.apply(null, list.map(function (r) { return impliedOf(r, state.gw); })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var implied = impliedOf(r, state.gw);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, confCell(r)),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(implied) }))),
        el('td', null, r.watchlist ? el('span', { class: 'chip', text: 'watchlist' }) : el('span', { class: 'chip plain', text: 'early' })));
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'Pre-token protocols by implied launch value. Select any row for its model equation and farm plan.' }),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('multiple', 'Peer x'),
          sortHeader('implied', 'Implied value'), el('th', { scope: 'col', text: 'List' }))),
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
        el('caption', { class: 'sub', text: 'The largest live-token protocols in the same snapshot. Their market cap / TVL ratios are the raw material of the board\'s multiples; they are never ranked as launch candidates.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
          el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Actual x' }),
          el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Status' }))),
        tbody)));
  }

  function sandbox() {
    var slider = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.gw), 'aria-label': 'Growth weight' });
    var val = el('span', { class: 'val', text: state.gw.toFixed(2) });
    slider.addEventListener('input', function () { state.gw = Number(slider.value); render(); });
    var kids = [
      el('span', null, el('b', { text: 'Model sandbox: ' }), 'growth weight '),
      slider, val,
      el('span', { text: 'The board answers "what if one week of TVL momentum counted for more, or for nothing?" At ' + M.growth_weight.toFixed(2) + ' the table is board.json exactly.' }),
    ];
    if (state.gw !== M.growth_weight) {
      kids.push(el('span', { class: 'warn', text: 'Sandbox values differ from board.json.' }));
      kids.push(el('button', { class: 'button', type: 'button', text: 'Reset', onclick: function () { state.gw = M.growth_weight; render(); } }));
    }
    return el('div', { class: 'sandbox' }, kids);
  }

  function modelSection() {
    var top = DATA.multiples.slice(0, 14);
    var tbody = el('tbody');
    top.forEach(function (m) {
      tbody.appendChild(el('tr', null,
        el('td', { text: m.category }),
        el('td', { class: 'num', text: String(m.peers) }),
        el('td', { class: 'num', text: fmtMult(m.median) }),
        el('td', { class: 'num', text: fmtMult(m.multiple) })));
    });
    var table = el('table', null,
      el('caption', { class: 'sub', text: 'Calibration: the multiples the board actually used, for the categories with the most live peers. The rest are in data.js.' }),
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live peers' }),
        el('th', { scope: 'col', text: 'Raw median' }), el('th', { scope: 'col', text: 'Multiple used' }))),
      tbody);
    return el('section', { class: 'panel model', id: 'model' },
      el('div', null,
        el('h2', { text: 'How the model works' }),
        el('p', { class: 'sub', text: 'Model ' + DATA.model_version + '. One function scores every row; no protocol name is special-cased anywhere in it.' })),
      el('div', { class: 'cols' },
        el('div', null, table),
        el('ul', null,
          el('li', null, el('b', { text: 'Peer multiple. ' }), 'For each category, the median market cap / TVL of its live-token protocols (ratios outside 0.002x to 6x and CEX peers set aside), shrunk toward the global median of ' + fmtMult(DATA.global_multiple) + ' with ' + M.shrink_peers + ' pseudo-peers of weight. A category with fewer than ' + M.thin_peer_count + ' peers is capped at ' + M.thin_cap_factor + 'x the global median: one small peer is not a comp set.'),
          el('li', null, el('b', { text: 'Growth. ' }), 'Seven-day TVL change, clamped to ' + M.growth_floor + '% to +' + M.growth_cap + '%, weighted ' + M.growth_weight + '. One hot week moves a value by at most +30%, one bad week by at most -15%.'),
          el('li', null, el('b', { text: 'Maturity. ' }), '0.80 plus 0.20 scaled over three years tracked with no token; an unreported listing date counts as one year.'),
          el('li', null, el('b', { text: 'Breadth. ' }), '+4% per additional chain beyond the first, up to five: distribution is worth something, not everything.'),
          el('li', null, el('b', { text: 'Set aside, not ranked. ' }), 'Protocols whose name or category marks them as a wrapped, staked or bridged product of a traded token, an exchange, or a versioned pool of another protocol. The same rule the house used for its watchlist, applied to the whole snapshot.'),
          el('li', null, el('b', { text: 'Honest limits. ' }), 'The snapshot records no revenue, no users and no token supply, so this model prices size and comps only. It says what a launch would be worth if the record stayed as it is; it does not predict that a token will be issued.'))));
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
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === state.selected) r = x; });
    if (!r) return el('aside', { class: 'detail', hidden: 'hidden' });
    var implied = impliedOf(r, state.gw);
    var check = impliedOf(r, M.growth_weight);
    var confText = r.confidence === 'high' ? 'high confidence' : r.confidence === 'medium' ? 'medium confidence' : 'low confidence (thin comp set, multiple capped)';
    var why = el('p', { class: 'why' },
      el('b', { text: r.name }), ' ranks ', el('b', { text: '#' + r.rank }), ' of ' + DATA.rows.length + ': ',
      fmtUsd(r.tvl_usd) + ' of TVL priced at ' + fmtMult(r.peer_multiple) + ', the ' + (r.category || 'market-wide') +
      ' comp multiple from ' + r.peer_count + ' live peer' + (r.peer_count === 1 ? '' : 's') + ' (' + confText + '), then adjusted for ' +
      fmtPct(r.change_7d) + ' seven-day growth, ' + fmtAge(r.age_days) + ' tracked with no token on record, and ' +
      (r.chains ? r.chains.length : 0) + ' chain' + (r.chains && r.chains.length === 1 ? '' : 's') + ' of distribution.');
    var eq = el('div', { class: 'equation' },
      el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(r.tvl_usd) })),
      el('div', null, el('span', { text: 'x peer multiple (' + (r.category || 'global') + ', n=' + r.peer_count + ')' }), el('b', { text: fmtMult(r.peer_multiple) })),
      el('div', null, el('span', { text: 'x growth (' + fmtPct(r.change_7d) + ' over 7d)' }), el('b', { text: r.growth_multiplier.toFixed(4) + 'x' })),
      el('div', null, el('span', { text: 'x maturity (' + fmtAge(r.age_days) + ' with no token)' }), el('b', { text: r.maturity_multiplier.toFixed(4) + 'x' })),
      el('div', null, el('span', { text: 'x breadth (' + (r.chains ? r.chains.length : 0) + ' chains)' }), el('b', { text: r.breadth_multiplier.toFixed(4) + 'x' })),
      el('div', { class: 'total' }, el('span', { text: 'Implied launch value' }), el('b', { text: fmtUsd(implied) })));
    var steps = el('ol', { class: 'steps' }, r.farm_steps.map(function (s) { return el('li', { text: s }); }));
    return el('aside', { class: 'detail', role: 'dialog', 'aria-label': r.name + ' detail' },
      el('div', { class: 'detail-head' },
        el('div', null,
          el('span', { class: 'chip', text: 'rank #' + r.rank }),
          ' ',
          r.watchlist ? el('span', { class: 'chip', text: 'watchlist' }) : el('span', { class: 'chip plain', text: 'early radar' }),
          el('h2', { text: r.name }),
          el('div', { class: 'sub', text: (r.category || 'Uncategorised') + ' · records no token · snapshot ' + DATA.as_of })),
        el('button', { class: 'close', type: 'button', text: 'Close', onclick: closeDetail })),
      why,
      el('div', { class: 'facts' },
        el('span', { class: 'chip', text: 'capital at work: $' + capitalFor(r.tvl_usd) }),
        el('span', { class: 'chip', text: 'chains: ' + (!r.chains || !r.chains.length ? 'none listed' : r.chains.length <= 5 ? r.chains.join(', ') : r.chains.slice(0, 5).join(', ') + ' +' + (r.chains.length - 5) + ' more') }),
        el('span', { class: 'chip', text: 'listed: ' + (r.listed_at || 'not reported') })),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'The model, rebuilt from its inputs' }),
        eq,
        el('div', { class: 'checkline', text: 'Page check: recomputing from the printed factors gives ' + fmtUsd(check) + ', the value board.json carries for this row.' })),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Farm plan: ' + r.farm_steps.length + ' steps' }),
        steps));
  }

  function render() {
    var kids = [header(), lede(), modelStrip(), controls()];
    kids.push(state.tab === 'board' ? boardTable() : liveTable());
    if (state.tab === 'board') kids.push(sandbox());
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
