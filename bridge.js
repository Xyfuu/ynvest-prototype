/* ============================================================
   YNVEST Prototype Bridge
   - Router: makes every [data-path] / [data-go] hook navigate
   - Store: one shared coin wallet (localStorage) synced across pages
   - Helpers: toasts, coin bindings, per-page interactive wiring
   Works both standalone (static server / file://) and bundled
   (single-file prototype.html via document.write).
   ============================================================ */
(function () {
  'use strict';

  function main() {

  var BUNDLED = window.__YNVEST_BUNDLED === true;

  var ROOT = (function () {
    // Directory containing the current page (screens sit flat at root
    // next to bridge.js — '..' would escape one level above the project).
    try { return new URL('./', location.href).href; } catch (e) { return '/'; }
  })();

  /* ---------- Page registry ---------- */
  var PAGES = {
    'home': 'home.html',
    'activity': 'activity.html',
    'for-you': 'marketplace.html',
    'rewards-hub': 'marketplace.html',
    'reward-detail': 'reward-detail.html',
    'missions': 'missions.html'
  };

  var SOON_LABELS = {
    'qris-scanner': 'QRIS Scanner',
    'support-chat': 'Support Chat',
    'notifications': 'Notifications',
    'my-account': 'My Account'
  };

  /* ---------- Reward catalog (shared by marketplace + detail) ---------- */
  var REWARDS = {
    'shopping-50k': { title: 'Rp50K Shopping Voucher (Blibli, Tokopedia & Shopee)', label: 'Rp50K Shopping Voucher', cost: 2500, rp: 'Rp50.000' },
    'kopi-voucher': { title: 'Kopi Kenangan Coffee Voucher — 1 Regular', label: 'Kopi Kenangan Voucher', cost: 1200, rp: 'Rp25.000' },
    'xxi-ticket':   { title: 'XXI Cinema Deluxe Movie Ticket — 1 Pax', label: 'XXI Cinema Ticket', cost: 2000, rp: 'Rp50.000' },
    'map-100k':     { title: 'Rp100K Lifestyle Voucher — MAP Club', label: 'MAP Club Voucher', cost: 4500, rp: 'Rp100.000' },
    'kai-50k':      { title: 'KAI Train Ticket Voucher Rp50K — All Routes', label: 'KAI Train Voucher', cost: 5000, rp: 'Rp50.000' },
    'concert-pass': { title: 'Music Concert & Event Priority Pass', label: 'Concert Priority Pass', cost: 8000, rp: 'Rp250.000' }
  };

  /* ---------- Shared wallet store ---------- */
  var STORE_KEY = 'ynvest-proto-state';
  var memoryStore = null;

  function defaults() {
    return { coins: 2450, earned: 1450, redeemed: 1200, expiring: 350, favs: [], tx: [] };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return memoryStore; }
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { memoryStore = state; }
    renderBindings();
    notifyShell();
  }

  var state = load() || defaults();

  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  function addCoins(n, label) {
    state.coins += n; state.earned += n;
    state.tx.unshift({ dir: 'earned', amount: n, label: label || 'Coin Reward', at: new Date().toISOString() });
    save();
  }

  function spendCoins(n, label) {
    state.coins -= n; state.redeemed += n;
    state.tx.unshift({ dir: 'redeemed', amount: n, label: label || 'Redemption', at: new Date().toISOString() });
    save();
  }

  function toggleFav(id) {
    var i = state.favs.indexOf(id);
    if (i >= 0) state.favs.splice(i, 1); else state.favs.push(id);
    save();
  }

  /* ---------- Live DOM bindings ---------- */
  function renderBindings() {
    document.querySelectorAll('[data-coins-balance]').forEach(function (el) {
      el.textContent = fmt(state.coins) + (el.hasAttribute('data-coins-label') ? ' Coins' : '');
    });
    ['earned', 'redeemed', 'expiring'].forEach(function (k) {
      document.querySelectorAll('[data-stat="' + k + '"]').forEach(function (el) {
        var sign = k === 'redeemed' ? '-' : (k === 'earned' ? '+' : '');
        el.textContent = sign + fmt(state[k]);
      });
    });
  }

  /* ---------- Toast ---------- */
  function toast(msg, icon) {
    var t = document.getElementById('ynvest-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ynvest-toast';
      t.className = 'fixed top-20 left-1/2 -translate-x-1/2 z-[999] bg-primary text-on-primary px-space-lg py-space-sm rounded-full shadow-xl flex items-center gap-space-xs pointer-events-none transition-all duration-300 opacity-0 -translate-y-4';
      t.innerHTML = '<span class="material-symbols-outlined text-secondary-container text-[20px]">info</span>' +
        '<span class="font-label-lg text-label-lg font-bold" id="ynvest-toast-text"></span>';
      document.body.appendChild(t);
    }
    t.querySelector('#ynvest-toast-text').textContent = msg;
    if (icon) t.querySelector('.material-symbols-outlined').textContent = icon;
    // Toggle synchronously so the toast works even in throttled/background contexts
    t.classList.remove('opacity-0', '-translate-y-4');
    t.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(toast._h);
    toast._h = setTimeout(function () {
      t.classList.add('opacity-0', '-translate-y-4');
      t.classList.remove('opacity-100', 'translate-y-0');
    }, 2200);
  }

  /* ---------- Router ---------- */
  function href(path, params) {
    var file = PAGES[path];
    if (!file) return null;
    var url = ROOT + file;
    if (params) url += '?' + Object.keys(params).map(function (k) {
      return k + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return url;
  }

  function go(path, params) {
    if (!PAGES[path]) {
      toast((SOON_LABELS[path] || path) + ' — coming soon in this prototype');
      return;
    }
    var url = href(path, params);
    notifyShell(path, url); // let the shell frame track the route
    if (BUNDLED) {
      // Single-file bundle: navigate via hash route
      var routeKey = path === 'rewards-hub' ? 'for-you' : path;
      var q = params ? Object.keys(params).map(function (k) {
        return k + '=' + encodeURIComponent(params[k]);
      }).join('&') : '';
      location.hash = '#/' + routeKey + (q ? '?' + q : '');
    } else if (window.parent === window) { location.href = url; }
    else { window.parent.postMessage({ type: 'ynvest:navigate', page: path, url: url }, '*'); }
  }

  function notifyShell(page, url) {
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'ynvest:navigated',
        page: page || document.body.getAttribute('data-page') || 'home',
        coins: state.coins,
        url: url || location.href
      }, '*');
    }
  }

  /* ---------- Shell bridge messages ---------- */
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'ynvest:navigate' && d.url && !BUNDLED) location.href = d.url;
  });

  /* ---------- Global delegated click handling (attach once per document) ---------- */
  if (!window.__YNVEST_DELEGATED) {
    window.__YNVEST_DELEGATED = true;
  document.addEventListener('click', function (e) {
    var soonEl = e.target.closest('[data-soon]');
    if (soonEl) {
      if (soonEl.tagName === 'A' && soonEl.getAttribute('href') === '#') e.preventDefault();
      toast(soonEl.getAttribute('data-soon') + ' — coming soon in this prototype');
      return;
    }

    var goEl = e.target.closest('[data-go]');
    if (goEl) {
      if (goEl.tagName === 'A' && goEl.getAttribute('href') === '#') e.preventDefault();
      go(goEl.getAttribute('data-go'));
      return;
    }

    var pathEl = e.target.closest('[data-path]');
    if (pathEl) {
      if (pathEl.tagName === 'A' && pathEl.getAttribute('href') === '#') e.preventDefault();
      go(pathEl.getAttribute('data-path'));
      return;
    }

    var card = e.target.closest('[data-reward-id]');
    if (card && document.body.getAttribute('data-page') === 'marketplace') {
      go('reward-detail', { reward: card.getAttribute('data-reward-id') });
    }
  });
  }

  /* ============================================================
     Page-specific wiring
     ============================================================ */
  var page = document.body.getAttribute('data-page');
  var currentRewardId = 'shopping-50k';

  // Idempotency guard: never bind the same page twice (avoids duplicate listeners)
  if (page && document.body.getAttribute('data-bridge-page') === page) {
    renderBindings();
    return;
  }
  if (page) document.body.setAttribute('data-bridge-page', page);

  /* ----- Coin Wallet / Activity ----- */
  if (page === 'wallet') {
    var viewExpiring = document.getElementById('view-expiring');
    if (viewExpiring) viewExpiring.addEventListener('click', function (e) {
      e.preventDefault();
      var chip = document.querySelector('.filter-chip[data-filter="expiring"]');
      if (chip) chip.click();
    });

    var rulesCard = document.getElementById('coin-rules-card');
    if (rulesCard) rulesCard.addEventListener('click', function () {
      toast('Coins: every Rp 10.000 spent = 10 Coins. Coins expire 12 months after earning.', 'help_center');
    });
  }

  /* ----- Missions ----- */
  if (page === 'missions') {
    document.querySelectorAll('[data-mission]').forEach(function (card) {
      var target = parseInt(card.getAttribute('data-target'), 10);
      var current = parseInt(card.getAttribute('data-current'), 10);
      var reward = parseInt(card.getAttribute('data-reward'), 10);
      var label = card.getAttribute('data-mission');
      var progressLabel = card.querySelector('.mission-progress-label');
      var bar = card.querySelector('.mission-bar');
      var btn = card.querySelector('.mission-btn');

      function render() {
        var pct = Math.round((current / target) * 100);
        if (progressLabel) progressLabel.textContent = current + ' of ' + target + ' completed (' + pct + '%)';
        if (bar) bar.style.width = Math.max(pct, 4) + '%';
        if (!btn) return;
        if (current >= target) {
          btn.className = 'px-space-lg py-2 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-lg text-label-lg font-bold shadow-sm active:scale-95 transition-transform flex items-center gap-1.5 mission-btn';
          btn.innerHTML = '<span>Claim +' + fmt(reward) + ' 🪙</span><span class="material-symbols-outlined text-[16px]">redeem</span>';
        }
      }

      if (btn) btn.addEventListener('click', function () {
        if (current < target) {
          current++;
          toast('Progress updated: ' + current + '/' + target, 'task_alt');
          render();
          if (current >= target) toast('Mission complete! Claim your +' + fmt(reward) + ' Coins', 'celebration');
        } else if (!btn.disabled) {
          addCoins(reward, label + ' mission reward');
          btn.disabled = true;
          btn.className = 'px-space-lg py-2 rounded-full bg-surface-container-highest text-outline font-label-lg text-label-lg font-bold flex items-center gap-1.5 mission-btn cursor-default';
          btn.innerHTML = '<span>Claimed ✓</span>';
          card.classList.add('opacity-75');
          toast('+' + fmt(reward) + ' Coins added to your wallet!', 'savings');
        }
      });

      render();
    });
  }

  /* ----- Marketplace ----- */
  if (page === 'marketplace') {
    var currentCat = 'all';
    var query = '';
    var cards = Array.prototype.slice.call(document.querySelectorAll('#rewards-catalog [data-reward-id]'));

    // favorites from shared store
    cards.forEach(function (c) {
      var id = c.getAttribute('data-reward-id');
      var favBtn = c.querySelector('.favorite-btn');
      if (favBtn && state.favs.indexOf(id) >= 0) {
        favBtn.setAttribute('data-active', 'true');
        favBtn.classList.remove('text-outline');
        favBtn.classList.add('text-error');
        var icon = favBtn.querySelector('.material-symbols-outlined');
        if (icon) icon.style.fontVariationSettings = "'FILL' 1";
      }
    });

    function applyFilter() {
      var visible = 0;
      cards.forEach(function (c) {
        var okCat = currentCat === 'all' || c.getAttribute('data-category') === currentCat;
        var title = (c.querySelector('h4') || {}).textContent || '';
        var okQ = !query || title.toLowerCase().indexOf(query) >= 0;
        var show = okCat && okQ;
        c.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      var empty = document.getElementById('market-empty');
      if (empty) empty.classList.toggle('hidden', visible > 0);
    }

    // real category filtering
    document.querySelectorAll('.category-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        currentCat = chip.getAttribute('data-category');
        applyFilter();
      });
    });

    var viewAll = document.getElementById('view-all-cats');
    if (viewAll) viewAll.addEventListener('click', function (e) {
      e.preventDefault();
      var allChip = document.querySelector('.category-chip[data-category="all"]');
      if (allChip) allChip.click();
    });

    // search filters the catalog
    var searchInput = document.getElementById('marketplace-search');
    if (searchInput) searchInput.addEventListener('input', function (e) {
      query = e.target.value.trim().toLowerCase();
      applyFilter();
    });

    // empty-state note for zero results
    var catalog = document.getElementById('rewards-catalog');
    if (catalog) {
      var emptyDiv = document.createElement('div');
      emptyDiv.id = 'market-empty';
      emptyDiv.className = 'hidden col-span-2 flex-col items-center text-center py-8';
      emptyDiv.innerHTML = '<span class="material-symbols-outlined text-outline text-[36px]">search_off</span>' +
        '<span class="font-title-md text-title-md text-primary font-bold mt-2">No rewards found</span>' +
        '<p class="font-body-md text-body-md text-on-surface-variant">Try another search or category.</p>';
      catalog.after(emptyDiv);
    }

    var exploreBtn = document.getElementById('explore-rewards');
    if (exploreBtn) exploreBtn.addEventListener('click', function () {
      catalog.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    var saveUp = document.getElementById('save-up-coins');
    if (saveUp) saveUp.addEventListener('click', function () { go('missions'); });

    // keep shared favorites in sync
    document.querySelectorAll('.favorite-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var card = btn.closest('[data-reward-id]');
        if (card) toggleFav(card.getAttribute('data-reward-id'));
      });
    });
  }

  /* ----- Reward Detail ----- */
  if (page === 'detail') {
    var queryString = window.__YNVEST_QUERY || location.search.replace(/^\?/, '');
    var params = new URLSearchParams(queryString);
    currentRewardId = params.get('reward') || 'shopping-50k';
    var reward = REWARDS[currentRewardId] || REWARDS['shopping-50k'];

    // Populate from catalog
    var titleEl = document.querySelector('[data-reward-title]');
    if (titleEl) titleEl.textContent = reward.title;
    var heroRp = document.querySelector('[data-reward-rp]');
    if (heroRp) heroRp.textContent = reward.rp;

    document.querySelectorAll('[data-cost-num]').forEach(function (el) { el.textContent = fmt(reward.cost); });
    document.querySelectorAll('[data-modal-cost]').forEach(function (el) { el.textContent = '-' + fmt(reward.cost); });
    document.querySelectorAll('[data-bar-cost]').forEach(function (el) { el.textContent = fmt(reward.cost) + ' Coins'; });
    document.querySelectorAll('[data-btn-cost]').forEach(function (el) { el.textContent = 'Redeem for ' + fmt(reward.cost) + ' Coins'; });
    document.querySelectorAll('[data-break-cost]').forEach(function (el) { el.textContent = '-' + fmt(reward.cost) + ' Coins'; });
    var modalItem = document.querySelector('[data-modal-item]');
    if (modalItem) modalItem.textContent = reward.label;

    // Affordability + live remaining
    function refreshAffordability() {
      var remaining = state.coins - reward.cost;
      var ok = remaining >= 0;
      document.querySelectorAll('[data-remaining]').forEach(function (el) { el.textContent = fmt(remaining); });
      var affordText = document.querySelector('[data-afford]');
      if (affordText) {
        affordText.textContent = ok
          ? 'You have enough Coins to redeem this item!'
          : 'You need ' + fmt(-remaining) + ' more Coins — complete missions to earn them!';
        affordText.classList.toggle('text-secondary', ok);
        affordText.classList.toggle('text-tertiary-container', !ok);
      }
      var affordIcon = document.querySelector('[data-afford-icon]');
      if (affordIcon) {
        affordIcon.classList.toggle('bg-secondary-container', ok);
        affordIcon.classList.toggle('bg-tertiary-fixed', !ok);
      }
      var trigger = document.getElementById('redeemTrigger');
      if (trigger) trigger.setAttribute('data-affordable', ok ? 'true' : 'false');
    }
    refreshAffordability();
    window.addEventListener('ynvest:coins', refreshAffordability);

    // Block the confirm sheet when balance is insufficient (capture phase)
    var trigger = document.getElementById('redeemTrigger');
    if (trigger) trigger.addEventListener('click', function (e) {
      if (trigger.getAttribute('data-affordable') !== 'true') {
        e.stopPropagation();
        var need = reward.cost - state.coins;
        toast('Need ' + fmt(need) + ' more Coins — earn them in Missions!', 'lock');
        go('missions');
      }
    }, true);

    // Real deduction on authorize
    var confirmBtn = document.getElementById('confirmRedeem');
    if (confirmBtn) confirmBtn.addEventListener('click', function () {
      if (state.coins < reward.cost) return;
      spendCoins(reward.cost, reward.label);
      refreshAffordability();
      var barBadge = document.querySelector('[data-bar-badge]');
      if (barBadge) barBadge.textContent = 'Redeemed ✓';
    });
  }

  /* ---------- Boot ---------- */
  renderBindings();
  notifyShell();
  window.addEventListener('ynvest:coins', renderBindings);

  /* Expose a tiny API for console tinkering */
  window.YNVEST = {
    go: go, toast: toast, fmt: fmt,
    addCoins: addCoins, spendCoins: spendCoins,
    get state() { return state; }
  };

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
