/**
 * 星星收集者 Star Catcher —— 微信小游戏
 * 玩法：按住屏幕左右拖动篮子，接住下落的星星，躲开炸弹。
 *   普通星 +1（每 5 连击额外 +1），金星 +5，爱心 +1 命，炸弹 -1 命。
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

const BEST_KEY = 'star-catcher-best';
const MAX_LIVES = 5;
const BASKET_W = Math.min(110, W * 0.26);
const BASKET_H = 20;
const BASKET_Y = H - 96;

let best = Number(wx.getStorageSync(BEST_KEY)) || 0;

const sky = [];
for (let i = 0; i < 70; i++) {
  sky.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.4 + 0.3, p: Math.random() * 6.28 });
}

const g = {
  mode: 'menu', // menu | play | over
  score: 0,
  lives: 3,
  combo: 0,
  elapsed: 0,
  spawnIn: 0,
  items: [],
  particles: [],
  texts: [],
  basketX: W / 2,
  targetX: W / 2,
  shake: 0,
  overAt: 0,
  newBest: false
};

function reset() {
  g.mode = 'play';
  g.score = 0;
  g.lives = 3;
  g.combo = 0;
  g.elapsed = 0;
  g.spawnIn = 0.4;
  g.items = [];
  g.particles = [];
  g.texts = [];
  g.basketX = g.targetX = W / 2;
  g.newBest = false;
}

function spawn() {
  const roll = Math.random();
  let type = 'star';
  if (roll < 0.22 + Math.min(0.13, g.elapsed * 0.002)) type = 'bomb';
  else if (roll > 0.94) type = 'gold';
  else if (roll > 0.925 && g.lives < MAX_LIVES) type = 'heart';
  const r = type === 'gold' ? 17 : 14;
  g.items.push({
    type,
    r,
    x: r + Math.random() * (W - r * 2),
    y: -r,
    vy: 150 + g.elapsed * 3.5 + Math.random() * 70,
    rot: Math.random() * 6.28,
    spin: (Math.random() - 0.5) * 4
  });
}

function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 160;
    g.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.6, max: 0.6, color });
  }
}

function floatText(text, x, y, color) {
  g.texts.push({ text, x, y, life: 0.9, color });
}

function catchItem(it) {
  switch (it.type) {
    case 'star': {
      g.combo++;
      const pts = 1 + Math.floor(g.combo / 5);
      g.score += pts;
      floatText('+' + pts, it.x, it.y, '#ffe27a');
      burst(it.x, it.y, '#ffe27a', 8);
      break;
    }
    case 'gold':
      g.combo++;
      g.score += 5;
      floatText('+5', it.x, it.y, '#ffb703');
      burst(it.x, it.y, '#ffb703', 16);
      break;
    case 'heart':
      g.lives = Math.min(MAX_LIVES, g.lives + 1);
      floatText('+1 ♥', it.x, it.y, '#ff6b8a');
      burst(it.x, it.y, '#ff6b8a', 12);
      break;
    case 'bomb':
      g.lives--;
      g.combo = 0;
      g.shake = 0.35;
      burst(it.x, it.y, '#ff5a3c', 22);
      wx.vibrateShort && wx.vibrateShort({ type: 'heavy' });
      if (g.lives <= 0) gameOver();
      break;
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
  for (const s of sky) s.p += dt * 2;

  if (g.mode === 'play') {
    g.elapsed += dt;
    g.spawnIn -= dt;
    if (g.spawnIn <= 0) {
      spawn();
      g.spawnIn = Math.max(0.28, 0.85 - g.elapsed * 0.012) * (0.7 + Math.random() * 0.6);
    }
    g.basketX += (g.targetX - g.basketX) * Math.min(1, dt * 18);

    for (let i = g.items.length - 1; i >= 0; i--) {
      const it = g.items[i];
      it.y += it.vy * dt;
      it.rot += it.spin * dt;
      const hit = it.y + it.r >= BASKET_Y && it.y - it.r <= BASKET_Y + BASKET_H &&
        Math.abs(it.x - g.basketX) < BASKET_W / 2 + it.r * 0.4;
      if (hit) {
        g.items.splice(i, 1);
        catchItem(it);
        if (g.mode !== 'play') break;
      } else if (it.y - it.r > H) {
        g.items.splice(i, 1);
        if (it.type === 'star' || it.type === 'gold') g.combo = 0;
      }
    }
  }

  for (let i = g.particles.length - 1; i >= 0; i--) {
    const p = g.particles[i];
    p.life -= dt;
    p.vy += 400 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.life <= 0) g.particles.splice(i, 1);
  }
  for (let i = g.texts.length - 1; i >= 0; i--) {
    const t = g.texts[i];
    t.life -= dt;
    t.y -= 50 * dt;
    if (t.life <= 0) g.texts.splice(i, 1);
  }
  if (g.shake > 0) g.shake -= dt;
}

// ---------- 绘制 ----------
function starPath(x, y, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function heartPath(x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.4, y - r * 0.1, x - r * 0.7, y - r * 1.2, x, y - r * 0.35);
  ctx.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.4, y - r * 0.1, x, y + r * 0.9);
  ctx.closePath();
}

function drawItem(it) {
  if (it.type === 'star' || it.type === 'gold') {
    ctx.fillStyle = it.type === 'gold' ? '#ffb703' : '#ffe27a';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 12;
    starPath(it.x, it.y, it.r, it.rot);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else if (it.type === 'heart') {
    ctx.fillStyle = '#ff6b8a';
    heartPath(it.x, it.y, it.r);
    ctx.fill();
  } else {
    ctx.fillStyle = '#2b2d42';
    ctx.beginPath();
    ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff5a3c';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 引线
    ctx.strokeStyle = '#c9c9c9';
    ctx.beginPath();
    ctx.moveTo(it.x + it.r * 0.5, it.y - it.r * 0.8);
    ctx.quadraticCurveTo(it.x + it.r, it.y - it.r * 1.5, it.x + it.r * 1.2, it.y - it.r * 1.2);
    ctx.stroke();
    ctx.fillStyle = Math.sin(Date.now() / 60) > 0 ? '#ffb703' : '#ff5a3c';
    ctx.beginPath();
    ctx.arc(it.x + it.r * 1.2, it.y - it.r * 1.2, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBasket() {
  const x = g.basketX - BASKET_W / 2;
  ctx.fillStyle = '#8ecae6';
  ctx.beginPath();
  ctx.moveTo(x, BASKET_Y);
  ctx.lineTo(x + BASKET_W, BASKET_Y);
  ctx.lineTo(x + BASKET_W - 10, BASKET_Y + BASKET_H + 10);
  ctx.lineTo(x + 10, BASKET_Y + BASKET_H + 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#219ebc';
  ctx.fillRect(x - 4, BASKET_Y - 4, BASKET_W + 8, 6);
}

function centerText(text, y, size, color, weight) {
  ctx.fillStyle = color;
  ctx.font = (weight || 'bold') + ' ' + size + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, y);
}

function render() {
  ctx.save();
  if (g.shake > 0) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b1026');
  bg.addColorStop(1, '#2a1b4a');
  ctx.fillStyle = bg;
  ctx.fillRect(-10, -10, W + 20, H + 20);

  for (const s of sky) {
    ctx.globalAlpha = 0.4 + Math.sin(s.p) * 0.3;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 地面
  ctx.fillStyle = '#1a1336';
  ctx.fillRect(0, H - 50, W, 50);

  for (const it of g.items) drawItem(it);
  if (g.mode !== 'menu') drawBasket();

  for (const p of g.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  for (const t of g.texts) {
    ctx.globalAlpha = Math.max(0, t.life / 0.9);
    ctx.fillStyle = t.color;
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (g.mode === 'play') {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(g.score), 18, 44);
    if (g.combo >= 3) {
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#ffe27a';
      ctx.fillText('连击 x' + g.combo, 18, 76);
    }
    for (let i = 0; i < g.lives; i++) {
      ctx.fillStyle = '#ff6b8a';
      heartPath(W - 26 - i * 26, 58, 9);
      ctx.fill();
    }
  } else if (g.mode === 'menu') {
    centerText('星星收集者', H * 0.32, 38, '#ffe27a');
    centerText('按住屏幕左右拖动篮子', H * 0.42, 16, '#d0d4ff', 'normal');
    centerText('接星星 · 躲炸弹 · 金星 +5', H * 0.42 + 26, 16, '#d0d4ff', 'normal');
    centerText('点击开始', H * 0.58, 22, '#ffffff');
    if (best > 0) centerText('最高分 ' + best, H * 0.58 + 40, 15, '#9aa0d8', 'normal');
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    centerText('游戏结束', H * 0.32, 34, '#ffffff');
    centerText(String(g.score), H * 0.43, 56, '#ffe27a');
    centerText(g.newBest ? '新纪录！' : '最高分 ' + best, H * 0.52, 18, g.newBest ? '#ffb703' : '#c0c4ee', 'normal');
    centerText('点击再来一局', H * 0.64, 20, '#ffffff');
  }
}

// ---------- 输入 ----------
function onPress(e) {
  const t = e.touches[0] || e.changedTouches[0];
  if (g.mode === 'menu') {
    reset();
  } else if (g.mode === 'over') {
    if (Date.now() - g.overAt > 600) reset();
    return;
  }
  if (t) g.targetX = Math.max(BASKET_W / 2, Math.min(W - BASKET_W / 2, t.clientX));
}
wx.onTouchStart(onPress);
wx.onTouchMove(function (e) {
  if (g.mode !== 'play') return;
  const t = e.touches[0];
  if (t) g.targetX = Math.max(BASKET_W / 2, Math.min(W - BASKET_W / 2, t.clientX));
});

// ---------- 主循环 ----------
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
