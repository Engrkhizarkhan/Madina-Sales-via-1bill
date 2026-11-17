/* Recovery applies only before React paints. It never reloads an active counter. */
(function () {
  /*__COUNTER_FALLBACK_HELPER__*/
  var key = 'madina-startup-retry:' + location.pathname;
  var finished = false;
  var retrying = false;
  var timer;
  var observer;
  function onlineUrl() {
    try {
      var preferences = {};
      var auto = localStorage.getItem('madina.autoPrintTickets');
      var paper = localStorage.getItem('madina.ticketPaper');
      if (auto === 'true' || auto === 'false') preferences.autoPrint = auto === 'true';
      preferences.paper = paper;
      return onlineCounterUrlForStartup(location.href, preferences);
    } catch (_) {
      try { return onlineCounterUrlForStartup(location.href); } catch (_) { return null; }
    }
  }
  function tryOnline(href) {
    if (!href || typeof navigator === 'undefined' || navigator.onLine === false || typeof Image === 'undefined') return;
    var image = new Image();
    var ended = false;
    function stop() { ended = true; clearTimeout(deadline); image.onload = null; image.onerror = null; }
    var deadline = setTimeout(stop, 4000);
    image.referrerPolicy = 'no-referrer';
    image.onload = function () { if (!ended && !hasApp()) { stop(); location.assign(href); } else { stop(); } };
    image.onerror = stop;
    image.src = 'https://staff.madinaexpress.duckdns.org/favicon.svg?counter-check=' + Date.now();
  }
  function root() { return document.getElementById('root'); }
  function hasApp() {
    var element = root();
    return element && Array.prototype.some.call(element.children, function (child) {
      return !child.hasAttribute('data-madina-startup');
    });
  }
  function complete() {
    if (finished || !hasApp()) return false;
    finished = true;
    clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener('error', resourceError, true);
    try { sessionStorage.removeItem(key); } catch (_) { /* Storage may be disabled. */ }
    return true;
  }
  function recover() {
    if (finished || retrying || complete()) return;
    retrying = true;
    window.stop();
    var retry = false;
    try {
      retry = sessionStorage.getItem(key) !== '1';
      if (retry) sessionStorage.setItem(key, '1');
    } catch (_) { retry = false; /* Without storage, offer manual retry rather than loop. */ }
    if (retry) { location.reload(); return; }
    clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener('error', resourceError, true);
    var element = root();
    if (!element) return;
    var panel = document.createElement('div');
    panel.setAttribute('data-madina-startup', '');
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'max-width:480px;margin:48px auto;padding:24px;font:16px system-ui,sans-serif;line-height:1.6;color:#173e33;background:white;border:1px solid #d5e1da;border-radius:12px';
    var heading = document.createElement('h2');
    heading.textContent = 'Madina Express could not finish opening';
    var message = document.createElement('p');
    message.textContent = 'A page file did not finish loading. Check your connection, then retry.';
    var button = document.createElement('button');
    button.textContent = 'Try again';
    button.style.cssText = 'padding:10px 16px;background:#175b47;color:white;border:0;border-radius:6px;font:inherit;cursor:pointer';
    button.onclick = function () {
      try { sessionStorage.removeItem(key); } catch (_) { /* Optional storage. */ }
      location.reload();
    };
    panel.append(heading, message, button);
    var online = onlineUrl();
    if (online) {
      var link = document.createElement('a');
      link.href = online; link.textContent = 'Use online counter';
      link.style.cssText = 'display:block;margin-top:16px;color:#175b47';
      panel.append(link);
      message.textContent = 'The local connection did not finish loading. Checking the online counter; internet is required.';
    }
    element.replaceChildren(panel);
    tryOnline(online);
  }
  function resourceError(event) {
    var target = event.target;
    if (target && (target.tagName === 'SCRIPT' && target.type === 'module' ||
      target.tagName === 'LINK' && target.rel === 'stylesheet')) {
      clearTimeout(timer);
      timer = setTimeout(recover, 500);
    }
  }
  observer = new MutationObserver(complete);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('error', resourceError, true);
  timer = setTimeout(recover, 15000);
  complete();
}());
