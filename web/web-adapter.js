/**
 * 浏览器版 wx 适配层
 * 让 games/<name>/game.js 不改一行代码就能在浏览器 / GitHub Pages 里运行。
 * 只实现了本仓库小游戏用到的 API 子集。
 */
(function () {
  var touchStart = [], touchMove = [], touchEnd = [];
  var mainCanvas = null;
  var down = false;

  function windowInfo() {
    return {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      pixelRatio: window.devicePixelRatio || 1,
      platform: 'web'
    };
  }

  function point(e) {
    return { identifier: e.pointerId || 0, clientX: e.clientX, clientY: e.clientY, pageX: e.clientX, pageY: e.clientY };
  }

  function emit(list, evt) {
    for (var i = 0; i < list.length; i++) list[i](evt);
  }

  window.addEventListener('pointerdown', function (e) {
    down = true;
    var p = point(e);
    emit(touchStart, { touches: [p], changedTouches: [p], timeStamp: e.timeStamp });
  });
  window.addEventListener('pointermove', function (e) {
    if (!down) return;
    var p = point(e);
    emit(touchMove, { touches: [p], changedTouches: [p], timeStamp: e.timeStamp });
  });
  function end(e) {
    if (!down) return;
    down = false;
    var p = point(e);
    emit(touchEnd, { touches: [], changedTouches: [p], timeStamp: e.timeStamp });
  }
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  var PREFIX = 'wxmg:';

  window.wx = {
    getWindowInfo: windowInfo,
    getSystemInfoSync: windowInfo,
    createCanvas: function () {
      var c = document.createElement('canvas');
      if (!mainCanvas) {
        // 第一个 canvas 是上屏 canvas，和微信小游戏行为一致
        mainCanvas = c;
        c.style.cssText = 'position:fixed;left:0;top:0;width:' + window.innerWidth + 'px;height:' +
          window.innerHeight + 'px;touch-action:none;display:block';
        document.body.appendChild(c);
      }
      return c;
    },
    onTouchStart: function (cb) { touchStart.push(cb); },
    onTouchMove: function (cb) { touchMove.push(cb); },
    onTouchEnd: function (cb) { touchEnd.push(cb); },
    getStorageSync: function (key) {
      try {
        var v = localStorage.getItem(PREFIX + key);
        return v == null ? '' : JSON.parse(v);
      } catch (e) { return ''; }
    },
    setStorageSync: function (key, value) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* 隐私模式等情况忽略 */ }
    },
    vibrateShort: function () {
      try {
        var active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
        if (navigator.vibrate && active) navigator.vibrate(12);
      } catch (e) { /* ignore */ }
    },
    createWebAudioContext: function () {
      var AC = window.AudioContext || window.webkitAudioContext;
      return AC ? new AC() : null;
    },
    onHide: function (cb) {
      document.addEventListener('visibilitychange', function () { if (document.hidden) cb(); });
    },
    onShow: function (cb) {
      document.addEventListener('visibilitychange', function () { if (!document.hidden) cb(); });
    },
    showToast: function (opt) { console.log('[toast]', opt && opt.title); },
    showShareMenu: function () {},
    onShareAppMessage: function () {}
  };
})();
