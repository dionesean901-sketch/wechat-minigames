/**
 * 叠叠高 —— 微信小游戏
 * 玩法：方块左右滑动，点击屏幕让它落下。和下面方块不重叠的部分会被切掉。
 *   误差很小时算"完美"，连续 3 次完美方块会变宽一点。方块完全落空则游戏结束。
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

const BEST_KEY = 'stack-tower-best';
const BH = 28; // 方块高度
const BASE_W = Math.min(220, W * 0.6);
const BASE_Y = H - 140; // 底座顶部在世界坐标中的位置
const PERFECT = 5; // 完美判定像素

let best = Number(wx.getStorageSync(BEST_KEY)) || 0;

const g = {
  mode: 'menu',
  stack: [], // {x, w, hue}
  mover: null, // {x, w, dir, speed, hue}
  debris: [],
  rings: [],
  cam: 0,
  camTarget: 0,
  perfectRun: 0,
  overAt: 0,
  newBest: false,
  flash: 0
};

function blockY(i) {
  return BASE_Y - i * BH;
}

function reset() {
  g.mode = 'play';
  g.stack = [{ x: (W - BASE_W) / 2, w: BASE_W, hue: 200 }];
  g.debris = [];
  g.rings = [];
  g.cam = g.camTarget = 0;
  g.perfectRun = 0;
  g.newBest = false;
  nextMover();
}

function score() {
  return g.stack.length - 1;
}

function nextMover() {
  const top = g.stack[g.stack.length - 1];
  const n = g.stack.length;
  const fromLeft = n % 2 === 1;
  g.mover = {
    w: top.w,
    x: fromLeft ? -top.w * 0.6 : W - top.w * 0.4,
    dir: fromLeft ? 1 : -1,
    speed: Math.min(420, 150 + n * 9),
    hue: (200 + n * 9) % 360
  };
  // 镜头：保证塔顶大约在屏幕 45% 高度
  g.camTarget = Math.max(0, H * 0.45 - blockY(n));
}

function drop() {
  const m = g.mover;
  const top = g.stack[g.stack.length - 1];
  const y = blockY(g.stack.length);
  const left = Math.max(m.x, top.x);
  const right = Math.min(m.x + m.w, top.x + top.w);

  if (right <= left) {
    // 完全落空
    g.debris.push({ x: m.x, y, w: m.w, hue: m.hue, vy: 0, vx: m.dir * 40, rot: 0, vr: m.dir * 1.5 });
    g.mover = null;
    gameOver();
    return;
  }

  if (Math.abs(m.x - top.x) <= PERFECT) {
    g.perfectRun++;
    let w = top.w;
    let x = top.x;
    if (g.perfectRun >= 3) {
      const grow = Math.min(8, BASE_W - w);
      w += grow;
      x -= grow / 2;
    }
    g.stack.push({ x, w, hue: m.hue });
    g.rings.push({ x: x + w / 2, y: y + BH / 2, w, life: 0.5 });
    g.flash = 0.15;
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
  } else {
    g.perfectRun = 0;
    g.stack.push({ x: left, w: right - left, hue: m.hue });
    // 切掉的部分
    if (m.x < left) {
      g.debris.push({ x: m.x, y, w: left - m.x, hue: m.hue, vy: 0, vx: -60, rot: 0, vr: -2 });
    }
    if (m.x + m.w > right) {
      g.debris.push({ x: right, y, w: m.x + m.w - right, hue: m.hue, vy: 0, vx: 60, rot: 0, vr: 2 });
    }
  }
  nextMover();
}

function gameOver() {
  g.mode = 'over';
  g.overAt = Date.now();
  if (score() > best) {
    best = score();
    g.newBest = true;
    wx.setStorageSync(BEST_KEY, best);
  }
}

function update(dt) {
  if (g.mode === 'play' && g.mover) {
    const m = g.mover;
    m.x += m.dir * m.speed * dt;
    const minX = -m.w * 0.6;
    const maxX = W - m.w * 0.4;
    if (m.x > maxX) { m.x = maxX; m.dir = -1; }
    if (m.x < minX) { m.x = minX; m.dir = 1; }
  }
  g.cam += (g.camTarget - g.cam) * Math.min(1, dt * 6);

  for (let i = g.debris.length - 1; i >= 0; i--) {
    const d = g.debris[i];
    d.vy += 900 * dt;
    d.y += d.vy * dt;
    d.x += d.vx * dt;
    d.rot += d.vr * dt;
    if (d.y + g.cam > H + 200) g.debris.splice(i, 1);
  }
  for (let i = g.rings.length - 1; i >= 0; i--) {
    g.rings[i].life -= dt;
    if (g.rings[i].life <= 0) g.rings.splice(i, 1);
  }
  if (g.flash > 0) g.flash -= dt;
}

// ---------- 绘制 ----------
function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
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

function drawBlock(x, y, w, hue) {
  ctx.fillStyle = 'hsl(' + hue + ',62%,58%)';
  roundRect(x, y, w, BH - 2, 4);
  ctx.fill();
  ctx.fillStyle = 'hsla(' + hue + ',70%,80%,0.6)';
  ctx.fillRect(x + 3, y + 2, Math.max(0, w - 6), 4);
}

function centerText(text, y, size, color, weight) {
  ctx.fillStyle = color;
  ctx.font = (weight || 'bold') + ' ' + size + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, y);
}

function render() {
  const n = g.stack.length;
  const hue = (200 + n * 9) % 360;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'hsl(' + hue + ',45%,88%)');
  bg.addColorStop(1, 'hsl(' + ((hue + 40) % 360) + ',40%,70%)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(0, g.cam);

  // 地面
  ctx.fillStyle = 'rgba(30,30,50,0.25)';
  ctx.fillRect(0, BASE_Y + BH, W, H);

  for (let i = 0; i < g.stack.length; i++) {
    const b = g.stack[i];
    const y = blockY(i);
    if (y + g.cam > H + BH || y + g.cam < -BH) continue;
    drawBlock(b.x, y, b.w, b.hue);
  }
  if (g.mover && g.mode === 'play') drawBlock(g.mover.x, blockY(g.stack.length), g.mover.w, g.mover.hue);

  for (const d of g.debris) {
    ctx.save();
    ctx.translate(d.x + d.w / 2, d.y + BH / 2);
    ctx.rotate(d.rot);
    drawBlock(-d.w / 2, -BH / 2, d.w, d.hue);
    ctx.restore();
  }
  for (const r of g.rings) {
    const k = 1 - r.life / 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,' + (1 - k) + ')';
    ctx.lineWidth = 3;
    roundRect(r.x - r.w / 2 - k * 20, r.y - BH / 2 - k * 12, r.w + k * 40, BH + k * 24, 6);
    ctx.stroke();
  }
  ctx.restore();

  if (g.flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + g.flash * 2 + ')';
    ctx.fillRect(0, 0, W, H);
  }

  if (g.mode === 'play') {
    centerText(String(score()), 80, 48, 'rgba(40,40,60,0.85)');
    if (g.perfectRun >= 2) centerText('完美 x' + g.perfectRun, 118, 16, 'rgba(40,40,60,0.7)', 'normal');
  } else if (g.mode === 'menu') {
    centerText('叠叠高', H * 0.28, 42, '#2b2d42');
    centerText('点击屏幕，让方块落下', H * 0.36, 16, '#3d405b', 'normal');
    centerText('对得越准，塔越高', H * 0.36 + 24, 16, '#3d405b', 'normal');
    centerText('点击开始', H * 0.5, 22, '#2b2d42');
    if (best > 0) centerText('最高 ' + best + ' 层', H * 0.5 + 36, 15, '#3d405b', 'normal');
  } else {
    ctx.fillStyle = 'rgba(20,20,35,0.5)';
    ctx.fillRect(0, 0, W, H);
    centerText('倒塌了', H * 0.3, 32, '#ffffff');
    centerText(score() + ' 层', H * 0.41, 52, '#ffffff');
    centerText(g.newBest ? '新纪录！' : '最高 ' + best + ' 层', H * 0.5, 18, g.newBest ? '#ffd166' : '#e0e0f0', 'normal');
    centerText('点击再来一局', H * 0.62, 20, '#ffffff');
  }
}

// ---------- 输入 ----------
wx.onTouchStart(function () {
  if (g.mode === 'menu') reset();
  else if (g.mode === 'over') {
    if (Date.now() - g.overAt > 700) reset();
  } else if (g.mover) drop();
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
