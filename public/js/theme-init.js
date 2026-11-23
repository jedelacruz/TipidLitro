// Applied before first paint so dark mode does not flash.
(function () {
  try {
    var t = localStorage.getItem('tl.theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked */ }
})();
