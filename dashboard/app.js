// Compass dashboard: renders window.COMPASS (../data.js, written by main.ts
// from the same board as board.json). Fully offline; no fetch, no imports.
(function () {
  var D = window.COMPASS;
  if (!D) return;
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) {
    if (n === null || n === undefined) return '—';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  };
  var pct = function (n) { return n === null || n === undefined ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; };
  var esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // Header stats, straight from the data the program wrote.
  var stats = [
    [D.board_size, 'protocols ranked'],
    [D.watchlist_size, 'watchlist covered'],
    [D.peer_size, 'tokenized twins pool'],
    [D.fallback_size, 'priced by fallback'],
    [D.early_size, 'found below the floor'],
  ];
  $('stats').innerHTML = stats.map(function (s) {
    return '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>';
  }).join('');
  $('asof').textContent = D.as_of;

  // Category filter options from the board itself.
  var cats = [];
  D.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');

  var watchlistOnly = false;
  // Each row carries its own watch flag from the program (the snapshot's list).
  function isWatch(r) { return r.watch === true; }

  function visibleRows() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value;
    return D.rows.filter(function (r) {
      if (watchlistOnly && !isWatch(r)) return false;
      if (cat && r.category !== cat) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function renderBoard() {
    var rows = visibleRows();
    $('count').textContent = rows.length + ' of ' + D.board_size + ' rows';
    $('rows').innerHTML = rows.map(function (r) {
      var badge = r.priced_by === 'category-fallback'
        ? '<span class="badge fb">fallback</span>'
        : '<span class="badge">' + r.twin_count + ' twins</span>';
      return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + badge + '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + fmt(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + (r.twin_count || '—') + '</td>' +
        '<td class="num">' + (r.nearest_distance === null ? '—' : r.nearest_distance.toFixed(2)) + '</td>' +
        '<td class="num">' + r.multiple.toFixed(3) + '×</td>' +
        '<td class="num"><b>' + fmt(r.implied_value_usd) + '</b></td></tr>';
    }).join('');
    var trs = $('rows').querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { location.hash = 'p=' + this.getAttribute('data-slug'); });
    }
  }

  function renderDetail(slug) {
    var box = $('detail');
    var r = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) r = D.rows[i];
    if (!r) { box.innerHTML = ''; return; }
    var twinRows = r.twins.map(function (t) {
      return '<tr><td><span class="name">' + esc(t.name) + '</span><br><span class="slug">' + esc(t.slug) + '</span></td>' +
        '<td>' + esc(t.category || '—') + '</td><td class="num">' + fmt(t.tvl_usd) + '</td>' +
        '<td class="num">' + fmt(t.mcap_usd) + '</td><td class="num">' + t.multiple.toFixed(3) + '×</td>' +
        '<td class="num">' + t.distance.toFixed(2) + '</td></tr>';
    }).join('');
    var twinBlock = r.priced_by === 'twins'
      ? '<h3>Its ' + r.twins.length + ' nearest twins</h3><table class="twins"><thead><tr><th>Twin</th><th>Category</th><th>TVL</th><th>Market cap</th><th>Multiple</th><th>Distance</th></tr></thead><tbody>' + twinRows + '</tbody></table>' +
        '<p>Median twin multiple taken: <b>' + r.multiple.toFixed(3) + '×</b>. Nearest twin distance: ' + (r.nearest_distance === null ? '—' : r.nearest_distance.toFixed(2)) + '.</p>'
      : '<h3>Priced by the category fallback</h3><p>Fewer than 4 twins sat within distance 2.5, so this row uses its category median peer multiple, shrunk toward the global median: <b>' + r.multiple.toFixed(3) + '×</b>. Treat the signal as weaker — that is the honest read.</p>';
    box.innerHTML = '<div class="detail-card"><button class="close" id="close-detail" type="button">Close</button>' +
      '<h2>' + esc(r.name) + ' <span class="slug">#' + r.rank + ' · ' + esc(r.slug) + '</span></h2>' +
      '<p>' + esc(r.category || 'No category recorded') + ' · ' + r.chains.map(esc).join(', ') + ' · records no token in this snapshot · age ' + (r.age_days === null ? 'unknown' : r.age_days + ' days') + '</p>' +
      '<p>Implied value <span class="big">' + fmt(r.implied_value_usd) + '</span></p>' +
      '<p>How: TVL ' + fmt(r.tvl_usd) + ' × multiple ' + r.multiple.toFixed(3) + ' × momentum ' + r.momentum_multiplier.toFixed(3) +
      ' × survival ' + r.survival_multiplier.toFixed(3) + ' × breadth ' + r.breadth_multiplier.toFixed(3) + ' = ' + fmt(r.implied_value_usd) + ' (rounded to whole dollars).</p>' +
      twinBlock +
      '<h3>Farm checklist</h3><ol class="farm">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>';
    $('close-detail').addEventListener('click', function () { location.hash = ''; box.innerHTML = ''; });
    box.scrollIntoView({ block: 'nearest' });
  }

  function renderLive() {
    $('live-rows').innerHTML = D.live.map(function (r) {
      return '<tr><td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td><td class="num">' + fmt(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + fmt(r.mcap_usd) + '</td></tr>';
    }).join('');
  }

  function applyHash() {
    var h = location.hash.replace(/^#/, '');
    var parts = h.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0] === 'p' && kv[1]) renderDetail(decodeURIComponent(kv[1]));
      if (kv[0] === 'category' && kv[1]) { $('cat').value = decodeURIComponent(kv[1]); renderBoard(); }
    }
  }

  $('q').addEventListener('input', renderBoard);
  $('cat').addEventListener('change', renderBoard);
  $('watch').addEventListener('change', function () { watchlistOnly = this.checked; renderBoard(); });
  $('tab-board').addEventListener('click', function () {
    $('tab-board').classList.add('active'); $('tab-live').classList.remove('active');
    $('board-view').hidden = false; $('board-controls').style.display = ''; $('live-view').hidden = true;
  });
  $('tab-live').addEventListener('click', function () {
    $('tab-live').classList.add('active'); $('tab-board').classList.remove('active');
    $('board-view').hidden = true; $('board-controls').style.display = 'none'; $('live-view').hidden = false;
  });
  window.addEventListener('hashchange', applyHash);

  renderBoard();
  renderLive();
  applyHash();
})();
