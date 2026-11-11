/**
 * 代码堆 Code Stack —— 微信小游戏（叠层三消）
 *
 * 玩法：棋盘上层层叠叠堆着"代码块"，只有没被压住的块能点。
 *   点击的块进入底部 7 格卡槽，凑齐 3 个相同的就消除；卡槽塞满就失败，清空棋盘就过关。
 *   每关有 3 个道具各 1 次：撤销 / 移出（把卡槽前 3 个挪到暂存区）/ 洗牌。
 *
 * 关卡生成保证有解：先随机模拟一遍"从上往下拿块"的顺序，再按这个顺序每 3 个（或每 6 个混两种）分配图案。
 */
const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
const W = info.windowWidth;
const H = info.windowHeight;
const DPR = info.pixelRatio || 1;

const canvas = wx.createCanvas();
canvas.width = W * DPR;
canvas.height = H * DPR;
const ctx = canvas.getContext('2d');
ctx.scale(DPR, DPR);

// ---------- 常量与布局 ----------
const LEVEL_KEY = 'code-stack-level';
const SLOTS = 7;
const C = 7; // 棋盘宽（块）
const R = 8; // 棋盘高（块）

const SLOT = Math.floor(Math.min(50, (W - 44) / SLOTS));
const TOOLS_Y = H - 62;
const BAR_H = SLOT + 12;
const BAR_Y = TOOLS_Y - 14 - BAR_H;
const BAR_W = SLOT * SLOTS + 12;
const BAR_X = (W - BAR_W) / 2;
const HOLD_Y = BAR_Y - SLOT - 12;
const BOARD_TOP = 92;
const U = Math.floor(Math.min((W - 20) / (C * 2), (HOLD_Y - 10 - BOARD_TOP) / (R * 2))); // 半块单位
const TILE = U * 2;
const BOARD_X = (W - C * TILE) / 2;
const BOARD_Y = BOARD_TOP + Math.max(0, (HOLD_Y - 10 - BOARD_TOP - R * TILE) / 2);

const COLOR = {
  bg: '#0d1117',
  panel: '#161b22',
  panel2: '#21262d',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#9198a1',
  green: '#3fb950',
  red: '#f85149',
  gold: '#e3b341'
};

// 图案：文字块 + 手绘图标块。顺序决定前几关出现哪些。
const TYPES = [
  { t: '{ }', bg: '#ffe3c2', fg: '#c2410c' },
  { icon: 'bug', bg: '#ffd6d6', fg: '#b42318' },
  { t: '</>', bg: '#cfe3ff', fg: '#1d4ed8' },
  { t: 'git', bg: '#ffd2cc', fg: '#c0362c' },
  { icon: 'star', bg: '#fff0c2', fg: '#b7791f' },
  { t: 'PR', bg: '#dcf5d9', fg: '#1a7f37' },
  { t: 'CI', bg: '#fff3b0', fg: '#9a6700' },
  { icon: 'coffee', bg: '#eadfd6', fg: '#7c4a2d' },
  { t: 'npm', bg: '#f3d4f7', fg: '#8e24aa' },
  { t: 'SQL', bg: '#d4f1f4', fg: '#0e7490' },
  { t: '=>', bg: '#e5e1ff', fg: '#5b3cc4' },
  { t: '&&', bg: '#ffe0ef', fg: '#be185d' }
];

// ---------- 工具函数 ----------
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

// ---------- 关卡生成 ----------
function levelConfig(n) {
  if (n === 1) return { layers: 2, cw: 4, rh: 4, count: 18, types: 4, density: 0.7, mix: false };
  if (n === 2) return { layers: 4, cw: 6, rh: 6, count: 48, types: 6, density: 0.6, mix: true };
  const k = n - 3;
  return {
    layers: Math.min(9, 5 + k),
    cw: 7,
    rh: 8,
    count: Math.min(204, 84 + k * 24),
    types: Math.min(TYPES.length, 8 + k),
    density: 0.55,
    mix: true
  };
}

function buildLayers(cfg, density, rnd) {
  const out = [];
  for (let L = 0; L < cfg.layers; L++) {
    const par = L % 2; // 奇数层错开半块，制造遮挡
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
        const mirror = 2 * center - ux; // 左右对称，更好看
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
  // 多出来的从最高层随机去掉
  while (tiles.length > count) {
    let maxL = 0;
    for (const t of tiles) maxL = Math.max(maxL, t.layer);
    const top = tiles.filter(t => t.layer === maxL);
    tiles.splice(tiles.indexOf(top[Math.floor(rnd() * top.length)]), 1);
  }

  // 模拟一条合法的拿取顺序
  const remaining = tiles.slice();
  const order = [];
  while (remaining.length) {
    const free = remaining.filter(t => !isCovered(t, remaining));
    const pick = free[Math.floor(rnd() * free.length)];
    order.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
  }

  // 按顺序分配图案：每组 3 个同图案；mix 模式下每 6 个混两种图案（最多占 6 格，依旧有解）
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

  return tiles.map(t => ({ ux: t.ux, uy: t.uy, layer: t.layer, type: t.type, removed: false, blocked: false }));
}

// ---------- 游戏状态 ----------
let unlocked = Number(wx.getStorageSync(LEVEL_KEY)) || 1;

const g = {
  mode: 'menu', // menu | play | win | lose
  level: unlocked,
  tiles: [],
  slot: [], // {type, x, y, s, ready, src}
  hold: [], // {type, x, y, s}
  fx: [],
  history: [],
  tools: { undo: 1, out: 1, shuffle: 1 },
  endAt: 0,
  toast: null,
  alive: 0
};

function refresh() {
  let alive = 0;
  for (const t of g.tiles) {
    if (t.removed) continue;
    alive++;
    t.blocked = isCovered(t, g.tiles);
  }
  g.alive = alive;
}

function start(n) {
  g.level = n;
  g.tiles = generate(n);
  g.slot = [];
  g.hold = [];
  g.fx = [];
  g.history = [];
  g.tools = { undo: 1, out: 1, shuffle: 1 };
  g.toast = null;
  g.mode = 'play';
  refresh();
}

function tileRect(t) {
  return { x: BOARD_X + t.ux * U, y: BOARD_Y + t.uy * U, s: TILE };
}

function slotPos(i) {
  return { x: BAR_X + 6 + i * SLOT + 2, y: BAR_Y + 6 + 2 };
}

function holdPos(i, n) {
  return { x: W / 2 - (n * SLOT) / 2 + i * SLOT + 2, y: HOLD_Y + 2 };
}

function toast(text) {
  g.toast = { text, t: 1.4 };
}

function pushToSlot(type, x, y, s, src) {
  let idx = g.slot.length;
  for (let i = g.slot.length - 1; i >= 0; i--) {
    if (g.slot[i].type === type) {
      idx = i + 1;
      break;
    }
  }
  const entry = { type, x, y, s, ready: false, src };
  g.slot.splice(idx, 0, entry);
  return entry;
}

function pickTile(t) {
  const r = tileRect(t);
  t.removed = true;
  const entry = pushToSlot(t.type, r.x, r.y, r.s, t);
  g.history.push(entry);
  refresh();
}

// ---------- 道具 ----------
const TOOLS = [
  { key: 'undo', label: '撤销' },
  { key: 'out', label: '移出' },
  { key: 'shuffle', label: '洗牌' }
];
const TOOL_W = Math.min(104, (W - 48) / 3);

function toolRect(i) {
  const total = TOOL_W * 3 + 16 * 2;
  return { x: (W - total) / 2 + i * (TOOL_W + 16), y: TOOLS_Y, w: TOOL_W, h: 44 };
}

function useTool(key) {
  if (g.tools[key] <= 0) {
    toast('本关已用过');
    return;
  }
  if (key === 'undo') {
    const last = g.history[g.history.length - 1];
    const idx = last ? g.slot.indexOf(last) : -1;
    if (idx < 0) {
      toast('没有可撤销的块');
      return;
    }
    g.slot.splice(idx, 1);
    g.history.pop();
    last.src.removed = false;
    refresh();
  } else if (key === 'out') {
    if (!g.slot.length) {
      toast('卡槽是空的');
      return;
    }
    if (g.hold.length) {
      toast('暂存区还有块');
      return;
    }
    const moved = g.slot.splice(0, Math.min(3, g.slot.length));
    g.hold = moved.map(e => ({ type: e.type, x: e.x, y: e.y, s: e.s }));
  } else if (key === 'shuffle') {
    const alive = g.tiles.filter(t => !t.removed);
    const types = shuffle(alive.map(t => t.type), Math.random);
    alive.forEach((t, i) => { t.type = types[i]; });
  }
  g.tools[key]--;
}

// ---------- 更新 ----------
function approach(e, tx, ty, ts, dt) {
  const k = Math.min(1, dt * 16);
  e.x += (tx - e.x) * k;
  e.y += (ty - e.y) * k;
  e.s += (ts - e.s) * k;
  return Math.abs(tx - e.x) < 1.5 && Math.abs(ty - e.y) < 1.5;
}

function update(dt) {
  if (g.toast) {
    g.toast.t -= dt;
    if (g.toast.t <= 0) g.toast = null;
  }
  for (let i = g.fx.length - 1; i >= 0; i--) {
    g.fx[i].t -= dt;
    if (g.fx[i].t <= 0) g.fx.splice(i, 1);
  }
  if (g.mode !== 'play') return;

  g.slot.forEach((e, i) => {
    const p = slotPos(i);
    if (approach(e, p.x, p.y, SLOT - 4, dt)) {
      e.ready = true;
      e.x = p.x;
      e.y = p.y;
    }
  });
  g.hold.forEach((e, i) => {
    const p = holdPos(i, g.hold.length);
    approach(e, p.x, p.y, SLOT - 4, dt);
  });

  // 三消
  const counts = {};
  for (const e of g.slot) if (e.ready) counts[e.type] = (counts[e.type] || 0) + 1;
  for (const type in counts) {
    if (counts[type] < 3) continue;
    let n = 0;
    for (let i = 0; i < g.slot.length && n < 3; i++) {
      const e = g.slot[i];
      if (e.ready && e.type === Number(type)) {
        g.fx.push({ x: e.x, y: e.y, s: e.s, type: e.type, t: 0.28 });
        g.slot.splice(i, 1);
        i--;
        n++;
      }
    }
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    break;
  }

  if (g.alive === 0 && g.slot.length === 0 && g.hold.length === 0) {
    g.mode = 'win';
    g.endAt = Date.now();
    if (g.level + 1 > unlocked) {
      unlocked = g.level + 1;
      wx.setStorageSync(LEVEL_KEY, unlocked);
    }
  } else if (g.slot.length >= SLOTS && g.slot.every(e => e.ready)) {
    g.mode = 'lose';
    g.endAt = Date.now();
  }
}

// ---------- 绘制 ----------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawIcon(kind, cx, cy, s, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  if (kind === 'bug') {
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.14, cy + k * s * 0.1);
      ctx.lineTo(cx - s * 0.3, cy + k * s * 0.14);
      ctx.moveTo(cx + s * 0.14, cy + k * s * 0.1);
      ctx.lineTo(cx + s * 0.3, cy + k * s * 0.14);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.03, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.17, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'star') {
    const r = s * 0.27;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const px = cx + Math.cos(a) * rad;
      const py = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'coffee') {
    const w = s * 0.32;
    const h = s * 0.28;
    roundRect(cx - w / 2 - s * 0.04, cy - h / 2 + s * 0.06, w, h, s * 0.05);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.beginPath();
    ctx.arc(cx + w / 2 - s * 0.02, cy + s * 0.08, s * 0.08, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, s * 0.035);
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.04 + k * s * 0.08, cy - s * 0.12);
      ctx.quadraticCurveTo(cx + s * 0.02 + k * s * 0.08, cy - s * 0.18, cx - s * 0.04 + k * s * 0.08, cy - s * 0.25);
      ctx.stroke();
    }
  }
}

function drawTile(x, y, s, type, dim) {
  const T = TYPES[type];
  const r = Math.max(4, s * 0.16);
  const depth = Math.max(3, s * 0.07);
  // 侧面
  ctx.fillStyle = '#6e7681';
  roundRect(x + 1, y + 1 + depth, s - 2, s - 2 - depth, r);
  ctx.fill();
  // 正面
  ctx.fillStyle = T.bg;
  roundRect(x + 1, y + 1, s - 2, s - 2 - depth, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const cx = x + s / 2;
  const cy = y + (s - depth) / 2;
  if (T.icon) {
    drawIcon(T.icon, cx, cy, s, T.fg);
  } else {
    ctx.fillStyle = T.fg;
    const size = T.t.length >= 3 ? s * 0.3 : s * 0.38;
    ctx.font = 'bold ' + Math.round(size) + 'px Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(T.t, cx, cy + 1);
  }
  if (dim) {
    ctx.fillStyle = 'rgba(13,17,23,0.55)';
    roundRect(x + 1, y + 1, s - 2, s - 2, r);
    ctx.fill();
  }
}

function text(str, x, y, size, color, align, weight) {
  ctx.fillStyle = color;
  ctx.font = (weight || 'bold') + ' ' + size + 'px sans-serif';
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function render() {
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, W, H);

  // 顶栏
  text('第 ' + g.level + ' 关', 20, 52, 22, COLOR.text, 'left');
  text('剩余 ' + g.alive, W - 20, 52, 15, COLOR.muted, 'right', 'normal');

  // 棋盘：按层从下往上画
  const alive = g.tiles.filter(t => !t.removed);
  alive.sort((a, b) => a.layer - b.layer || a.uy - b.uy);
  for (const t of alive) {
    const r = tileRect(t);
    drawTile(r.x, r.y, r.s, t.type, t.blocked);
  }

  // 暂存区
  if (g.hold.length) {
    text('暂存区', W / 2 - (g.hold.length * SLOT) / 2 - 8, HOLD_Y + SLOT / 2, 12, COLOR.muted, 'right', 'normal');
    for (const e of g.hold) drawTile(e.x, e.y, e.s, e.type, false);
  }

  // 卡槽
  ctx.fillStyle = COLOR.panel2;
  roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, 10);
  ctx.fill();
  ctx.strokeStyle = g.slot.length >= SLOTS - 1 ? COLOR.red : COLOR.border;
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let i = 0; i < SLOTS; i++) {
    const p = slotPos(i);
    ctx.fillStyle = COLOR.panel;
    roundRect(p.x, p.y, SLOT - 4, SLOT - 4, 6);
    ctx.fill();
  }
  for (const e of g.slot) drawTile(e.x, e.y, e.s, e.type, false);

  // 消除特效
  for (const f of g.fx) {
    const k = f.t / 0.28;
    ctx.globalAlpha = k;
    const s = f.s * (0.6 + 0.4 * k);
    drawTile(f.x + (f.s - s) / 2, f.y + (f.s - s) / 2, s, f.type, false);
    ctx.globalAlpha = 1;
  }

  // 道具
  TOOLS.forEach((tool, i) => {
    const r = toolRect(i);
    const left = g.tools[tool.key];
    ctx.fillStyle = left > 0 ? COLOR.panel2 : COLOR.panel;
    roundRect(r.x, r.y, r.w, r.h, 10);
    ctx.fill();
    ctx.strokeStyle = COLOR.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    text(tool.label, r.x + r.w / 2 - 8, r.y + r.h / 2, 15, left > 0 ? COLOR.text : COLOR.muted);
    ctx.fillStyle = left > 0 ? COLOR.green : COLOR.border;
    ctx.beginPath();
    ctx.arc(r.x + r.w - 16, r.y + r.h / 2, 8, 0, Math.PI * 2);
    ctx.fill();
    text(String(left), r.x + r.w - 16, r.y + r.h / 2 + 1, 11, COLOR.bg);
  });

  if (g.toast) {
    ctx.globalAlpha = Math.min(1, g.toast.t * 3);
    ctx.fillStyle = 'rgba(240,246,252,0.92)';
    roundRect(W / 2 - 90, HOLD_Y - 44, 180, 34, 17);
    ctx.fill();
    text(g.toast.text, W / 2, HOLD_Y - 27, 14, COLOR.bg, 'center', 'normal');
    ctx.globalAlpha = 1;
  }

  // 覆盖层
  if (g.mode === 'menu') {
    ctx.fillStyle = 'rgba(13,17,23,0.86)';
    ctx.fillRect(0, 0, W, H);
    text('代码堆', W / 2, H * 0.27, 42, COLOR.text);
    text('Code Stack · 叠层三消', W / 2, H * 0.27 + 40, 15, COLOR.muted, 'center', 'normal');
    text('点没被压住的代码块放进卡槽', W / 2, H * 0.43, 16, COLOR.text, 'center', 'normal');
    text('3 个相同就消除，7 格塞满就失败', W / 2, H * 0.43 + 26, 16, COLOR.text, 'center', 'normal');
    text('每关有撤销 / 移出 / 洗牌各 1 次', W / 2, H * 0.43 + 52, 16, COLOR.text, 'center', 'normal');
    text('开始第 ' + unlocked + ' 关', W / 2, H * 0.62, 22, COLOR.green);
  } else if (g.mode === 'win') {
    ctx.fillStyle = 'rgba(13,17,23,0.82)';
    ctx.fillRect(0, 0, W, H);
    text('Merged!', W / 2, H * 0.32, 20, COLOR.green, 'center', 'normal');
    text('第 ' + g.level + ' 关通过', W / 2, H * 0.4, 34, COLOR.text);
    text('点击进入第 ' + (g.level + 1) + ' 关', W / 2, H * 0.55, 20, COLOR.green);
  } else if (g.mode === 'lose') {
    ctx.fillStyle = 'rgba(13,17,23,0.82)';
    ctx.fillRect(0, 0, W, H);
    text('卡槽满了', W / 2, H * 0.32, 34, COLOR.red);
    text('还剩 ' + g.alive + ' 块代码没清完', W / 2, H * 0.4, 16, COLOR.muted, 'center', 'normal');
    text('点击重试第 ' + g.level + ' 关', W / 2, H * 0.55, 20, COLOR.text);
  }
}

// ---------- 输入 ----------
function inRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

wx.onTouchStart(function (e) {
  const p = (e.changedTouches && e.changedTouches[0]) || e.touches[0];
  if (!p) return;
  const x = p.clientX;
  const y = p.clientY;

  if (g.mode === 'menu') {
    start(unlocked);
    return;
  }
  if (g.mode === 'win' || g.mode === 'lose') {
    if (Date.now() - g.endAt < 600) return;
    start(g.mode === 'win' ? g.level + 1 : g.level);
    return;
  }

  for (let i = 0; i < TOOLS.length; i++) {
    if (inRect(x, y, toolRect(i))) {
      useTool(TOOLS[i].key);
      return;
    }
  }

  if (g.slot.length >= SLOTS) return;

  // 暂存区的块
  for (let i = 0; i < g.hold.length; i++) {
    const h = g.hold[i];
    if (inRect(x, y, { x: h.x, y: h.y, w: h.s, h: h.s })) {
      g.hold.splice(i, 1);
      pushToSlot(h.type, h.x, h.y, h.s, null);
      return;
    }
  }

  // 棋盘：找该位置最上层的块
  let hit = null;
  for (const t of g.tiles) {
    if (t.removed) continue;
    const r = tileRect(t);
    if (x >= r.x && x <= r.x + r.s && y >= r.y && y <= r.y + r.s) {
      if (!hit || t.layer > hit.layer) hit = t;
    }
  }
  if (hit && !hit.blocked) pickTile(hit);
});

// ---------- 分享 ----------
if (wx.showShareMenu) wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
if (wx.onShareAppMessage) {
  wx.onShareAppMessage(function () {
    return { title: '我在《代码堆》第 ' + g.level + ' 关卡住了，来帮我清掉这堆代码' };
  });
}

// ---------- 主循环 ----------
g.tiles = generate(unlocked);
refresh();

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
