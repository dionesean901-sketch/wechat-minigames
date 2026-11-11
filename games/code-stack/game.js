/**
 * 代码堆 Code Stack —— 微信小游戏（叠层三消）v2
 *
 * 玩法：棋盘上层层叠着"代码块"，只有没被压住的块能点。
 *   点击的块飞进底部 7 格卡槽，凑齐 3 个相同就消除；卡槽塞满就失败，清空棋盘就过关。
 *   道具（每关各 1 次）：撤销 / 移出（卡槽前 3 块挪到暂存区）/ 洗牌；失败时可复活 1 次。
 *   不用道具通关得 3 星，用 1 次得 2 星，否则 1 星。
 *
 * 关卡生成保证有解：先随机模拟一条"从上往下拿块"的顺序，再沿这个顺序每 3 个（或每 6 个混两种）分配图案。
 * 美术全部用 Canvas 矢量绘制并缓存成离屏贴图；音效用 WebAudio 实时合成，不依赖任何素材文件。
 */

// ============================================================
// 平台与画布
// ============================================================
const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
const W = info.windowWidth;
const H = info.windowHeight;
const DPR = Math.min(3, info.pixelRatio || 1);

const canvas = wx.createCanvas();
canvas.width = W * DPR;
canvas.height = H * DPR;
const ctx = canvas.getContext('2d');
ctx.scale(DPR, DPR);

function newCanvas(w, h) {
  const c = wx.createCanvas();
  c.width = Math.ceil(w * DPR);
  c.height = Math.ceil(h * DPR);
  const x = c.getContext('2d');
  x.scale(DPR, DPR);
  return { c, x };
}

let menuRect = null;
try {
  menuRect = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
} catch (e) {
  menuRect = null;
}
const SAFE_TOP = menuRect && menuRect.bottom ? menuRect.bottom + 6 : 30;
const SAFE_BOTTOM = info.safeArea ? Math.max(0, H - info.safeArea.bottom) : 0;
const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';

// ============================================================
// 布局
// ============================================================
const SLOTS = 7;
const C = 7; // 棋盘宽（块）
const R = 8; // 棋盘高（块）

const HEADER_Y = SAFE_TOP + 22;
const BOARD_TOP = SAFE_TOP + 56;
const TOOLS_H = 54;
const TOOLS_Y = H - SAFE_BOTTOM - 14 - TOOLS_H;
const SLOT = Math.floor(Math.min(52, (W - 44) / SLOTS));
const SLOT_T = SLOT - 4; // 卡槽内块的尺寸
const BAR_H = SLOT + 14;
const BAR_Y = TOOLS_Y - 14 - BAR_H;
const BAR_W = SLOT * SLOTS + 14;
const BAR_X = (W - BAR_W) / 2;
const HOLD_Y = BAR_Y - SLOT - 12;
const HOLD_MAX = 6;
const U = Math.max(8, Math.floor(Math.min((W - 20) / (C * 2), (HOLD_Y - 12 - BOARD_TOP) / (R * 2)))); // 半块单位，至少 8px
const TILE = U * 2;
const BOARD_X = (W - C * TILE) / 2;
const BOARD_Y = BOARD_TOP + Math.max(0, (HOLD_Y - 12 - BOARD_TOP - R * TILE) / 2);
const MAX_LEVEL = 60;

const COLOR = {
  bgTop: '#0b1020',
  bgBottom: '#141b33',
  panel: '#161b22',
  panel2: '#21262d',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#8b949e',
  green: '#3fb950',
  greenDark: '#238636',
  red: '#f85149',
  gold: '#f2c94c'
};

// 12 种图案：hue 决定配色，icon 决定形状
const TYPES = [
  { icon: 'code', hue: 217 },
  { icon: 'bug', hue: 0 },
  { icon: 'star', hue: 44 },
  { icon: 'branch', hue: 22 },
  { icon: 'pr', hue: 140 },
  { icon: 'ci', hue: 172 },
  { icon: 'coffee', hue: 28, sat: 45 },
  { icon: 'package', hue: 272 },
  { icon: 'db', hue: 192 },
  { icon: 'term', hue: 220, sat: 18 },
  { icon: 'bolt', hue: 248 },
  { icon: 'heart', hue: 332 }
];

// ============================================================
// 工具函数
// ============================================================
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
function roundRect(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}
function hsl(h, s, l, a) {
  return a === undefined ? 'hsl(' + h + ',' + s + '%,' + l + '%)' : 'hsla(' + h + ',' + s + '%,' + l + '%,' + a + ')';
}
function ellipse(c, cx, cy, rx, ry) {
  c.save();
  c.translate(cx, cy);
  c.scale(1, ry / rx);
  c.beginPath();
  c.arc(0, 0, rx, 0, Math.PI * 2);
  c.restore();
}
function txt(str, x, y, size, color, align, weight, c) {
  c = c || ctx;
  c.fillStyle = color;
  c.font = (weight || 'bold') + ' ' + size + 'px ' + FONT;
  c.textAlign = align || 'center';
  c.textBaseline = 'middle';
  c.fillText(str, x, y);
}

// ============================================================
// 存档
// ============================================================
const SAVE_KEY = 'code-stack-save';
const save = (function () {
  let s = wx.getStorageSync(SAVE_KEY);
  if (!s || typeof s !== 'object') s = {};
  const old = Number(wx.getStorageSync('code-stack-level')) || 1; // 兼容 v1
  return {
    unlocked: Math.max(Number(s.unlocked) || 1, old),
    stars: s.stars && typeof s.stars === 'object' ? s.stars : {},
    sound: s.sound !== false
  };
})();
function persist() {
  wx.setStorageSync(SAVE_KEY, save);
}

// ============================================================
// 音效：WebAudio 合成
// ============================================================
const Sound = (function () {
  let ac = null;
  let failed = false;
  function audio() {
    if (failed || !save.sound) return null;
    if (!ac) {
      try {
        ac = wx.createWebAudioContext ? wx.createWebAudioContext() : null;
      } catch (e) {
        ac = null;
      }
      if (!ac) {
        failed = true;
        return null;
      }
    }
    try {
      if (ac.state === 'suspended' && ac.resume) ac.resume();
    } catch (e) { /* ignore */ }
    return ac;
  }
  function tone(freq, dur, type, vol, delay, slideTo) {
    const a = audio();
    if (!a) return;
    try {
      const t0 = a.currentTime + (delay || 0);
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(a.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* 部分机型不支持某些 API，静默跳过 */ }
  }
  return {
    tap() { tone(740, 0.07, 'triangle', 0.12, 0, 980); },
    land() { tone(330, 0.06, 'sine', 0.1); },
    match(combo) {
      const base = 523.25 * Math.pow(2, Math.min(combo - 1, 8) / 12);
      tone(base, 0.12, 'triangle', 0.14, 0);
      tone(base * 1.26, 0.12, 'triangle', 0.13, 0.06);
      tone(base * 1.5, 0.22, 'triangle', 0.13, 0.12);
    },
    bad() { tone(160, 0.14, 'square', 0.05, 0, 110); },
    tool() { tone(300, 0.18, 'sine', 0.12, 0, 900); },
    click() { tone(520, 0.05, 'triangle', 0.08); },
    star(i) { tone(660 * Math.pow(2, (i * 4) / 12), 0.25, 'triangle', 0.14); },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.14, i * 0.1));
    },
    lose() {
      [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'sine', 0.13, i * 0.13));
    },
    unlockAudio() { audio(); }
  };
})();

function vibrate(type) {
  try {
    if (wx.vibrateShort) wx.vibrateShort({ type: type || 'light' });
  } catch (e) { /* ignore */ }
}

// ============================================================
// 矢量图标
// ============================================================
function drawIcon(c, id, cx, cy, s, color) {
  c.save();
  c.fillStyle = color;
  c.strokeStyle = color;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const lw = s * 0.07;
  c.lineWidth = lw;
  if (id === 'code') {
    c.beginPath();
    c.moveTo(cx - 0.11 * s, cy - 0.14 * s);
    c.lineTo(cx - 0.25 * s, cy);
    c.lineTo(cx - 0.11 * s, cy + 0.14 * s);
    c.moveTo(cx + 0.11 * s, cy - 0.14 * s);
    c.lineTo(cx + 0.25 * s, cy);
    c.lineTo(cx + 0.11 * s, cy + 0.14 * s);
    c.moveTo(cx + 0.05 * s, cy - 0.19 * s);
    c.lineTo(cx - 0.05 * s, cy + 0.19 * s);
    c.stroke();
  } else if (id === 'bug') {
    c.lineWidth = s * 0.045;
    for (let k = -1; k <= 1; k++) {
      c.beginPath();
      c.moveTo(cx - 0.12 * s, cy + 0.04 * s + k * 0.09 * s);
      c.lineTo(cx - 0.26 * s, cy + 0.02 * s + k * 0.13 * s);
      c.moveTo(cx + 0.12 * s, cy + 0.04 * s + k * 0.09 * s);
      c.lineTo(cx + 0.26 * s, cy + 0.02 * s + k * 0.13 * s);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(cx - 0.05 * s, cy - 0.2 * s);
    c.lineTo(cx - 0.12 * s, cy - 0.28 * s);
    c.moveTo(cx + 0.05 * s, cy - 0.2 * s);
    c.lineTo(cx + 0.12 * s, cy - 0.28 * s);
    c.stroke();
    ellipse(c, cx, cy + 0.06 * s, 0.15 * s, 0.19 * s);
    c.fill();
    c.beginPath();
    c.arc(cx, cy - 0.15 * s, 0.09 * s, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = s * 0.025;
    c.beginPath();
    c.moveTo(cx, cy - 0.08 * s);
    c.lineTo(cx, cy + 0.23 * s);
    c.stroke();
  } else if (id === 'star') {
    const r = 0.27 * s;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.46;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const px = cx + Math.cos(a) * rad;
      const py = cy + 0.02 * s + Math.sin(a) * rad;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath();
    c.arc(cx - 0.06 * s, cy - 0.05 * s, 0.05 * s, 0, Math.PI * 2);
    c.fill();
  } else if (id === 'branch') {
    c.lineWidth = s * 0.06;
    c.beginPath();
    c.moveTo(cx - 0.12 * s, cy - 0.17 * s);
    c.lineTo(cx - 0.12 * s, cy + 0.17 * s);
    c.moveTo(cx + 0.13 * s, cy - 0.08 * s);
    c.quadraticCurveTo(cx + 0.13 * s, cy + 0.08 * s, cx - 0.12 * s, cy + 0.08 * s);
    c.stroke();
    [[-0.12, -0.19], [-0.12, 0.19], [0.13, -0.1]].forEach(p => {
      c.beginPath();
      c.arc(cx + p[0] * s, cy + p[1] * s, 0.075 * s, 0, Math.PI * 2);
      c.fill();
    });
  } else if (id === 'pr') {
    c.lineWidth = s * 0.06;
    c.beginPath();
    c.moveTo(cx - 0.14 * s, cy - 0.17 * s);
    c.lineTo(cx - 0.14 * s, cy + 0.17 * s);
    c.moveTo(cx + 0.14 * s, cy + 0.17 * s);
    c.lineTo(cx + 0.14 * s, cy - 0.06 * s);
    c.quadraticCurveTo(cx + 0.14 * s, cy - 0.17 * s, cx + 0.03 * s, cy - 0.17 * s);
    c.lineTo(cx - 0.02 * s, cy - 0.17 * s);
    c.stroke();
    c.beginPath();
    c.moveTo(cx - 0.04 * s, cy - 0.17 * s);
    c.lineTo(cx + 0.05 * s, cy - 0.24 * s);
    c.lineTo(cx + 0.05 * s, cy - 0.1 * s);
    c.closePath();
    c.fill();
    [[-0.14, -0.19], [-0.14, 0.19], [0.14, 0.19]].forEach(p => {
      c.beginPath();
      c.arc(cx + p[0] * s, cy + p[1] * s, 0.075 * s, 0, Math.PI * 2);
      c.fill();
    });
  } else if (id === 'ci') {
    c.beginPath();
    c.arc(cx, cy, 0.25 * s, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#ffffff';
    c.lineWidth = s * 0.07;
    c.beginPath();
    c.moveTo(cx - 0.11 * s, cy + 0.01 * s);
    c.lineTo(cx - 0.03 * s, cy + 0.09 * s);
    c.lineTo(cx + 0.12 * s, cy - 0.08 * s);
    c.stroke();
  } else if (id === 'coffee') {
    roundRect(c, cx - 0.2 * s, cy - 0.06 * s, 0.32 * s, 0.26 * s, 0.07 * s);
    c.fill();
    c.lineWidth = s * 0.055;
    c.beginPath();
    c.arc(cx + 0.13 * s, cy + 0.06 * s, 0.075 * s, -Math.PI / 2, Math.PI / 2);
    c.stroke();
    c.beginPath();
    c.moveTo(cx - 0.25 * s, cy + 0.25 * s);
    c.lineTo(cx + 0.17 * s, cy + 0.25 * s);
    c.stroke();
    c.lineWidth = s * 0.04;
    for (let k = 0; k < 2; k++) {
      const ox = cx - 0.09 * s + k * 0.1 * s;
      c.beginPath();
      c.moveTo(ox, cy - 0.12 * s);
      c.bezierCurveTo(ox + 0.05 * s, cy - 0.17 * s, ox - 0.05 * s, cy - 0.21 * s, ox, cy - 0.27 * s);
      c.stroke();
    }
  } else if (id === 'package') {
    const top = [cx, cy - 0.25 * s];
    const right = [cx + 0.23 * s, cy - 0.12 * s];
    const mid = [cx, cy + 0.01 * s];
    const left = [cx - 0.23 * s, cy - 0.12 * s];
    const bottom = [cx, cy + 0.27 * s];
    const rb = [cx + 0.23 * s, cy + 0.14 * s];
    const lb = [cx - 0.23 * s, cy + 0.14 * s];
    const face = (pts, overlay) => {
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.closePath();
      c.fillStyle = color;
      c.fill();
      if (overlay) {
        c.fillStyle = overlay;
        c.fill();
      }
    };
    face([top, right, mid, left], 'rgba(255,255,255,0.35)');
    face([left, mid, bottom, lb], null);
    face([mid, right, rb, bottom], 'rgba(0,0,0,0.22)');
  } else if (id === 'db') {
    const rx = 0.21 * s;
    const ry = 0.075 * s;
    c.fillRect(cx - rx, cy - 0.16 * s, rx * 2, 0.32 * s);
    ellipse(c, cx, cy + 0.16 * s, rx, ry);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = s * 0.03;
    for (let k = 0; k < 2; k++) {
      const yy = cy - 0.05 * s + k * 0.11 * s;
      c.beginPath();
      c.save();
      c.translate(cx, yy);
      c.scale(1, ry / rx);
      c.arc(0, 0, rx, 0.15, Math.PI - 0.15);
      c.restore();
      c.stroke();
    }
    ellipse(c, cx, cy - 0.16 * s, rx, ry);
    c.fillStyle = color;
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.fill();
  } else if (id === 'term') {
    roundRect(c, cx - 0.26 * s, cy - 0.2 * s, 0.52 * s, 0.4 * s, 0.07 * s);
    c.fill();
    c.strokeStyle = '#ffffff';
    c.lineWidth = s * 0.05;
    c.beginPath();
    c.moveTo(cx - 0.15 * s, cy - 0.08 * s);
    c.lineTo(cx - 0.06 * s, cy);
    c.lineTo(cx - 0.15 * s, cy + 0.08 * s);
    c.moveTo(cx + 0.01 * s, cy + 0.09 * s);
    c.lineTo(cx + 0.14 * s, cy + 0.09 * s);
    c.stroke();
  } else if (id === 'bolt') {
    const pts = [[0.07, -0.28], [-0.17, 0.04], [-0.01, 0.04], [-0.08, 0.28], [0.17, -0.07], [0.01, -0.07]];
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(cx + p[0] * s, cy + p[1] * s) : c.moveTo(cx + p[0] * s, cy + p[1] * s)));
    c.closePath();
    c.fill();
  } else if (id === 'heart') {
    const r = 0.25 * s;
    c.beginPath();
    c.moveTo(cx, cy + r * 0.95);
    c.bezierCurveTo(cx - r * 1.5, cy - r * 0.05, cx - r * 0.75, cy - r * 1.25, cx, cy - r * 0.4);
    c.bezierCurveTo(cx + r * 0.75, cy - r * 1.25, cx + r * 1.5, cy - r * 0.05, cx, cy + r * 0.95);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath();
    c.arc(cx - r * 0.45, cy - r * 0.35, r * 0.18, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

// 界面小图标
function drawUIIcon(id, cx, cy, s, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (id === 'pause') {
    ctx.moveTo(cx - s * 0.18, cy - s * 0.25);
    ctx.lineTo(cx - s * 0.18, cy + s * 0.25);
    ctx.moveTo(cx + s * 0.18, cy - s * 0.25);
    ctx.lineTo(cx + s * 0.18, cy + s * 0.25);
    ctx.stroke();
  } else if (id === 'back') {
    ctx.moveTo(cx + s * 0.12, cy - s * 0.28);
    ctx.lineTo(cx - s * 0.16, cy);
    ctx.lineTo(cx + s * 0.12, cy + s * 0.28);
    ctx.stroke();
  } else if (id === 'next') {
    ctx.moveTo(cx - s * 0.12, cy - s * 0.28);
    ctx.lineTo(cx + s * 0.16, cy);
    ctx.lineTo(cx - s * 0.12, cy + s * 0.28);
    ctx.stroke();
  } else if (id === 'sound' || id === 'mute') {
    ctx.moveTo(cx - s * 0.32, cy - s * 0.1);
    ctx.lineTo(cx - s * 0.16, cy - s * 0.1);
    ctx.lineTo(cx + s * 0.04, cy - s * 0.3);
    ctx.lineTo(cx + s * 0.04, cy + s * 0.3);
    ctx.lineTo(cx - s * 0.16, cy + s * 0.1);
    ctx.lineTo(cx - s * 0.32, cy + s * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    if (id === 'sound') {
      ctx.arc(cx + s * 0.06, cy, s * 0.18, -0.9, 0.9);
      ctx.moveTo(cx + s * 0.06 + Math.cos(-0.9) * s * 0.32, cy + Math.sin(-0.9) * s * 0.32);
      ctx.arc(cx + s * 0.06, cy, s * 0.32, -0.9, 0.9);
    } else {
      ctx.moveTo(cx + s * 0.16, cy - s * 0.14);
      ctx.lineTo(cx + s * 0.38, cy + s * 0.14);
      ctx.moveTo(cx + s * 0.38, cy - s * 0.14);
      ctx.lineTo(cx + s * 0.16, cy + s * 0.14);
    }
    ctx.stroke();
  } else if (id === 'lock') {
    ctx.lineWidth = s * 0.1;
    ctx.arc(cx, cy - s * 0.1, s * 0.16, Math.PI, 0);
    ctx.stroke();
    roundRect(ctx, cx - s * 0.26, cy - s * 0.1, s * 0.52, s * 0.38, s * 0.07);
    ctx.fill();
  } else if (id === 'undo') {
    ctx.arc(cx + s * 0.02, cy + s * 0.04, s * 0.24, Math.PI * 1.1, Math.PI * 2.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.36, cy - s * 0.12);
    ctx.lineTo(cx - s * 0.22, cy + s * 0.06);
    ctx.lineTo(cx - s * 0.08, cy - s * 0.16);
    ctx.stroke();
  } else if (id === 'out') {
    ctx.moveTo(cx, cy + s * 0.1);
    ctx.lineTo(cx, cy - s * 0.3);
    ctx.moveTo(cx - s * 0.15, cy - s * 0.15);
    ctx.lineTo(cx, cy - s * 0.3);
    ctx.lineTo(cx + s * 0.15, cy - s * 0.15);
    ctx.moveTo(cx - s * 0.32, cy + s * 0.05);
    ctx.lineTo(cx - s * 0.32, cy + s * 0.28);
    ctx.lineTo(cx + s * 0.32, cy + s * 0.28);
    ctx.lineTo(cx + s * 0.32, cy + s * 0.05);
    ctx.stroke();
  } else if (id === 'shuffle') {
    ctx.moveTo(cx - s * 0.34, cy - s * 0.18);
    ctx.bezierCurveTo(cx, cy - s * 0.18, cx, cy + s * 0.18, cx + s * 0.3, cy + s * 0.18);
    ctx.moveTo(cx - s * 0.34, cy + s * 0.18);
    ctx.bezierCurveTo(cx, cy + s * 0.18, cx, cy - s * 0.18, cx + s * 0.3, cy - s * 0.18);
    ctx.moveTo(cx + s * 0.2, cy - s * 0.3);
    ctx.lineTo(cx + s * 0.33, cy - s * 0.18);
    ctx.lineTo(cx + s * 0.2, cy - s * 0.06);
    ctx.moveTo(cx + s * 0.2, cy + s * 0.06);
    ctx.lineTo(cx + s * 0.33, cy + s * 0.18);
    ctx.lineTo(cx + s * 0.2, cy + s * 0.3);
    ctx.stroke();
  } else if (id === 'star') {
    const r = s * 0.42;
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.46;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      else ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ============================================================
// 方块贴图缓存
// ============================================================
const PAD = Math.ceil(TILE * 0.14);
const DEPTH = Math.max(3, Math.round(TILE * 0.08));
const RADIUS = TILE * 0.18;

function tileShape(c, x, y, s) {
  roundRect(c, x + 1, y + 1, s - 2, s - 2, RADIUS * (s / TILE));
}

function makeTileSprite(type) {
  const T = TYPES[type];
  const sat = T.sat === undefined ? 62 : T.sat;
  const s = TILE;
  const { c, x } = newCanvas(s + PAD * 2, s + PAD * 2);
  x.translate(PAD, PAD);
  // 投影 + 侧边
  x.save();
  x.shadowColor = 'rgba(0,0,0,0.45)';
  x.shadowBlur = s * 0.14;
  x.shadowOffsetY = s * 0.07;
  x.fillStyle = hsl(T.hue, Math.round(sat * 0.6), 52);
  tileShape(x, 0, 0, s);
  x.fill();
  x.restore();
  // 正面
  const g = x.createLinearGradient(0, 0, 0, s - DEPTH);
  g.addColorStop(0, hsl(T.hue, Math.min(100, sat + 20), 98));
  g.addColorStop(1, hsl(T.hue, sat, 87));
  x.fillStyle = g;
  roundRect(x, 1, 1, s - 2, s - 2 - DEPTH, RADIUS);
  x.fill();
  // 高光
  x.save();
  roundRect(x, 1, 1, s - 2, s - 2 - DEPTH, RADIUS);
  x.clip();
  const gl = x.createLinearGradient(0, 0, 0, s * 0.5);
  gl.addColorStop(0, 'rgba(255,255,255,0.75)');
  gl.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gl;
  x.fillRect(0, 0, s, s * 0.45);
  x.restore();
  x.strokeStyle = hsl(T.hue, 40, 35, 0.25);
  x.lineWidth = 1;
  roundRect(x, 1.5, 1.5, s - 3, s - 3 - DEPTH, RADIUS);
  x.stroke();
  // 图标
  const iconColor = T.icon === 'term' ? hsl(T.hue, 25, 30) : hsl(T.hue, Math.min(90, sat + 12), T.icon === 'coffee' ? 36 : 47);
  drawIcon(x, T.icon, s / 2, (s - DEPTH) / 2 + 1, s, iconColor);
  return c;
}

function makeDimSprite() {
  const s = TILE;
  const { c, x } = newCanvas(s + PAD * 2, s + PAD * 2);
  x.translate(PAD, PAD);
  x.fillStyle = 'rgba(9,13,26,0.62)';
  tileShape(x, 0, 0, s);
  x.fill();
  return c;
}

const sprites = TYPES.map((_, i) => makeTileSprite(i));
const dimSprite = makeDimSprite();

// 标题字块
function makeCharSprite(ch, hue, s) {
  const pad = Math.ceil(s * 0.14);
  const depth = Math.round(s * 0.08);
  const { c, x } = newCanvas(s + pad * 2, s + pad * 2);
  x.translate(pad, pad);
  x.save();
  x.shadowColor = 'rgba(0,0,0,0.5)';
  x.shadowBlur = s * 0.16;
  x.shadowOffsetY = s * 0.08;
  x.fillStyle = hsl(hue, 45, 50);
  roundRect(x, 1, 1, s - 2, s - 2, s * 0.2);
  x.fill();
  x.restore();
  const g = x.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, hsl(hue, 85, 97));
  g.addColorStop(1, hsl(hue, 70, 85));
  x.fillStyle = g;
  roundRect(x, 1, 1, s - 2, s - 2 - depth, s * 0.2);
  x.fill();
  txt(ch, s / 2, (s - depth) / 2 + 2, Math.round(s * 0.56), hsl(hue, 70, 38), 'center', 'bold', x);
  return { c, pad, s };
}
let logoSprites = null;

// 背景（静态部分缓存）
const bgSprite = (function () {
  const { c, x } = newCanvas(W, H);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, COLOR.bgTop);
  g.addColorStop(1, COLOR.bgBottom);
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  const rg = x.createRadialGradient(W * 0.5, H * 0.35, 10, W * 0.5, H * 0.35, H * 0.6);
  rg.addColorStop(0, 'rgba(88,166,255,0.12)');
  rg.addColorStop(1, 'rgba(88,166,255,0)');
  x.fillStyle = rg;
  x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,255,255,0.05)';
  for (let yy = 12; yy < H; yy += 22) {
    for (let xx = 12; xx < W; xx += 22) {
      x.fillRect(xx, yy, 1.5, 1.5);
    }
  }
  return c;
})();

const GLYPHS = ['{ }', '</>', '=>', '&&', '()', '[]', '//', '++', '#!', '$_'];
const floaters = [];
for (let i = 0; i < 14; i++) {
  floaters.push({
    x: Math.random() * W,
    y: Math.random() * H,
    v: 6 + Math.random() * 10,
    s: 12 + Math.random() * 10,
    a: 0.04 + Math.random() * 0.06,
    g: GLYPHS[i % GLYPHS.length]
  });
}

// ============================================================
// 关卡生成
// ============================================================
function covers(top, below) {
  return top.layer > below.layer && Math.abs(top.ux - below.ux) < 2 && Math.abs(top.uy - below.uy) < 2;
}
function isCovered(t, list) {
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o !== t && !o.removed && covers(o, t)) return true;
  }
  return false;
}

function levelConfig(n) {
  if (n === 1) return { layers: 2, cw: 4, rh: 4, count: 18, types: 3, density: 0.75, mix: false };
  if (n === 2) return { layers: 3, cw: 5, rh: 5, count: 36, types: 5, density: 0.65, mix: false };
  const k = n - 3;
  return {
    layers: Math.min(9, 4 + Math.floor(k / 1.5)),
    cw: k < 2 ? 6 : 7,
    rh: k < 2 ? 7 : 8,
    count: Math.min(204, 60 + k * 18),
    types: Math.min(TYPES.length, 6 + k),
    density: 0.55,
    mix: true
  };
}

function buildLayers(cfg, density, rnd) {
  const out = [];
  for (let L = 0; L < cfg.layers; L++) {
    const par = L % 2;
    const shrink = Math.floor(L / 3);
    const cw = Math.max(3, cfg.cw - shrink);
    const rh = Math.max(3, cfg.rh - shrink);
    const x0 = C - cw;
    const y0 = R - rh;
    const center = x0 + cw - 1;
    for (let uy = y0 + par; uy <= y0 + 2 * rh - 2 - par; uy += 2) {
      for (let ux = x0 + par; ux <= center; ux += 2) {
        if (rnd() >= density) continue;
        out.push({ ux, uy, layer: L });
        const mirror = 2 * center - ux;
        if (mirror !== ux) out.push({ ux: mirror, uy, layer: L });
      }
    }
  }
  return out;
}

function generate(n) {
  const cfg = levelConfig(n);
  const rnd = mulberry32(n * 7919 + 17);
  let tiles = [];
  let density = cfg.density;
  for (let tries = 0; tries < 30 && tiles.length < cfg.count; tries++) {
    tiles = buildLayers(cfg, density, rnd);
    density = Math.min(0.97, density + 0.05);
  }
  const count = Math.min(cfg.count, Math.floor(tiles.length / 3) * 3);
  while (tiles.length > count) {
    let maxL = 0;
    for (const t of tiles) maxL = Math.max(maxL, t.layer);
    const top = tiles.filter(t => t.layer === maxL);
    tiles.splice(tiles.indexOf(top[Math.floor(rnd() * top.length)]), 1);
  }

  const remaining = tiles.slice();
  const order = [];
  while (remaining.length) {
    const free = remaining.filter(t => !isCovered(t, remaining));
    const pick = free[Math.floor(rnd() * free.length)];
    order.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
  }

  const triples = order.length / 3;
  const pool = [];
  for (let i = 0; i < triples; i++) pool.push(i % cfg.types);
  shuffle(pool, rnd);
  const step = cfg.mix ? 6 : 3;
  for (let i = 0, p = 0; i < order.length; i += step) {
    const chunk = order.slice(i, i + step);
    const labels = [];
    for (let j = 0; j < chunk.length; j += 3) {
      const type = pool[p++];
      labels.push(type, type, type);
    }
    shuffle(labels, rnd);
    chunk.forEach((t, j) => { t.type = labels[j]; });
  }

  return tiles.map(t => ({
    ux: t.ux, uy: t.uy, layer: t.layer, type: t.type,
    removed: false, blocked: false, dimA: 0, anim: null, flip: null, wiggle: 0
  }));
}

// ============================================================
// 游戏状态
// ============================================================
const g = {
  mode: 'title', // title | levels | play
  overlay: null, // null | pause | win | lose
  overlayT: 0,
  level: save.unlocked,
  page: Math.floor((Math.min(save.unlocked, MAX_LEVEL) - 1) / 20),
  tiles: [],
  order: [],
  total: 0,
  alive: 0,
  slot: [],
  hold: [],
  merges: [],
  particles: [],
  texts: [],
  history: [],
  tools: { undo: 1, out: 1, shuffle: 1 },
  used: 0,
  revived: false,
  combo: 0,
  lastMatch: -10,
  shake: 0,
  time: 0,
  endTimer: -1,
  endKind: null,
  stars: 0,
  toast: null,
  buttons: [],
  pressed: null
};

function refresh() {
  const alive = [];
  for (const t of g.tiles) {
    if (t.removed) continue;
    alive.push(t);
    t.blocked = isCovered(t, g.tiles);
  }
  alive.sort((a, b) => a.layer - b.layer || a.uy - b.uy || a.ux - b.ux);
  g.order = alive;
  g.alive = alive.length;
}

function tileRect(t) {
  return { x: BOARD_X + t.ux * U, y: BOARD_Y + t.uy * U, s: TILE };
}
function slotPos(i) {
  return { x: BAR_X + 7 + i * SLOT + 2, y: BAR_Y + 7 + 2 };
}
function holdPos(i, n) {
  const sz = Math.min(SLOT, (W - 40) / HOLD_MAX);
  return { x: W / 2 - (n * sz) / 2 + i * sz + 2, y: HOLD_Y + 2, s: sz - 4 };
}

function startLevel(n) {
  g.mode = 'play';
  g.overlay = null;
  g.level = n;
  g.tiles = generate(n);
  g.total = g.tiles.length;
  g.slot = [];
  g.hold = [];
  g.merges = [];
  g.particles = [];
  g.texts = [];
  g.history = [];
  g.tools = { undo: 1, out: 1, shuffle: 1 };
  g.used = 0;
  g.revived = false;
  g.combo = 0;
  g.endTimer = -1;
  g.toast = null;
  // 入场动画：按层依次落下
  for (const t of g.tiles) {
    const r = tileRect(t);
    t.anim = { x0: r.x, y0: r.y - 70 - t.layer * 18, s0: TILE, t: 0, dur: 0.42, delay: t.layer * 0.07 + Math.random() * 0.12, fade: true };
  }
  refresh();
  for (const t of g.tiles) t.dimA = t.blocked ? 1 : 0;
}

function toast(text) {
  g.toast = { text, t: 1.5 };
}

function floatText(text, x, y, color, size) {
  g.texts.push({ text, x, y, t: 0, life: 0.9, color, size: size || 18 });
}

function burst(x, y, hue, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 80 + Math.random() * 220;
    g.particles.push({
      kind: 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, g: 420,
      life: 0.5 + Math.random() * 0.3, t: 0, size: 2 + Math.random() * 3,
      color: hsl(hue, 85, 60 + Math.random() * 20)
    });
  }
  g.particles.push({ kind: 'ring', x, y, life: 0.4, t: 0, size: 10, color: hsl(hue, 90, 75) });
}

function confetti() {
  for (let i = 0; i < 90; i++) {
    g.particles.push({
      kind: 'rect', x: Math.random() * W, y: -20 - Math.random() * H * 0.4,
      vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 160, g: 60,
      life: 3.2, t: 0, size: 5 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10,
      color: hsl(Math.floor(Math.random() * 360), 85, 62)
    });
  }
}

// ============================================================
// 核心操作
// ============================================================
function pushToSlot(type, x, y, s, src) {
  let idx = g.slot.length;
  for (let i = g.slot.length - 1; i >= 0; i--) {
    if (g.slot[i].type === type) {
      idx = i + 1;
      break;
    }
  }
  const e = { type, sx: x, sy: y, ss: s, x, y, s, t: 0, landed: false, squash: 0, src };
  g.slot.splice(idx, 0, e);
  return e;
}

function tileDrawPos(t) {
  const r = tileRect(t);
  if (!t.anim) return { x: r.x, y: r.y, s: r.s, a: 1 };
  const a = t.anim;
  const k = clamp((a.t - a.delay) / a.dur, 0, 1);
  const e = a.fade ? easeOutBack(k) : easeOutCubic(k);
  return {
    x: a.x0 + (r.x - a.x0) * e,
    y: a.y0 + (r.y - a.y0) * e,
    s: a.s0 + (r.s - a.s0) * e,
    a: a.fade ? clamp(k * 2.5, 0, 1) : 1
  };
}

function pickTile(t) {
  const p = tileDrawPos(t);
  t.removed = true;
  const e = pushToSlot(t.type, p.x, p.y, p.s, t);
  g.history.push(e);
  refresh();
  Sound.tap();
  vibrate('light');
}

const TOOLS = [
  { key: 'undo', label: '撤销', icon: 'undo' },
  { key: 'out', label: '移出', icon: 'out' },
  { key: 'shuffle', label: '洗牌', icon: 'shuffle' }
];

function moveOut() {
  const moved = g.slot.splice(0, Math.min(3, g.slot.length));
  moved.forEach(e => g.hold.push({ type: e.type, x: e.x, y: e.y, s: e.s }));
}

function useTool(key) {
  if (g.overlay || g.endTimer >= 0) return;
  if (g.tools[key] <= 0) {
    toast('本关已用过这个道具');
    Sound.bad();
    return;
  }
  if (key === 'undo') {
    const last = g.history[g.history.length - 1];
    const idx = last ? g.slot.indexOf(last) : -1;
    if (idx < 0 || !last.landed) {
      toast('没有可撤销的块');
      Sound.bad();
      return;
    }
    g.slot.splice(idx, 1);
    g.history.pop();
    const t = last.src;
    t.removed = false;
    t.anim = { x0: last.x, y0: last.y, s0: last.s, t: 0, dur: 0.28, delay: 0, fade: false };
    refresh();
  } else if (key === 'out') {
    if (!g.slot.length) {
      toast('卡槽是空的');
      Sound.bad();
      return;
    }
    if (g.hold.length > HOLD_MAX - 3) {
      toast('暂存区放不下了');
      Sound.bad();
      return;
    }
    moveOut();
  } else if (key === 'shuffle') {
    const alive = g.tiles.filter(t => !t.removed);
    const types = shuffle(alive.map(t => t.type), Math.random);
    alive.forEach((t, i) => { t.flip = { t: 0, next: types[i] }; });
  }
  g.tools[key]--;
  g.used++;
  Sound.tool();
}

function revive() {
  // 这里可以接激励视频广告：wx.createRewardedVideoAd({ adUnitId }) 播放完成后再执行下面的逻辑
  g.revived = true;
  g.used++;
  moveOut();
  g.overlay = null;
  g.endTimer = -1;
  Sound.tool();
}

function finish(kind) {
  g.overlay = kind;
  g.overlayT = 0;
  if (kind === 'win') {
    g.stars = g.used === 0 ? 3 : g.used === 1 ? 2 : 1;
    const prev = save.stars[g.level] || 0;
    if (g.stars > prev) save.stars[g.level] = g.stars;
    if (g.level + 1 > save.unlocked) save.unlocked = g.level + 1;
    persist();
    Sound.win();
    confetti();
    vibrate('medium');
  } else if (kind === 'lose') {
    Sound.lose();
    g.shake = 0.35;
    vibrate('heavy');
  }
}

// ============================================================
// 更新
// ============================================================
function update(dt) {
  g.time += dt;
  g.overlayT += dt;
  if (g.toast) {
    g.toast.t -= dt;
    if (g.toast.t <= 0) g.toast = null;
  }
  if (g.shake > 0) g.shake -= dt;
  for (const f of floaters) {
    f.y -= f.v * dt;
    if (f.y < -20) {
      f.y = H + 20;
      f.x = Math.random() * W;
    }
  }
  for (let i = g.particles.length - 1; i >= 0; i--) {
    const p = g.particles[i];
    p.t += dt;
    if (p.kind !== 'ring') {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.rot !== undefined) p.rot += p.vr * dt;
    }
    if (p.t >= p.life) g.particles.splice(i, 1);
  }
  for (let i = g.texts.length - 1; i >= 0; i--) {
    const t = g.texts[i];
    t.t += dt;
    if (t.t >= t.life) g.texts.splice(i, 1);
  }
  if (g.mode !== 'play') return;

  // 棋盘动画
  for (const t of g.tiles) {
    if (t.removed) continue;
    if (t.anim) {
      t.anim.t += dt;
      if (t.anim.t >= t.anim.delay + t.anim.dur) t.anim = null;
    }
    if (t.flip) {
      t.flip.t += dt;
      if (t.flip.t >= 0.15 && t.flip.next !== undefined) {
        t.type = t.flip.next;
        t.flip.next = undefined;
      }
      if (t.flip.t >= 0.3) t.flip = null;
    }
    if (t.wiggle > 0) t.wiggle -= dt;
    t.dimA += ((t.blocked ? 1 : 0) - t.dimA) * Math.min(1, dt * 10);
  }

  // 卡槽飞行与平移
  g.slot.forEach((e, i) => {
    const p = slotPos(i);
    if (!e.landed) {
      e.t += dt / 0.26;
      const k = easeOutCubic(Math.min(1, e.t));
      e.x = e.sx + (p.x - e.sx) * k;
      e.y = e.sy + (p.y - e.sy) * k - Math.sin(Math.PI * Math.min(1, e.t)) * 40;
      e.s = e.ss + (SLOT_T - e.ss) * k;
      if (e.t >= 1) {
        e.landed = true;
        e.squash = 1;
        e.x = p.x;
        e.y = p.y;
        e.s = SLOT_T;
        Sound.land();
      }
    } else {
      e.x += (p.x - e.x) * Math.min(1, dt * 18);
      e.y = p.y;
    }
    if (e.squash > 0) e.squash = Math.max(0, e.squash - dt * 6);
  });
  g.hold.forEach((e, i) => {
    const p = holdPos(i, g.hold.length);
    const k = Math.min(1, dt * 14);
    e.x += (p.x - e.x) * k;
    e.y += (p.y - e.y) * k;
    e.s += (p.s - e.s) * k;
  });

  // 三消
  const counts = new Array(TYPES.length).fill(0);
  for (const e of g.slot) if (e.landed) counts[e.type]++;
  const mt = counts.findIndex(c => c >= 3);
  if (mt >= 0) {
    const items = [];
    for (let i = 0; i < g.slot.length && items.length < 3; i++) {
      const e = g.slot[i];
      if (e.landed && e.type === mt) {
        items.push({ x: e.x, y: e.y, s: e.s });
        g.slot.splice(i, 1);
        i--;
      }
    }
    const cx = items[1].x;
    g.merges.push({ type: mt, items, cx, cy: items[1].y, t: 0, done: false });
    g.combo = g.time - g.lastMatch < 2.5 ? g.combo + 1 : 1;
    g.lastMatch = g.time;
    Sound.match(g.combo);
    vibrate('light');
  }
  for (let i = g.merges.length - 1; i >= 0; i--) {
    const m = g.merges[i];
    m.t += dt;
    if (m.t >= 0.16 && !m.done) {
      m.done = true;
      const bx = m.cx + SLOT_T / 2;
      const by = m.cy + SLOT_T / 2;
      burst(bx, by, TYPES[m.type].hue, 16);
      if (g.combo >= 2) floatText('连击 x' + g.combo, bx, by - 26, COLOR.gold, 18);
    }
    if (m.t >= 0.24) g.merges.splice(i, 1);
  }

  // 胜负判定
  if (g.overlay) return;
  if (g.endTimer >= 0) {
    g.endTimer -= dt;
    if (g.endTimer < 0) finish(g.endKind);
    return;
  }
  if (g.alive === 0 && g.slot.length === 0 && g.hold.length === 0 && g.merges.length === 0) {
    g.endKind = 'win';
    g.endTimer = 0.45;
  } else if (g.slot.length >= SLOTS && g.slot.every(e => e.landed) && mt < 0) {
    g.endKind = 'lose';
    g.endTimer = 0.3;
  }
}

// ============================================================
// 绘制
// ============================================================
function drawSprite(type, x, y, s, alpha, scaleX) {
  const k = s / TILE;
  const sp = sprites[type];
  ctx.save();
  if (alpha !== undefined && alpha < 1) ctx.globalAlpha = alpha;
  if (scaleX !== undefined && scaleX !== 1) {
    ctx.translate(x + s / 2, 0);
    ctx.scale(scaleX, 1);
    ctx.translate(-(x + s / 2), 0);
  }
  ctx.drawImage(sp, x - PAD * k, y - PAD * k, (TILE + PAD * 2) * k, (TILE + PAD * 2) * k);
  ctx.restore();
}

function drawBackground() {
  ctx.drawImage(bgSprite, 0, 0, W, H);
  ctx.font = 'bold 16px Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of floaters) {
    ctx.globalAlpha = f.a;
    ctx.fillStyle = '#9ecbff';
    ctx.font = 'bold ' + Math.round(f.s) + 'px Menlo, Consolas, monospace';
    ctx.fillText(f.g, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function button(x, y, w, h, label, style, onTap, opt) {
  opt = opt || {};
  const id = (opt.id || label) + '@' + Math.round(x) + ',' + Math.round(y);
  const pressed = g.pressed === id;
  const disabled = !!opt.disabled;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (pressed) ctx.scale(0.94, 0.94);
  if (disabled) ctx.globalAlpha = 0.4;
  const r = opt.radius === undefined ? Math.min(14, h / 2) : opt.radius;
  if (style === 'primary' || style === 'danger') {
    const top = style === 'primary' ? '#46c35a' : '#ff6b62';
    const bottom = style === 'primary' ? COLOR.greenDark : '#c62828';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, -w / 2, -h / 2 + 4, w, h, r);
    ctx.fill();
    const gr = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    gr.addColorStop(0, top);
    gr.addColorStop(1, bottom);
    ctx.fillStyle = gr;
    roundRect(ctx, -w / 2, -h / 2, w, h, r);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, -w / 2 + 3, -h / 2 + 2, w - 6, h * 0.42, r * 0.8);
    ctx.fill();
  } else if (style !== 'bare') {
    ctx.fillStyle = 'rgba(33,38,45,0.92)';
    roundRect(ctx, -w / 2, -h / 2, w, h, r);
    ctx.fill();
    ctx.strokeStyle = COLOR.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const color = style === 'primary' || style === 'danger' ? '#ffffff' : COLOR.text;
  if (opt.icon && label) {
    drawUIIcon(opt.icon, -w / 2 + 26, 0, 20, color);
    txt(label, 10, 1, opt.size || 17, color);
  } else if (opt.icon) {
    drawUIIcon(opt.icon, 0, 0, opt.iconSize || 20, color);
  } else {
    txt(label, 0, 1, opt.size || 17, color);
  }
  ctx.restore();
  if (!disabled) g.buttons.push({ id, x, y, w, h, onTap });
}

function drawStars(cx, cy, n, size, gap, animT) {
  for (let i = 0; i < 3; i++) {
    const x = cx + (i - 1) * gap;
    const yOff = i === 1 ? -size * 0.25 : 0;
    drawUIIcon('star', x, cy + yOff, size, 'rgba(255,255,255,0.12)');
    if (i < n) {
      let k = 1;
      if (animT !== undefined) k = clamp((animT - 0.35 - i * 0.25) / 0.3, 0, 1);
      if (k > 0) {
        ctx.save();
        ctx.translate(x, cy + yOff);
        const sc = easeOutBack(k);
        ctx.scale(sc, sc);
        drawUIIcon('star', 0, 0, size, COLOR.gold);
        ctx.restore();
      }
    }
  }
}

function renderPlay() {
  // 顶栏
  button(16, HEADER_Y - 18, 36, 36, '', 'secondary', () => { g.overlay = 'pause'; g.overlayT = 0; Sound.click(); }, { icon: 'pause', iconSize: 18, id: 'pause', radius: 18 });
  txt('第 ' + g.level + ' 关', W / 2, HEADER_Y - 4, 20, COLOR.text);
  const prog = g.total ? 1 - g.alive / g.total : 0;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, W / 2 - 60, HEADER_Y + 14, 120, 5, 2.5);
  ctx.fill();
  ctx.fillStyle = COLOR.green;
  roundRect(ctx, W / 2 - 60, HEADER_Y + 14, Math.max(5, 120 * prog), 5, 2.5);
  ctx.fill();
  txt('剩余 ' + g.alive, W - 18, HEADER_Y, 14, COLOR.muted, 'right', 'normal');

  // 棋盘
  for (const t of g.order) {
    const p = tileDrawPos(t);
    let x = p.x;
    if (t.wiggle > 0) x += Math.sin(t.wiggle * 60) * 4 * (t.wiggle / 0.3);
    let sx = 1;
    if (t.flip) sx = Math.max(0.05, Math.abs(Math.cos((Math.PI * t.flip.t) / 0.3)));
    drawSprite(t.type, x, p.y, p.s, p.a, sx);
    if (t.dimA > 0.01) {
      ctx.globalAlpha = t.dimA * p.a;
      const k = p.s / TILE;
      ctx.drawImage(dimSprite, x - PAD * k, p.y - PAD * k, (TILE + PAD * 2) * k, (TILE + PAD * 2) * k);
      ctx.globalAlpha = 1;
    }
  }

  // 暂存区
  if (g.hold.length) {
    const p0 = holdPos(0, g.hold.length);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(ctx, p0.x - 6, HOLD_Y - 4, g.hold.length * (p0.s + 4) + 8, p0.s + 8, 10);
    ctx.fill();
    for (const e of g.hold) drawSprite(e.type, e.x, e.y, e.s);
  }

  // 卡槽
  const danger = g.slot.length >= SLOTS - 1;
  ctx.save();
  if (danger) {
    ctx.shadowColor = 'rgba(248,81,73,' + (0.45 + 0.35 * Math.sin(g.time * 8)) + ')';
    ctx.shadowBlur = 18;
  }
  ctx.fillStyle = 'rgba(22,27,34,0.95)';
  roundRect(ctx, BAR_X, BAR_Y, BAR_W, BAR_H, 14);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = danger ? COLOR.red : COLOR.border;
  ctx.lineWidth = 2;
  roundRect(ctx, BAR_X, BAR_Y, BAR_W, BAR_H, 14);
  ctx.stroke();
  for (let i = 0; i < SLOTS; i++) {
    const p = slotPos(i);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(ctx, p.x, p.y, SLOT_T, SLOT_T, 8);
    ctx.fill();
  }
  for (const e of g.slot) {
    const sq = e.squash;
    const sw = e.s * (1 + 0.12 * sq);
    const sh = e.s * (1 - 0.1 * sq);
    drawSprite(e.type, e.x - (sw - e.s) / 2, e.y + (e.s - sh), sw);
  }
  for (const m of g.merges) {
    const k = clamp(m.t / 0.16, 0, 1);
    for (const it of m.items) {
      const x = it.x + (m.cx - it.x) * easeOutCubic(k);
      const s = it.s * (1 - 0.35 * k);
      drawSprite(m.type, x + (it.s - s) / 2, it.y + (it.s - s) / 2, s, 1 - k * 0.5);
    }
  }

  // 道具栏
  const tw = Math.min(110, (W - 48) / 3);
  const tGap = 12;
  const tx0 = (W - (tw * 3 + tGap * 2)) / 2;
  TOOLS.forEach((tool, i) => {
    const left = g.tools[tool.key];
    const x = tx0 + i * (tw + tGap);
    button(x, TOOLS_Y, tw, TOOLS_H, tool.label, 'secondary', () => useTool(tool.key), { icon: tool.icon, size: 15, id: 'tool-' + tool.key, disabled: !!g.overlay });
    ctx.fillStyle = left > 0 ? COLOR.green : '#484f58';
    ctx.beginPath();
    ctx.arc(x + tw - 6, TOOLS_Y + 6, 9, 0, Math.PI * 2);
    ctx.fill();
    txt(String(left), x + tw - 6, TOOLS_Y + 7, 11, '#ffffff');
  });
}

function renderParticles() {
  for (const p of g.particles) {
    const k = 1 - p.t / p.life;
    ctx.globalAlpha = clamp(k, 0, 1);
    ctx.fillStyle = p.color;
    if (p.kind === 'dot') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'ring') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 * k;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size + (1 - k) * 34, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  for (const t of g.texts) {
    const k = t.t / t.life;
    ctx.globalAlpha = 1 - k * k;
    const sc = k < 0.2 ? easeOutBack(k / 0.2) : 1;
    ctx.save();
    ctx.translate(t.x, t.y - k * 30);
    ctx.scale(sc, sc);
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    txt(t.text, 0, 0, t.size, t.color);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function card(w, h) {
  const k = easeOutBack(clamp(g.overlayT / 0.3, 0, 1));
  ctx.fillStyle = 'rgba(5,8,16,' + 0.7 * clamp(g.overlayT / 0.2, 0, 1) + ')';
  ctx.fillRect(0, 0, W, H);
  const x = (W - w) / 2;
  const y = (H - h) / 2;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(k, k);
  ctx.translate(-W / 2, -H / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, x, y + 6, w, h, 22);
  ctx.fill();
  const gr = ctx.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#1f2633');
  gr.addColorStop(1, '#151a24');
  ctx.fillStyle = gr;
  roundRect(ctx, x, y, w, h, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  return { x, y, w, h, ready: g.overlayT > 0.25 };
}

function renderOverlay() {
  const bw = Math.min(240, W - 80);
  if (g.overlay === 'pause') {
    const c = card(Math.min(300, W - 40), 330);
    if (!c.ready) return;
    txt('暂停', W / 2, c.y + 44, 24, COLOR.text);
    const bx = (W - bw) / 2;
    button(bx, c.y + 80, bw, 50, '继续游戏', 'primary', () => { g.overlay = null; Sound.click(); });
    button(bx, c.y + 142, bw, 46, '重新开始', 'secondary', () => { Sound.click(); startLevel(g.level); });
    button(bx, c.y + 198, bw, 46, '选择关卡', 'secondary', () => { Sound.click(); openLevels(); });
    button(bx, c.y + 254, bw, 46, save.sound ? '音效：开' : '音效：关', 'secondary', toggleSound, { icon: save.sound ? 'sound' : 'mute', id: 'snd' });
  } else if (g.overlay === 'win') {
    const c = card(Math.min(300, W - 40), 320);
    txt('Merged!', W / 2, c.y + 38, 16, COLOR.green, 'center', 'normal');
    txt('第 ' + g.level + ' 关完成', W / 2, c.y + 72, 26, COLOR.text);
    drawStars(W / 2, c.y + 138, g.stars, 46, 58, g.overlayT);
    const hint = g.stars === 3 ? '完美！没用任何道具' : '不用道具通关可得 3 星';
    txt(hint, W / 2, c.y + 190, 14, COLOR.muted, 'center', 'normal');
    if (!c.ready) return;
    const bx = (W - bw) / 2;
    button(bx, c.y + 214, bw, 50, '下一关', 'primary', () => { Sound.click(); startLevel(g.level + 1); });
    button(bx, c.y + 272, bw, 36, '关卡列表', 'bare', () => { Sound.click(); openLevels(); }, { size: 15 });
  } else if (g.overlay === 'lose') {
    const c = card(Math.min(300, W - 40), 300);
    txt('卡槽满了', W / 2, c.y + 48, 26, COLOR.red);
    txt('还剩 ' + g.alive + ' 块代码没清完', W / 2, c.y + 86, 15, COLOR.muted, 'center', 'normal');
    if (!c.ready) return;
    const bx = (W - bw) / 2;
    const canRevive = !g.revived && g.hold.length <= HOLD_MAX - 3;
    button(bx, c.y + 120, bw, 50, canRevive ? '复活：移出 3 块' : '复活机会已用完', 'primary', revive, { disabled: !canRevive, id: 'revive' });
    button(bx, c.y + 182, bw, 46, '重新开始', 'secondary', () => { Sound.click(); startLevel(g.level); });
    button(bx, c.y + 240, bw, 36, '关卡列表', 'bare', () => { Sound.click(); openLevels(); }, { size: 15 });
  }
}

function toggleSound() {
  save.sound = !save.sound;
  persist();
  if (save.sound) Sound.click();
}

function openLevels() {
  g.mode = 'levels';
  g.overlay = null;
  g.page = Math.floor((Math.min(save.unlocked, MAX_LEVEL) - 1) / 20);
  g.particles = [];
}

function renderTitle() {
  if (!logoSprites) {
    const ls = Math.max(24, Math.min(92, (W - 80) / 3));
    logoSprites = [makeCharSprite('代', 217, ls), makeCharSprite('码', 140, ls), makeCharSprite('堆', 22, ls)];
  }
  // 漂浮的装饰块
  for (let i = 0; i < 9; i++) {
    const t = g.time * 0.25 + i * 1.7;
    const x = ((i * 97) % W) + Math.sin(t) * 18;
    const y = (H + 80) - (((g.time * (14 + i * 3) + i * 140) % (H + 160)));
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 0.7) * 0.4);
    drawSprite(i % TYPES.length, -TILE / 2, -TILE / 2, TILE);
    ctx.restore();
  }
  const ls = logoSprites[0].s;
  const gap = 12;
  const total = ls * 3 + gap * 2;
  const top = H * 0.2;
  logoSprites.forEach((sp, i) => {
    const bob = Math.sin(g.time * 2.2 + i * 0.9) * 6;
    const x = (W - total) / 2 + i * (ls + gap);
    ctx.save();
    ctx.translate(x + ls / 2, top + ls / 2 + bob);
    ctx.rotate(Math.sin(g.time * 1.6 + i) * 0.05);
    ctx.drawImage(sp.c, -ls / 2 - sp.pad, -ls / 2 - sp.pad, ls + sp.pad * 2, ls + sp.pad * 2);
    ctx.restore();
  });
  txt('C O D E   S T A C K', W / 2, top + ls + 36, 14, '#9ecbff', 'center', 'normal');
  txt('叠层三消 · 清空这堆代码', W / 2, top + ls + 62, 15, COLOR.muted, 'center', 'normal');

  const bw = Math.min(260, W - 80);
  const bx = (W - bw) / 2;
  const by = H * 0.58;
  const lv = Math.min(save.unlocked, MAX_LEVEL);
  button(bx, by, bw, 56, save.unlocked > 1 ? '继续 · 第 ' + lv + ' 关' : '开始游戏', 'primary', () => { Sound.unlockAudio(); Sound.click(); startLevel(lv); }, { size: 19 });
  button(bx, by + 70, bw, 48, '选择关卡', 'secondary', () => { Sound.unlockAudio(); Sound.click(); openLevels(); });
  button(W / 2 - 22, H - SAFE_BOTTOM - 70, 44, 44, '', 'secondary', toggleSound, { icon: save.sound ? 'sound' : 'mute', id: 'snd-title', radius: 22 });
  let totalStars = 0;
  for (const k in save.stars) totalStars += save.stars[k];
  if (totalStars > 0) {
    drawUIIcon('star', W / 2 - 30, by + 146, 18, COLOR.gold);
    txt(totalStars + ' / ' + (save.unlocked - 1) * 3, W / 2 + 8, by + 147, 15, COLOR.text, 'center', 'normal');
  }
}

function renderLevels() {
  button(16, HEADER_Y - 18, 36, 36, '', 'secondary', () => { Sound.click(); g.mode = 'title'; }, { icon: 'back', iconSize: 18, id: 'back', radius: 18 });
  txt('选择关卡', W / 2, HEADER_Y, 20, COLOR.text);
  const cols = 4;
  const gap = 12;
  const cw = Math.min(76, (W - 40 - gap * (cols - 1)) / cols);
  const ch = cw + 14;
  const gridW = cols * cw + (cols - 1) * gap;
  const x0 = (W - gridW) / 2;
  const y0 = HEADER_Y + 44;
  const pages = Math.ceil(MAX_LEVEL / 20);
  for (let i = 0; i < 20; i++) {
    const n = g.page * 20 + i + 1;
    if (n > MAX_LEVEL) break;
    const x = x0 + (i % cols) * (cw + gap);
    const y = y0 + Math.floor(i / cols) * (ch + gap);
    const locked = n > save.unlocked;
    const current = n === save.unlocked;
    const stars = save.stars[n] || 0;
    const id = 'lv' + n;
    const pressed = g.pressed === id + '@' + Math.round(x) + ',' + Math.round(y);
    ctx.save();
    ctx.translate(x + cw / 2, y + ch / 2);
    if (pressed) ctx.scale(0.93, 0.93);
    ctx.translate(-(x + cw / 2), -(y + ch / 2));
    ctx.fillStyle = locked ? 'rgba(255,255,255,0.04)' : current ? 'rgba(63,185,80,0.18)' : 'rgba(33,38,45,0.95)';
    roundRect(ctx, x, y, cw, ch, 14);
    ctx.fill();
    ctx.strokeStyle = current ? COLOR.green : locked ? 'rgba(255,255,255,0.06)' : COLOR.border;
    ctx.lineWidth = current ? 2 : 1;
    ctx.stroke();
    if (locked) {
      drawUIIcon('lock', x + cw / 2, y + ch / 2 - 2, 26, 'rgba(255,255,255,0.22)');
    } else {
      txt(String(n), x + cw / 2, y + ch * 0.4, 22, COLOR.text);
      for (let s = 0; s < 3; s++) {
        drawUIIcon('star', x + cw / 2 + (s - 1) * 15, y + ch * 0.76, 12, s < stars ? COLOR.gold : 'rgba(255,255,255,0.14)');
      }
    }
    ctx.restore();
    if (!locked) g.buttons.push({ id: id + '@' + Math.round(x) + ',' + Math.round(y), x, y, w: cw, h: ch, onTap: () => { Sound.click(); startLevel(n); } });
  }
  const py = y0 + 5 * (ch + gap) + 10;
  button(W / 2 - 110, py, 56, 44, '', 'secondary', () => { g.page--; Sound.click(); }, { icon: 'back', id: 'prev', disabled: g.page <= 0 });
  button(W / 2 + 54, py, 56, 44, '', 'secondary', () => { g.page++; Sound.click(); }, { icon: 'next', id: 'next', disabled: g.page >= pages - 1 });
  txt(g.page + 1 + ' / ' + pages, W / 2, py + 22, 16, COLOR.muted, 'center', 'normal');
}

function render() {
  g.buttons = [];
  ctx.save();
  if (g.shake > 0) ctx.translate((Math.random() - 0.5) * 10 * g.shake * 3, (Math.random() - 0.5) * 10 * g.shake * 3);
  drawBackground();
  if (g.mode === 'title') renderTitle();
  else if (g.mode === 'levels') renderLevels();
  else {
    renderPlay();
    if (g.overlay) {
      g.buttons = []; // 覆盖层打开时，底下的按钮不响应
      renderOverlay();
    }
  }
  renderParticles(); // 粒子画在最上层（彩带要盖过结算卡片）
  if (g.toast) {
    ctx.globalAlpha = Math.min(1, g.toast.t * 3);
    ctx.fillStyle = 'rgba(240,246,252,0.95)';
    roundRect(ctx, W / 2 - 100, HOLD_Y - 50, 200, 36, 18);
    ctx.fill();
    txt(g.toast.text, W / 2, HOLD_Y - 31, 14, '#0d1117', 'center', 'normal');
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ============================================================
// 输入
// ============================================================
function hitButton(x, y) {
  for (let i = g.buttons.length - 1; i >= 0; i--) {
    const b = g.buttons[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

function tapBoard(x, y) {
  if (g.overlay || g.endTimer >= 0) return false;
  if (g.slot.length >= SLOTS) return false;
  for (let i = 0; i < g.hold.length; i++) {
    const h = g.hold[i];
    if (x >= h.x && x <= h.x + h.s && y >= h.y && y <= h.y + h.s) {
      g.hold.splice(i, 1);
      pushToSlot(h.type, h.x, h.y, h.s, null);
      Sound.tap();
      return true;
    }
  }
  let hit = null;
  for (const t of g.order) {
    const r = tileRect(t);
    if (x >= r.x && x <= r.x + r.s && y >= r.y && y <= r.y + r.s) {
      if (!hit || t.layer > hit.layer) hit = t;
    }
  }
  if (!hit) return false;
  if (hit.anim || hit.flip) return true;
  if (hit.blocked) {
    hit.wiggle = 0.3;
    Sound.bad();
    return true;
  }
  pickTile(hit);
  return true;
}

wx.onTouchStart(function (e) {
  const p = (e.changedTouches && e.changedTouches[0]) || e.touches[0];
  if (!p) return;
  Sound.unlockAudio();
  const b = hitButton(p.clientX, p.clientY);
  if (b) {
    g.pressed = b.id;
    return;
  }
  g.pressed = null;
  if (g.mode === 'play') tapBoard(p.clientX, p.clientY);
});

wx.onTouchEnd(function (e) {
  const p = (e.changedTouches && e.changedTouches[0]) || e.touches[0];
  const id = g.pressed;
  g.pressed = null;
  if (!p || !id) return;
  const b = hitButton(p.clientX, p.clientY);
  if (b && b.id === id) b.onTap();
});

if (wx.onHide) {
  wx.onHide(function () {
    if (g.mode === 'play' && !g.overlay) {
      g.overlay = 'pause';
      g.overlayT = 1;
    }
  });
}

// ============================================================
// 分享
// ============================================================
try {
  if (wx.showShareMenu) wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
  if (wx.onShareAppMessage) {
    wx.onShareAppMessage(function () {
      return { title: g.mode === 'play' ? '我在《代码堆》第 ' + g.level + ' 关卡住了，来帮我清掉这堆代码！' : '《代码堆》：程序员才懂的叠层三消' };
    });
  }
} catch (e) { /* ignore */ }

// ============================================================
// 主循环
// ============================================================
let last = Date.now();
function loop() {
  const now = Date.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
