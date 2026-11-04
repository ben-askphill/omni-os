/* Omni OS — dev fallback. If _ds_bundle.js hasn't been compiled yet, compile component sources in-browser.
   Usage: <script src="ROOT/_ds_bundle.js"></script><script src="ROOT/assets/ds-fallback.js" data-root="ROOT"></script>
   then: omReady(() => { const { Button } = window.OmniOS; ... }) */
(function () {
  var NS = 'OmniOSDesignSystem_a7120f';
  var me = document.currentScript;
  if (!me || !me.hasAttribute('data-root')) return; /* bundled copy or stray include: do nothing */
  var root = (me && me.getAttribute('data-root')) || '.';
  var FILES = [
    'components/core/Kbd.jsx','components/core/Button.jsx','components/core/IconButton.jsx','components/core/Input.jsx','components/core/Status.jsx','components/core/Monogram.jsx',
    'components/forms/Segmented.jsx','components/forms/Toggle.jsx','components/forms/InlineConfirm.jsx','components/forms/SlideToConfirm.jsx','components/forms/Picker.jsx','components/forms/ModelPicker.jsx','components/forms/CheckItem.jsx','components/feedback/Toast.jsx','components/icons/Icon.jsx','components/icons/CrewMark.jsx','components/icons/HarnessMark.jsx',
    'components/brand/OmniMark.jsx','components/brand/OmniLogo.jsx','components/brand/Loader.jsx',
    'components/navigation/Rail.jsx','components/navigation/TabStack.jsx','components/navigation/CommandPalette.jsx',
    'components/thread/ThreadRow.jsx','components/thread/Message.jsx','components/thread/ToolCall.jsx','components/thread/Delegation.jsx','components/thread/CrewReport.jsx','components/thread/ArtifactEmbed.jsx','components/thread/Composer.jsx','components/thread/Handoff.jsx','components/thread/QuestionCard.jsx','components/thread/CloudAgent.jsx',
    'components/panels/Panel.jsx','components/panels/GitHubPanel.jsx','components/panels/UsageMeter.jsx',
    'components/mobile/MoButtons.jsx','components/mobile/MoHeader.jsx','components/mobile/MoSection.jsx','components/mobile/MoThreadRow.jsx','components/mobile/MoList.jsx','components/mobile/MoDecisionCard.jsx',
    'components/mobile/MoTabBar.jsx','components/mobile/MoSheet.jsx','components/mobile/MoComposer.jsx','components/mobile/MoBubble.jsx','components/mobile/MoArtifactCard.jsx','components/mobile/MoToast.jsx'
  ];
  var waiters = [];
  var REQUIRED = ['Segmented', 'Ticks', 'CheckItem', 'InlineConfirm', 'SlideToConfirm', 'Picker', 'ModelPicker', 'EffortPicker', 'Toast', 'Chip', 'ThreadGroup', 'ResultLine', 'SwitchLine', 'HandoffCard', 'HandoffLine', 'DevicePicker', 'QuestionCard', 'CloudAgentCard', 'MoTabBar', 'MoDecisionCard'];
  var ready = !!window[NS] && REQUIRED.every(function (k) { return k in window[NS]; });
  window.omReady = function (cb) { if (ready) cb(window[NS]); else waiters.push(cb); };
  function done() { ready = true; window.OmniOS = window[NS]; waiters.splice(0).forEach(function (cb) { cb(window[NS]); }); }
  if (ready) { window.OmniOS = window[NS]; return; }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  function norm(p) { var out = []; p.split('/').forEach(function (seg) { if (seg === '..') out.pop(); else if (seg !== '.' && seg) out.push(seg); }); return out.join('/'); }
  function dir(p) { return p.split('/').slice(0, -1).join('/'); }
  function start() {
    var B = window.Babel ? Promise.resolve() : loadScript('https://unpkg.com/@babel/standalone@7.29.0/babel.min.js');
    B.then(function () {
      return Promise.all(FILES.map(function (f) { return fetch(root + '/' + f).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) { return [f, t]; }); }));
    }).then(function (pairs) {
      var src = {}, cache = {}, ns = {};
      pairs.forEach(function (p) { if (p[1]) src[p[0]] = p[1]; });
      function req(from, spec) {
        if (spec === 'react') return window.React;
        if (spec === 'react-dom') return window.ReactDOM;
        var p = norm(dir(from) + '/' + spec); if (!/\.jsx$/.test(p)) p += '.jsx';
        return run(p);
      }
      function run(f) {
        if (cache[f]) return cache[f].exports;
        var m = { exports: {} }; cache[f] = m;
        if (!src[f]) return m.exports;
        var code = Babel.transform(src[f], { presets: ['react'], plugins: ['transform-modules-commonjs'], filename: f }).code;
        new Function('exports', 'require', 'module', 'React', code)(m.exports, function (s) { return req(f, s); }, m, window.React);
        return m.exports;
      }
      Object.keys(src).forEach(function (f) { var e = run(f); Object.keys(e).forEach(function (k) { if (/^[A-Z]/.test(k)) ns[k] = e[k]; }); });
      var cur = window[NS]; if (cur && Object.keys(cur).length) { Object.keys(ns).forEach(function (k) { if (!(k in cur)) cur[k] = ns[k]; }); } else { window[NS] = ns; } done();
    }).catch(function (e) { console.error('ds-fallback failed', e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
