/*
 * Picks the page layout before the first paint.
 *
 * "compact" is the full-screen app layout (canvas fills the screen, the score
 * floats on top). It is used on small screens and always inside an app host
 * such as Reddit (marked with a data-app attribute on <html>).
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var query = window.matchMedia ? window.matchMedia('(max-width: 820px), (max-height: 520px)') : null;

  function update() {
    var compact = root.hasAttribute('data-app') || !!(query && query.matches);
    root.classList.toggle('compact', compact);
  }

  update();
  if (query) {
    if (query.addEventListener) query.addEventListener('change', update);
    else if (query.addListener) query.addListener(update);
  }
})();
