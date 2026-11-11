/**
 * 提交冲刺 Commit Rush —— 微信小游戏（GitHub 贡献图主题）
 * 玩法：贡献图格子会随机亮起绿色 commit，颜色越亮分越高，且会逐渐变暗消失，要尽快点。
 *   红色格子是 bug，点到会让 CI 失败（-1 条命）。60 秒或 3 次 CI 失败后结束，
 *   结算页会把你这一局点过的格子画成一张"贡献热力图"。
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

const BEST_KEY = 'commit-rush-best';
const ROUND_TIME = 60;
const COLS = 7;
const GAP = 6;
const TOP = 132;
const CELL = Math.floor(Math.min((W - 32 - GAP * (COLS - 1)) / COLS, 56));
const ROWS = Math.max(6, Math.min(10, Math.floor((H - TOP - 40 + GAP) / (CELL + GAP))));
const GRID_W = COLS * CELL + (COLS - 1) * GAP;
const GRID_X = (W - GRID_W) / 2;

const C = {
  bg: '#0d1117',
  panel: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#9198a1',
  levels: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
  bug: '#da3633',
  bugDark: '#5c1a1a',
  gold: '#e3b341'
};

let best = Number(wx.getStorageSync(BEST_KEY)) || 0;

const g = {
  mode: 'menu',
  cells: [],
  hits: [],
  score: 0,
  combo: 0,
  maxCombo: 0,
  lives: 3,
  time: ROUND_TIME,
  elapsed: 0,
  spawnIn: 0,
  texts: [],
  shake: 0,
  nextMilestone: 50,
  overAt: 0,
  newBest: false,
  totalHits: 0
};

function makeCells() {
  const cells = [];
  for (let i = 0; i < COLS * ROWS; i++) cells.push({ kind: null, t: 0, max: 1, pop: 0 });
  return cells;
}
g.cells = makeCells();

function reset() {
  g.mode = 'play';
  g.cells = makeCells();
  g.hits = new Array(COLS * ROWS).fill(0);
  g.score = 0;
  g.combo = 0;
  g.maxCombo = 0;
  g.lives = 3;
  g.time = ROUND_TIME;
  g.elapsed = 0;
  g.spawnIn = 0.3;
  g.texts = [];
  g.nextMilestone = 50;
  g.newBest = false;
  g.totalHits = 0;
}

function cellRect(i) {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return { x: GRID_X + col * (CELL + GAP), y: TOP + row * (CELL + GAP) };
}

function level(cell) {
  const r = cell.t / cell.max;
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}

function spawn() {
  const empty = [];
  for (let i = 0; i < g.cells.length; i++) if (!g.cells[i].kind) empty.push(i);
  if (!empty.length) return;
  const i = empty[Math.floor(Math.random() * empty.length)];
  const bugChance = 0.16 + Math.min(0.14, g.elapsed * 0.003);
  const isBug = Math.random() < bugChance;
  const life = isBug ? 1.7 : Math.max(0.9, 1.9 - g.elapsed * 0.015);
  g.cells[i] = { kind: isBug ? 'bug' : 'commit', t: life, max: life, pop: 0.15 };
}

function floatText(text, x, y, color, size) {
  g.texts.push({ text, x, y, life: 0.9, color, size: size || 16 });
}

function tap(x, y) {
  const col = Math.floor((x - GRID_X) / (CELL + GAP));
  const row = Math.floor((y - TOP) / (CELL + GAP));
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
  const i = row * COLS + col;
  const rc = cellRect(i);
  if (x > rc.x + CELL || y > rc.y + CELL) return; // 点在缝隙里
  const cell = g.cells[i];
  const cx = rc.x + CELL / 2;
  const cy = rc.y + CELL / 2;

  if (cell.kind === 'commit') {
    const lv = level(cell);
    g.combo++;
    g.maxCombo = Math.max(g.maxCombo, g.combo);
    const pts = lv * (1 + Math.floor(g.combo / 10));
    g.score += pts;
    g.hits[i]++;
    g.totalHits++;
    floatText('+' + pts, cx, cy, C.levels[4]);
    g.cells[i] = { kind: null, t: 0, max: 1, pop: 0 };
    if (g.score >= g.nextMilestone) {
      floatText('PR 已合并！', W / 2, TOP - 16, C.gold, 20);
      g.nextMilestone += 50;
    }
  } else if (cell.kind === 'bug') {
    g.lives--;
    g.combo = 0;
    g.shake = 0.3;
    floatText('CI 失败', cx, cy, C.bug, 16);
    g.cells[i] = { kind: null, t: 0, max: 1, pop: 0 };
    wx.vibrateShort && wx.vibrateShort({ type: 'heavy' });
    if (g.lives <= 0) gameOver();
  }
}

function gameOver() {
  g.mode = 'over';
  g.overAt = Date.now();
  if (g.score > best) {
    best = g.score;
    g.newBest = true;
    wx.setStorageSync(BEST_KEY, best);
  }
}

function update(dt) {
  if (g.mode === 'play') {
    g.time -= dt;
    g.elapsed += dt;
    if (g.time <= 0) {
      g.time = 0;
      gameOver();
    }
    g.spawnIn -= dt;
    if (g.spawnIn <= 0) {
      spawn();
      if (g.elapsed > 20 && Math.random() < 0.35) spawn();
      g.spawnIn = Math.max(0.22, 0.55 - g.elapsed * 0.006);
    }
    for (let i = 0; i < g.cells.length; i++) {
      const c = g.cells[i];
      if (!c.kind) continue;
      c.t -= dt;
      if (c.pop > 0) c.pop -= dt;
      if (c.t <= 0) {
        if (c.kind === 'commit') g.combo = 0; // 错过 commit 只断连击
        g.cells[i] = { kind: null, t: 0, max: 1, pop: 0 };
      }
    }
  }
  for (let i = g.texts.length - 1; i >= 0; i--) {
    const t = g.texts[i];
    t.life -= dt;
    t.y -= 40 * dt;
    if (t.life <= 0) g.texts.splice(i, 1);
  }
  if (g.shake > 0) g.shake -= dt;
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

function drawBug(cx, cy, s) {
  ctx.strokeStyle = C.bugDark;
  ctx.lineWidth = 2;
  for (let k = -1; k <= 1; k++) {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.5, cy + k * s * 0.22);
    ctx.lineTo(cx - s * 0.8, cy + k * s * 0.32);
    ctx.moveTo(cx + s * 0.5, cy + k * s * 0.22);
    ctx.lineTo(cx + s * 0.8, cy + k * s * 0.32);
    ctx.stroke();
  }
  ctx.fillStyle = C.bugDark;
  ctx.beginPath();
  ctx.ellipse ? ctx.ellipse(cx, cy + s * 0.05, s * 0.45, s * 0.55, 0, 0, Math.PI * 2) : ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.55, s * 0.25, 0, Math.PI * 2);
  ctx.fill();
}

function drawGrid(colorOf) {
  for (let i = 0; i < g.cells.length; i++) {
    const rc = cellRect(i);
    const c = g.cells[i];
    const grow = c.pop > 0 ? c.pop * 18 : 0;
    const res = colorOf(i, c);
    ctx.fillStyle = res.fill;
    roundRect(rc.x - grow / 2, rc.y - grow / 2, CELL + grow, CELL + grow, 6);
    ctx.fill();
    if (res.stroke) {
      ctx.strokeStyle = res.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (res.bug) drawBug(rc.x + CELL / 2, rc.y + CELL / 2, CELL * 0.4);
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
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  if (g.shake > 0) ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);

  if (g.mode === 'over') {
    // 结算：本局点击热力图
    const maxHit = Math.max(1, ...g.hits);
    drawGrid(function (i) {
      const h = g.hits[i];
      const lv = h === 0 ? 0 : Math.max(1, Math.ceil((h / maxHit) * 4));
      return { fill: C.levels[lv], stroke: lv === 0 ? C.border : null };
    });
  } else {
    drawGrid(function (i, c) {
      if (c.kind === 'commit') return { fill: C.levels[level(c)] };
      if (c.kind === 'bug') return { fill: C.bug, bug: true };
      return { fill: C.panel, stroke: C.border };
    });
  }
  ctx.restore();

  // 顶栏
  if (g.mode === 'play') {
    text(g.score + ' commits', GRID_X, 50, 24, C.text, 'left');
    text(g.combo >= 5 ? '连击 x' + g.combo : '', GRID_X, 80, 14, C.levels[4], 'left', 'normal');
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = k < g.lives ? C.levels[4] : C.bug;
      ctx.beginPath();
      ctx.arc(GRID_X + GRID_W - 8 - k * 22, 50, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    text('CI', GRID_X + GRID_W - 8 - 3 * 22, 50, 12, C.muted, 'center', 'normal');
    // 时间条
    ctx.fillStyle = C.panel;
    roundRect(GRID_X, 98, GRID_W, 8, 4);
    ctx.fill();
    ctx.fillStyle = g.time < 10 ? C.bug : C.levels[3];
    roundRect(GRID_X, 98, Math.max(8, (GRID_W * g.time) / ROUND_TIME), 8, 4);
    ctx.fill();
  }

  for (const t of g.texts) {
    ctx.globalAlpha = Math.max(0, t.life / 0.9);
    text(t.text, t.x, t.y, t.size, t.color);
  }
  ctx.globalAlpha = 1;

  if (g.mode === 'menu') {
    ctx.fillStyle = 'rgba(13,17,23,0.82)';
    ctx.fillRect(0, 0, W, H);
    text('提交冲刺', W / 2, H * 0.3, 38, C.text);
    text('Commit Rush', W / 2, H * 0.3 + 38, 16, C.muted, 'center', 'normal');
    text('点亮绿色 commit，越亮分越高', W / 2, H * 0.44, 16, C.text, 'center', 'normal');
    text('别点红色 bug，3 次 CI 失败就结束', W / 2, H * 0.44 + 26, 16, C.text, 'center', 'normal');
    text('点击开始', W / 2, H * 0.6, 22, C.levels[4]);
    if (best > 0) text('最高 ' + best + ' commits', W / 2, H * 0.6 + 36, 14, C.muted, 'center', 'normal');
  } else if (g.mode === 'over') {
    text(g.lives <= 0 ? 'CI 挂了' : '时间到', W / 2, 44, 22, C.muted, 'center', 'normal');
    text(g.score + ' commits', W / 2, 86, 32, C.text);
    const by = TOP + ROWS * (CELL + GAP) + 6;
    const tail = g.newBest ? '新纪录！' : '最高 ' + best;
    text('点中 ' + g.totalHits + ' 次 · 最长连击 ' + g.maxCombo + ' · ' + tail, W / 2, Math.min(H - 52, by + 12), 14,
      g.newBest ? C.gold : C.muted, 'center', 'normal');
    text('点击再来一局', W / 2, Math.min(H - 24, by + 42), 18, C.levels[4]);
  }
}

// ---------- 输入 ----------
wx.onTouchStart(function (e) {
  if (g.mode === 'menu') {
    reset();
    return;
  }
  if (g.mode === 'over') {
    if (Date.now() - g.overAt > 800) reset();
    return;
  }
  const ts = e.changedTouches && e.changedTouches.length ? e.changedTouches : e.touches;
  for (let k = 0; k < ts.length; k++) tap(ts[k].clientX, ts[k].clientY);
});

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
