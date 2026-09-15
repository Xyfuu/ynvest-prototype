#!/usr/bin/env python3
"""Generate prototype.html: a self-contained single-file bundle of the YNVEST prototype.

- Extracts each screen's tailwind config (script#tailwind-config) and body.
- Inlines bridge.js once, tagged with __YNVEST_BUNDLED = true.
- Swaps <head> config + <main>/<nav> content on hash navigation, mirroring the
  multi-file setup exactly (same markup, same bridge).
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PAGES = {
    'home': 'home.html',
    'activity': 'activity.html',
    'missions': 'missions.html',
    'for-you': 'marketplace.html',
    'reward-detail': 'reward-detail.html',
}
DEFAULT_REWARD = 'shopping-50k'


def split_page(file: str):
    html = (ROOT / file).read_text(encoding='utf-8')
    config = re.search(r'<script id="tailwind-config">(.*?)</script>', html, re.S).group(1)
    main = re.search(r'<main[^>]*>', html).group(0)
    main_inner = html[html.index(main) + len(main): html.index('</main>')]
    # Extract inline page scripts so the bundle can execute them per navigation.
    scripts = [s[8:-9] for s in re.findall(r'<script>(?:(?!</script>).)*</script>', main_inner, flags=re.S)]
    main_inner = re.sub(r'<script>(?:(?!</script>).)*</script>\s*', '', main_inner, flags=re.S)
    body_open = re.search(r'<body[^>]*>', html).group(0)
    nav = re.search(r'<nav.*?</nav>', html, re.S).group(0)
    return {'config': config, 'main_open': main, 'main': main_inner, 'body_open': body_open, 'nav': nav, 'scripts': scripts}


def esc(s: str) -> str:
    # Escape '</' so embedded </script> can never terminate the outer <script> block.
    return json.dumps(s).replace('</', '<\\/')


def main() -> None:
    pages = {key: split_page(file) for key, file in PAGES.items()}
    bridge = (ROOT / 'bridge.js').read_text(encoding='utf-8')
    # Strip the trailing DOM-ready wrapper; the bundle calls main() itself.
    inner = re.search(r'function main\(\) \{(.*?)\n  \}\n\n  if \(document\.readyState', bridge, re.S).group(1)

    pages_js = []
    for key in PAGES:
        p = pages[key]
        pages_js.append(
            f"'{key}': {{ config: {esc(p['config'])}, bodyOpen: {esc(p['body_open'])}, "
            f"mainOpen: {esc(p['main_open'])}, main: {esc(p['main'])}, nav: {esc(p['nav'])}, "
            f"scripts: [" + ', '.join(esc(s) for s in p['scripts']) + "] }"
        )

    runtime = """
window.__YNVEST_BUNDLED = true;
window.__YNVEST_QUERY = '';
var YPAGES = {__PAGES__};
var current = '';

function parseHash() {
  var h = location.hash.replace(/^#\\/?/, '');
  var parts = h.split('?');
  var route = YPAGES[parts[0]] ? parts[0] : 'home';
  var query = parts[1] || '';
  if (route === 'reward-detail' && !query) query = 'reward=__DEFAULT_REWARD__';
  return { route: route, query: query };
}

function setHead(cfg) {
  var prev = document.getElementById('ypage-config');
  if (prev) prev.remove();
  var s = document.createElement('script');
  s.id = 'ypage-config';
  s.textContent = cfg;
  document.head.appendChild(s);
}

function render() {
  var r = parseHash();
  if (r.route === current) return;
  current = r.route;
  var page = YPAGES[r.route];
  var cls = /<body[^>]*class="([^"]*)"/.exec(page.bodyOpen);
  var phone = document.getElementById('phone');
  if (phone) phone.className = cls ? cls[1] : '';
  var dp = /data-page="([^"]*)"/.exec(page.bodyOpen);
  if (dp) { document.body.setAttribute('data-page', dp[1]); } else { document.body.removeAttribute('data-page'); }
  var main = document.querySelector('main');
  main.outerHTML = page.mainOpen + page.main + '</main>';
  var nav = document.querySelector('nav');
  if (nav) nav.outerHTML = page.nav;
  setHead(page.config);
  window.__YNVEST_QUERY = r.query;
  // Fresh DOM: clear the binding guard, then re-run the bridge + page scripts
  document.body.removeAttribute('data-bridge-page');
  window.__ynvestRunMain();
  (page.scripts || []).forEach(function (src, i) {
    try { new Function(src + String.fromCharCode(10) + "//# sourceURL=page-" + r.route + "-" + i + ".js")(); }
    catch (e) { console.error('page script failed', r.route, i, e); }
  });
  var dots = document.querySelectorAll('.route-dot');
  var order = ['home', 'activity', 'missions', 'for-you', 'reward-detail'];
  var idx = order.indexOf(r.route);
  dots.forEach(function (d, i) { d.classList.toggle('active', i === idx); });
}

window.addEventListener('hashchange', render);
document.querySelectorAll('[data-route]').forEach(function (b) {
  b.addEventListener('click', function () { location.hash = '#/' + b.getAttribute('data-route'); });
});
current = 'home';
window.__ynvestRunMain(); // boot 'home' bindings
current = '';
render(); // renders target route and re-runs the bridge for it
"""

    runtime = runtime.replace('{__PAGES__}', '{\n' + ',\n'.join(pages_js) + '\n}')
    runtime = runtime.replace('__DEFAULT_REWARD__', DEFAULT_REWARD)

    bridge_setup = (
        'window.__YNVEST_BUNDLED = true;\n'
        f'window.__YNVEST_BRIDGE_SOURCE = {esc("function main() {" + inner + "\n}")};\n'
        'window.__ynvestRunMain = function () {\n'
        '  new Function(window.__YNVEST_BRIDGE_SOURCE + "\\nmain();\\n//# sourceURL=bridge.js")();\n'
        '};\n'
    )

    body_open = re.sub(r'<body[^>]*>', '<body>', pages['home']['body_open'])
    routes_nav = """
    <div class="routes">
      <button data-route="home">Home</button>
      <button data-route="activity">Coin Wallet</button>
      <button data-route="missions">Missions</button>
      <button data-route="for-you">Marketplace</button>
    </div>
    <div class="dots">
      <span class="route-dot"></span><span class="route-dot"></span><span class="route-dot"></span>
      <span class="route-dot"></span><span class="route-dot"></span>
    </div>
"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>YNVEST — Interactive Prototype</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet"/>
<script src="https://cdn.tailwindcss.com"></script>
<script id="tailwind-config">{pages['home']['config']}</script>
<style>
  html, body {{ margin: 0; padding: 0; }}
  body {{ background: linear-gradient(160deg, #0b1e3a 0%, #12315e 55%, #0b1e3a 100%); }}
  .phone-stage {{ min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 0 76px; }}
  #phone {{ width: 100%; max-width: 430px; min-height: 100dvh; background: #faf8ff; position: relative; }}
  .routes {{ position: fixed; bottom: 0; left: 0; right: 0; z-index: 60; display: flex; gap: 4px;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px)); justify-content: center;
    background: rgba(7, 15, 30, 0.92); backdrop-filter: blur(10px); }}
  .routes button {{ font: 600 11px/1 'Plus Jakarta Sans', sans-serif; color: #cbd5e1; background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.14); padding: 8px 12px; border-radius: 999px; cursor: pointer; }}
  .routes button:hover {{ background: rgba(255,255,255,0.16); }}
  .dots {{ position: fixed; bottom: calc(52px + env(safe-area-inset-bottom, 0px)); left: 0; right: 0;
    display: flex; gap: 5px; justify-content: center; z-index: 60; }}
  .route-dot {{ width: 6px; height: 6px; border-radius: 999px; background: rgba(255,255,255,0.25); transition: all .2s; }}
  .route-dot.active {{ background: #41befd; width: 16px; }}
</style>
</head>
{body_open}
<div class="phone-stage">
<div id="phone" class="bg-surface font-body-md text-body-md text-on-surface flex flex-col antialiased">
{pages['home']['main_open']}
{pages['home']['main']}
</main>
{pages['home']['nav']}
</div>
</div>
{routes_nav}
<script>
{bridge_setup}
</script>
<script>
{runtime}
</script>
</body>
</html>
"""

    out = ROOT / 'prototype.html'
    out.write_text(html, encoding='utf-8')
    print(f'Wrote {out} ({out.stat().st_size / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
