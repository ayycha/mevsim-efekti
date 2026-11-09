(() => {
  'use strict';

  /* ===================== AYARLAR (isterseniz değiştirin) ===================== */
  const COL = 2;                  // yığın haritası sütun genişliği (px)
  const SNOW_MAX_PILE = 34;       // kar yığınının EN YÜKSEK seviyesi (px) - daha fazla yükselmez
  const SNOW_GROW = 2.0;          // her kar tanesinin yığına katkısı
  const LEAF_MAX_PILE = 14;       // yaprak yığınının en yüksek seviyesi (px)
  const LEAF_GROW = 3.0;          // her yaprağın yığına katkısı

  const BALL_START_R = 7;         // kartopunun başlangıç yarıçapı
  const BALL_MAX_R = 30;          // kartopunun en büyük yarıçapı
  const MAX_BALLS = 6;            // aynı anda en fazla kartopu
  const ROLL_SPEED_MAX = 14;      // fare bundan YAVAŞSA kartopu yuvarlanır (px/kare, 60fps)
  const FLICK_SPEED = 26;         // fare bundan HIZLIYSA kar uçar / top fırlar
  const ZONE_ABOVE = 26;          // fare, yığının bu kadar üstünden itibaren etkileşir
  const SCATTER_RADIUS = 44;      // karın uçtuğu alan yarıçapı
  const MIN_PILE_SNOW = 5;        // etkileşim için gereken en az kar yüksekliği
  const MIN_PILE_LEAF = 3;
  const MIN_LEDGE_Y = 60;         // bundan yukarıdaki pencere kenarlarına biriktirme
  const MIN_LEDGE_W = 120;        // bundan dar pencerelere biriktirme
  const MAX_BITS = 400;
  const WINDOW_BLOW_SPEED = 2.5;  // pencere bundan hızlı sürüklenirse üstündeki kar/yapraklar savrulur (px/kare)

  const DENSITY = {               // 1920px genişlikteki ekran için parçacık sayıları
    low:    { snow: 90,  leaf: 30, settled: 160 },
    medium: { snow: 180, leaf: 55, settled: 320 },
    high:   { snow: 320, leaf: 95, settled: 520 },
  };
  const SPEED = { slow: 0.5, normal: 1, fast: 1.8 };
  const LEAF_COLORS = ['#c0392b', '#d35400', '#e67e22', '#f39c12', '#b9770e', '#8e3b0f', '#a93226', '#d4a017'];
  /* ========================================================================== */

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  const FLOOR_ID = 'floor';
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let cfg = { mode: 'snow', density: 'medium', speed: 'normal', opacity: 1, accumulate: true, interactive: true, floorOffset: 0 };
  let W = 0, H = 0, dpr = 1, floorY = 0, scale = 1;
  let floor = null;                 // zemin (görev çubuğunun üstü)
  const wins = new Map();           // açık pencereler: id -> {x,y,w,h,tx,ty,tw,th,z,cols,heights}
  let ledgeArr = [];                // kar biriktirilebilen kenarlar (zemin + pencere üstleri)
  let ledgeMap = new Map();
  let winLedges = [];               // sadece pencere kenarları, arkadan öne sıralı
  let flakes = [], leaves = [], settled = [], balls = [], bits = [];
  let baseLeafCount = 0;
  let wind = 0, tick = 0;

  const cur = { x: -9999, y: -9999, vx: 0, vy: 0, speed: 0, t: 0, valid: false };
  let held = null, dwell = 0, slowPath = 0;

  /* ---------- Yaprak şekilleri ---------- */
  const MIDRIB = new Path2D('M0,-8 L0,11');
  const LEAF_SHAPES = [
    new Path2D('M0,-10 C7,-6 7,5 0,10 C-7,5 -7,-6 0,-10 Z'),
    (() => {
      const pts = [[0,-10],[2,-6],[6,-8],[5,-3],[10,-2],[6,2],[8,6],[2,5],[1,10],[-1,10],[-2,5],[-8,6],[-6,2],[-10,-2],[-5,-3],[-6,-8],[-2,-6]];
      const p = new Path2D();
      pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      p.closePath();
      return p;
    })(),
  ];

  /* ---------- Kenarlar (ledge) ve yığın haritası ---------- */
  function allocHeights(L) {
    const cols = Math.ceil(Math.round(L.w) / COL) + 1;
    if (!L.heights || L.cols !== cols) {
      const nh = new Float32Array(cols);
      if (L.heights) nh.set(L.heights.subarray(0, Math.min(cols, L.cols)));
      L.heights = nh;
      L.cols = cols;
    }
  }

  function hAt(L, x) {
    if (!L.heights) return 0;
    let i = ((x - L.x) / COL) | 0;
    if (i < 0) i = 0; else if (i >= L.cols) i = L.cols - 1;
    return L.heights[i];
  }

  function addPile(L, x, amount, radius, max) {
    if (!L.heights) return;
    const c = ((x - L.x) / COL) | 0;
    for (let i = -radius; i <= radius; i++) {
      const k = c + i;
      if (k < 0 || k >= L.cols) continue;
      const w = 1 - Math.abs(i) / (radius + 1);
      L.heights[k] = Math.max(0, Math.min(max, L.heights[k] + amount * w));
    }
  }

  // Tepeleri yumuşatır, kartopu izlerini zamanla düzeltir
  function smooth(L) {
    const h = L.heights;
    if (!h) return;
    let prev = h[0];
    for (let i = 1; i < L.cols - 1; i++) {
      const cur0 = h[i];
      h[i] = cur0 * 0.5 + (prev + h[i + 1]) * 0.25;
      prev = cur0;
    }
  }

  function drawPile(L, fill, stroke) {
    const hs = L.heights;
    if (!hs) return;
    let max = 0;
    for (let i = 0; i < L.cols; i++) if (hs[i] > max) max = hs[i];
    if (max < 0.4) return;
    const xr = L.x + L.w;
    ctx.beginPath();
    ctx.moveTo(L.x, L.y);
    for (let i = 0; i < L.cols; i++) ctx.lineTo(Math.min(L.x + i * COL, xr), L.y - hs[i]);
    ctx.lineTo(xr, L.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Bir parçacık (x) üstten aşağı inerken hangi kenara konuyor?
  function findLanding(x, prevBottom, bottom) {
    for (let i = 0; i < ledgeArr.length; i++) {
      const L = ledgeArr[i];
      if (x < L.x || x > L.x + L.w) continue;
      if (prevBottom > L.y + 1) continue;            // zaten kenarın altında (pencere içinde)
      const surf = L.y - (cfg.accumulate ? hAt(L, x) : 0);
      if (bottom >= surf) return L;
    }
    return null;
  }

  /* ---------- Pencere konumları (main.js'ten gelir) ---------- */
  function stepWindows(rawDt) {
    const k = Math.min(1, 0.6 * rawDt);
    ledgeArr = [floor];
    ledgeMap = new Map([[FLOOR_ID, floor]]);
    winLedges = [];
    for (const L of wins.values()) {
      const px = L.x, py = L.y;
      L.x += (L.tx - L.x) * k; if (Math.abs(L.tx - L.x) < 0.5) L.x = L.tx;
      L.y += (L.ty - L.y) * k; if (Math.abs(L.ty - L.y) < 0.5) L.y = L.ty;
      L.w += (L.tw - L.w) * k; if (Math.abs(L.tw - L.w) < 0.5) L.w = L.tw;
      L.h += (L.th - L.h) * k; if (Math.abs(L.th - L.h) < 0.5) L.h = L.th;
      if (L.y >= MIN_LEDGE_Y && L.y < floorY - 20 && L.w >= MIN_LEDGE_W) {
        allocHeights(L);
        ledgeArr.push(L);
        ledgeMap.set(L.id, L);
        winLedges.push(L);
        // Pencere sürüklenirse üstündeki kar / yapraklar savrulur
        const m = Math.max(0.2, rawDt);
        const mvx = (L.x - px) / m, mvy = (L.y - py) / m;
        if (cfg.accumulate && Math.hypot(mvx, mvy) >= WINDOW_BLOW_SPEED) blowOff(L, mvx, mvy);
      }
    }
    winLedges.sort((a, b) => b.z - a.z);
  }

  // Sürüklenen pencerenin üstündeki karı (ya da yaprakları) havaya savurur
  function blowOff(L, mvx, mvy) {
    const sp = Math.hypot(mvx, mvy);
    const frac = Math.min(0.5, 0.1 + sp * 0.02);        // her karede yığının ne kadarı uçar
    const vxBase = clamp(-mvx * 0.7, -14, 14);           // pencerenin gittiği yönün tersine savrulur
    const vyBase = clamp(-mvy * 0.3, -6, 6);
    const BIT_MASS = 14;
    let acc = 0;
    for (let k = 0; k < L.cols; k++) {
      const t = L.heights[k] * frac;
      if (t <= 0) continue;
      L.heights[k] -= t;
      if (L.heights[k] < 0.3) L.heights[k] = 0;
      if (cfg.mode === 'snow') {
        acc += t;
        while (acc >= BIT_MASS) {
          acc -= BIT_MASS;
          addBit(L.x + k * COL, L.y - L.heights[k] - rand(0, 4), vxBase + rand(-3, 3), vyBase - rand(1.5, 5));
        }
      }
    }
    if (cfg.mode === 'snow') {
      for (const b of balls) {                           // pencerenin üstündeki toplar da fırlar
        if (b.lid === L.id && !b.held) { b.lid = null; b.vx = vxBase; b.vy = -rand(2, 5); b.rest = 0; }
      }
    } else {
      let n = 0;
      for (let i = settled.length - 1; i >= 0 && n < 15; i--) {
        const s = settled[i];
        if (s.lid !== L.id || Math.random() > 0.4) continue;
        settled.splice(i, 1);
        n++;
        if (leaves.length >= baseLeafCount * 2.5) continue;
        const lf = makeLeaf(false);
        lf.x = L.x + s.ox; lf.y = L.y + s.oy;
        lf.s = s.s; lf.rot = s.rot; lf.color = s.color; lf.shape = s.shape;
        lf.vx = vxBase + rand(-3, 3);
        lf.vy = vyBase - rand(2, 6);
        leaves.push(lf);
      }
    }
  }

  function cutWindows(zLimit) {
    if (wins.size === 0) return;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    for (const L of wins.values()) {
      if (L.z < zLimit) ctx.fillRect(Math.round(L.x), Math.round(L.y), Math.round(L.w), Math.round(L.h));
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- KAR ---------- */
  function makeFlake(initial) {
    const r = rand(1.2, 3.2);
    return {
      x: rand(0, W),
      y: initial ? rand(-50, floorY) : rand(-30, -3),
      r, vy: r * 0.5 + rand(0.4, 1.0),
      phase: rand(0, TAU), ps: rand(0.01, 0.03), sway: rand(0.2, 0.8),
    };
  }

  function updateFlakes(dt) {
    for (const f of flakes) {
      const prevBottom = f.y + f.r;
      f.phase += f.ps * dt;
      f.x += (Math.sin(f.phase) * f.sway + wind * (0.5 + f.r * 0.3)) * dt;
      f.y += f.vy * dt;
      if (f.x < -10) f.x = W + 10; else if (f.x > W + 10) f.x = -10;

      const L = findLanding(f.x, prevBottom, f.y + f.r);
      if (L) {
        if (cfg.accumulate) addPile(L, f.x, SNOW_GROW * (f.r / 2), 4, SNOW_MAX_PILE);
        Object.assign(f, makeFlake(false));
      } else if (f.y > H + 20) {
        Object.assign(f, makeFlake(false));
      }
    }
  }

  function drawFlakes() {
    ctx.beginPath();
    for (const f of flakes) { ctx.moveTo(f.x + f.r, f.y); ctx.arc(f.x, f.y, f.r, 0, TAU); }
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,150,200,0.4)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  /* ---------- Uçuşan kar kırıntıları ---------- */
  function addBit(x, y, vx, vy) {
    if (bits.length >= MAX_BITS) return;
    const life = rand(35, 70);
    bits.push({ x, y, vx, vy, r: rand(1, 2.8), life, max: life });
  }

  function updateBits(dt) {
    for (let i = bits.length - 1; i >= 0; i--) {
      const p = bits[i];
      p.vy += 0.15 * dt;
      p.vx *= Math.pow(0.97, dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0 || p.y > H + 20) bits.splice(i, 1);
    }
  }

  function drawBits() {
    for (const p of bits) {
      ctx.fillStyle = 'rgba(255,255,255,' + Math.max(0, p.life / p.max) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
  }

  /* ---------- KARTOPU (fareyle yuvarlanır) ---------- */
  function topAround(L, b) {
    const c = Math.round((b.x - L.x) / COL);
    const span = Math.max(2, Math.ceil(b.r * 0.8 / COL));
    let t = 0;
    for (let k = c - span; k <= c + span; k++) {
      if (k >= 0 && k < L.cols && L.heights[k] > t) t = L.heights[k];
    }
    return t;
  }

  // Yuvarlanırken yoldaki kardan toplar ve büyür
  function collect(b, L, dist) {
    if (dist <= 0) return;
    const c = Math.round((b.x - L.x) / COL);
    const span = Math.max(2, Math.ceil(b.r * 0.8 / COL));
    const a = 0.12 * dist;
    let total = 0;
    for (let k = c - span; k <= c + span; k++) {
      if (k < 0 || k >= L.cols) continue;
      const take = Math.min(L.heights[k], a);
      L.heights[k] -= take;
      total += take;
    }
    if (b.r < BALL_MAX_R) b.r = Math.min(BALL_MAX_R, b.r + total * 0.02);
  }

  function settleY(b, L, top, k) {
    const ty = L.y - top - b.r * 0.85;
    b.y += (ty - b.y) * Math.min(1, 0.3 * k);
  }

  function burst(b) {
    const n = Math.round(b.r * 1.2);
    for (let i = 0; i < n; i++) {
      addBit(b.x + rand(-b.r, b.r) * 0.5, b.y + rand(-b.r, 0), rand(-2.5, 2.5), rand(-3.5, -0.5));
    }
  }

  function updateBalls(dt, rawDt) {
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      const L = b.lid !== null ? ledgeMap.get(b.lid) : null;
      if (b.lid !== null && !L) {                 // üstünde durduğu pencere kapandı
        b.lid = null;
        if (b.held) { b.held = false; held = null; }
      }
      let remove = false;

      if (b.held && L) {
        // Fareyle taşınan top: imleci takip eder, kar toplayıp büyür
        const prevX = b.x;
        const top = topAround(L, b);
        b.x += (cur.x - b.x) * Math.min(1, 0.45 * rawDt);
        b.x = clamp(b.x, L.x + 4, L.x + L.w - 4);
        const dx = b.x - prevX;
        collect(b, L, Math.abs(dx));
        b.rot += dx / b.r;
        b.vx = dx / Math.max(0.2, rawDt);
        settleY(b, L, top, rawDt);
      } else if (L) {
        // Serbest top: yuvarlanır, sürtünmeyle yavaşlar
        const top = topAround(L, b);
        const mv = b.vx * dt;
        b.x += mv;
        b.vx *= Math.pow(0.985, dt);
        collect(b, L, Math.abs(mv));
        b.rot += mv / b.r;
        settleY(b, L, top, dt);
        if (Math.abs(b.vx) < 0.05) b.rest += dt; else b.rest = 0;
        if (b.rest > 1200) {                      // uzun süre durursa erir
          addPile(L, b.x, b.r * 0.5, 6, SNOW_MAX_PILE);
          remove = true;
        } else if (b.x < L.x - 2 || b.x > L.x + L.w + 2) {
          b.lid = null; b.vy = 0;                 // kenardan yuvarlanıp düşer
        }
      } else {
        // Havada: yerçekimi
        const prevBottom = b.y + b.r * 0.85;
        b.vy += 0.35 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.rot += (b.vx * dt) / b.r;
        b.vx *= Math.pow(0.998, dt);
        const T = findLanding(b.x, prevBottom, b.y + b.r * 0.85);
        if (T) {
          if (b.vy > 15 && b.r > 9) {             // çok yüksekten düşerse parçalanır
            burst(b);
            remove = true;
          } else {
            b.lid = T.id;
            b.vx *= 0.8; b.vy = 0;
            b.y = T.y - hAt(T, b.x) - b.r * 0.85;
          }
        }
      }

      if (b.x < -80 || b.x > W + 80 || b.y > H + 100) remove = true;
      if (remove) {
        if (b === held) held = null;
        balls.splice(i, 1);
      }
    }
  }

  function drawBalls(lid) {
    for (const b of balls) {
      if (b.lid !== lid) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      const g = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.3, b.r * 0.1, 0, 0, b.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#cfe0f5');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(150,180,220,0.85)';
      ctx.lineWidth = 1; ctx.stroke();
      ctx.rotate(b.rot);                // dönen doku çizgileri
      ctx.strokeStyle = 'rgba(160,190,225,0.75)';
      ctx.beginPath(); ctx.arc(0, 0, b.r * 0.62, 0.3, 1.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, b.r * 0.35, 3.4, 4.9); ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- Fare etkileşimi (kar) ---------- */
  // İmlecin bulunduğu, yeterince kar birikmiş kenarı bulur
  function zoneLedge(minPile) {
    for (const L of ledgeArr) {
      if (cur.x < L.x || cur.x > L.x + L.w) continue;
      const h = hAt(L, cur.x);
      if (h < minPile) continue;
      if (cur.y >= L.y - h - ZONE_ABOVE && cur.y <= L.y + 4) return L;
    }
    return null;
  }

  function scatter(L) {
    const R = SCATTER_RADIUS;
    const c0 = Math.round((cur.x - L.x) / COL);
    const span = Math.ceil(R / COL);
    let taken = 0;
    for (let k = c0 - span; k <= c0 + span; k++) {
      if (k < 0 || k >= L.cols) continue;
      const w = 1 - Math.abs(k - c0) / (span + 1);
      const t = Math.min(L.heights[k], L.heights[k] * 0.5 * w + 0.3 * w);
      L.heights[k] -= t;
      taken += t;
    }
    const n = Math.min(24, Math.floor(taken / 2.2));
    for (let i = 0; i < n; i++) {
      addBit(
        cur.x + rand(-R, R) * 0.8,
        L.y - hAt(L, cur.x) - rand(0, 6),
        clamp(cur.vx * 0.3, -8, 8) + rand(-2.5, 2.5),
        -rand(2, 6) + clamp(cur.vy * 0.1, -3, 3)
      );
    }
  }

  function spawnBall(L) {
    if (balls.length >= MAX_BALLS) balls.shift();
    const top = hAt(L, cur.x);
    const b = {
      x: cur.x, y: L.y - top - BALL_START_R, r: BALL_START_R,
      vx: 0, vy: 0, rot: 0, lid: L.id, held: true, rest: 0, touch: 0,
    };
    balls.push(b);
    held = b;
  }

  function releaseHeld() {
    const b = held;
    held = null;
    if (!b) return;
    b.held = false;
    b.vx = clamp(b.vx * 0.6, -12, 12);
  }

  function throwBall(b) {
    if (b === held) held = null;
    b.held = false;
    b.lid = null;
    b.vx = clamp(cur.vx * 0.6, -22, 22);
    b.vy = clamp(cur.vy * 0.6 - 3, -22, 22);
    b.touch = 0; b.rest = 0;
  }

  function nearAnyBall(pad) {
    for (const b of balls) if (Math.hypot(cur.x - b.x, cur.y - b.y) < b.r + pad) return true;
    return false;
  }

  function interactSnow(rawDt) {
    const active = cfg.interactive && cfg.accumulate && cur.valid;
    if (!active) { releaseHeld(); dwell = 0; slowPath = 0; return; }
    const fast = cur.speed >= FLICK_SPEED;
    const slow = cur.speed >= 0.4 && cur.speed < ROLL_SPEED_MAX;

    // Duran toplara dokunma: hızlıysa fırlat, yavaşsa tutup yuvarla
    for (const b of balls) {
      if (b === held) continue;
      if (Math.hypot(cur.x - b.x, cur.y - b.y) < b.r + 14) {
        if (fast) throwBall(b);
        else if (slow && !held && b.lid !== null) {
          b.touch += rawDt;
          if (b.touch > 6) { held = b; b.held = true; b.vx = 0; b.vy = 0; b.touch = 0; }
        } else b.touch = 0;
      } else b.touch = 0;
    }

    if (held) {
      const L = ledgeMap.get(held.lid);
      const top = L ? hAt(L, held.x) : 0;
      const inZone = L && cur.x >= L.x && cur.x <= L.x + L.w && cur.y >= L.y - top - 90 && cur.y <= L.y + 24;
      if (fast) throwBall(held);
      else if (!inZone) releaseHeld();
      dwell = 0; slowPath = 0;
      return;
    }

    const L = zoneLedge(MIN_PILE_SNOW);
    if (!L) { dwell = 0; slowPath = 0; return; }
    if (fast) { scatter(L); dwell = 0; slowPath = 0; return; }
    if (slow) {
      dwell += rawDt;
      slowPath += cur.speed * rawDt;
      if (dwell >= 20 && slowPath >= 40 && !nearAnyBall(20)) { spawnBall(L); dwell = 0; slowPath = 0; }
    } else {
      dwell = Math.max(0, dwell - rawDt);
    }
  }

  /* ---------- SONBAHAR YAPRAKLARI ---------- */
  function makeLeaf(initial) {
    const vy0 = rand(0.7, 1.5);
    return {
      x: rand(0, W),
      y: initial ? rand(-50, floorY * 0.9) : rand(-60, -10),
      s: rand(0.9, 1.5), vy: vy0, vy0, vx: 0,
      phase: rand(0, TAU), ps: rand(0.015, 0.035), sway: rand(0.8, 1.8),
      rot: rand(0, TAU), vr: rand(-0.03, 0.03),
      flip: rand(0, TAU), fs: rand(0.03, 0.08),
      color: LEAF_COLORS[(Math.random() * LEAF_COLORS.length) | 0],
      shape: Math.random() < 0.55 ? 0 : 1,
    };
  }

  function drawLeaf(x, y, rot, s, flipScale, color, shape, flat) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    if (flat) ctx.scale(s, s * 0.45);
    else ctx.scale(s * flipScale, s);
    ctx.fillStyle = color;
    ctx.fill(LEAF_SHAPES[shape]);
    ctx.strokeStyle = 'rgba(60,25,5,0.45)';
    ctx.lineWidth = 0.8;
    ctx.stroke(MIDRIB);
    ctx.restore();
  }

  function recycleLeaf(i) {
    if (leaves.length > baseLeafCount) leaves.splice(i, 1);
    else leaves[i] = makeLeaf(false);
  }

  function updateLeaves(dt) {
    const cap = Math.round(DENSITY[cfg.density].settled * scale);
    for (let i = leaves.length - 1; i >= 0; i--) {
      const l = leaves[i];
      const prevBottom = l.y + 3;
      l.phase += l.ps * dt;
      l.flip += l.fs * dt;
      l.vy += (l.vy0 - l.vy) * Math.min(1, 0.05 * dt);
      l.vx *= Math.pow(0.95, dt);
      l.x += (Math.sin(l.phase) * l.sway + wind * 1.5) * dt * 0.9 + l.vx * dt;
      l.y += l.vy * dt;
      l.rot += l.vr * dt + Math.cos(l.phase) * 0.02 * dt;
      if (l.x < -20) l.x = W + 20; else if (l.x > W + 20) l.x = -20;

      const L = findLanding(l.x, prevBottom, l.y + 3);
      if (L) {
        if (cfg.accumulate) {
          settled.push({
            lid: L.id, ox: l.x - L.x, oy: -hAt(L, l.x) + rand(-3, 4),
            s: l.s, rot: l.rot, color: l.color, shape: l.shape,
          });
          addPile(L, l.x, LEAF_GROW, 6, LEAF_MAX_PILE);
          while (settled.length > cap) {
            const old = settled.shift();
            const OL = ledgeMap.get(old.lid);
            if (OL) addPile(OL, OL.x + old.ox, -LEAF_GROW, 6, LEAF_MAX_PILE);   // eski yaprak yığından erir
          }
        }
        recycleLeaf(i);
      } else if (l.y > H + 30) {
        recycleLeaf(i);
      }
    }
  }

  // Fare hızlı geçerse yerdeki yapraklar havalanır
  function interactLeaves() {
    if (!(cfg.interactive && cfg.accumulate && cur.valid) || cur.speed < FLICK_SPEED) return;
    if (leaves.length > baseLeafCount * 2) return;
    const L = zoneLedge(MIN_PILE_LEAF);
    if (!L) return;
    let n = 0;
    for (let i = settled.length - 1; i >= 0 && n < 12; i--) {
      const s = settled[i];
      if (s.lid !== L.id) continue;
      const sx = L.x + s.ox, sy = L.y + s.oy;
      if (Math.hypot(sx - cur.x, sy - cur.y) > SCATTER_RADIUS + 10) continue;
      settled.splice(i, 1);
      addPile(L, sx, -LEAF_GROW, 6, LEAF_MAX_PILE);
      const lf = makeLeaf(false);
      lf.x = sx; lf.y = sy; lf.s = s.s; lf.rot = s.rot; lf.color = s.color; lf.shape = s.shape;
      lf.vx = clamp(cur.vx * 0.35, -9, 9) + rand(-2, 2);
      lf.vy = -rand(3, 7);
      leaves.push(lf);
      n++;
    }
  }

  /* ---------- Kurulum ---------- */
  function rebuild() {
    floor.heights.fill(0);
    for (const L of wins.values()) if (L.heights) L.heights.fill(0);
    flakes = []; leaves = []; settled = []; balls = []; bits = [];
    held = null; dwell = 0; slowPath = 0;
    const D = DENSITY[cfg.density] || DENSITY.medium;
    if (cfg.mode === 'snow') {
      const n = Math.round(D.snow * scale);
      for (let i = 0; i < n; i++) flakes.push(makeFlake(true));
    } else {
      baseLeafCount = Math.round(D.leaf * scale);
      for (let i = 0; i < baseLeafCount; i++) leaves.push(makeLeaf(true));
    }
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    scale = Math.min(2, Math.max(0.6, W / 1920));
    floorY = H - cfg.floorOffset;
    floor = { id: FLOOR_ID, x: 0, y: floorY, w: W, h: 0, cols: 0, heights: null, z: 9999 };
    allocHeights(floor);
    ledgeArr = [floor];
    ledgeMap = new Map([[FLOOR_ID, floor]]);
    rebuild();
  }

  /* ---------- Katmanlı çizim ----------
     1) Masaüstü katmanı: yağan kar + zemin yığını (tüm pencerelerin ARKASINDA, yani pencere içi silinir)
     2) Her pencerenin kenarındaki yığın: sadece o pencerenin ÖNÜNDEKİ pencereler tarafından örtülür */
  function drawLedgeStuff(L) {
    if (!cfg.accumulate) return;
    if (cfg.mode === 'snow') {
      drawPile(L, 'rgba(255,255,255,0.97)', 'rgba(150,180,220,0.9)');
      drawBalls(L.id);
    } else {
      drawPile(L, 'rgba(107,63,26,0.9)', 'rgba(40,20,5,0.5)');
      for (const s of settled) {
        if (s.lid !== L.id) continue;
        drawLeaf(L.x + s.ox, L.y + s.oy, s.rot, s.s, 1, s.color, s.shape, true);
      }
    }
  }

  let last = performance.now();
  function frame(now) {
    const rawDt = Math.min(3, (now - last) / 16.667);
    last = now;
    const dt = rawDt * (SPEED[cfg.speed] || 1);
    tick++;
    wind = Math.sin(now * 0.0002) * 0.35 + Math.sin(now * 0.00071) * 0.15;
    if (cur.valid && now - cur.t > 150) { cur.vx = 0; cur.vy = 0; cur.speed = 0; }

    stepWindows(rawDt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (cfg.accumulate && cfg.mode === 'snow' && tick % 3 === 0) {
      for (const L of ledgeArr) smooth(L);
    }

    if (cfg.mode === 'snow') {
      interactSnow(rawDt);
      updateFlakes(dt); updateBalls(dt, rawDt); updateBits(dt);
      drawFlakes(); drawBits(); drawBalls(null);
    } else {
      interactLeaves();
      updateLeaves(dt);
      for (const l of leaves) drawLeaf(l.x, l.y, l.rot, l.s, 0.3 + 0.7 * Math.abs(Math.cos(l.flip)), l.color, l.shape, false);
    }
    drawLedgeStuff(floor);
    cutWindows(Infinity);                         // pencerelerin içi: kar görünmez
    for (const L of winLedges) {                  // arkadaki pencereden öndekine
      drawLedgeStuff(L);
      cutWindows(L.z);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Ana süreçten gelen veriler ---------- */
  window.api.onConfig((c) => {
    // Sadece saydamlık / hız / etkileşim değiştiyse birikmiş kar sıfırlanmasın
    const needRebuild =
      c.mode !== cfg.mode || c.density !== cfg.density ||
      c.accumulate !== cfg.accumulate || c.floorOffset !== cfg.floorOffset;
    cfg = { ...cfg, ...c };
    canvas.style.opacity = String(cfg.opacity);
    if (needRebuild) resize();
  });

  window.api.onWindows((list) => {
    const seen = new Set();
    list.forEach((r, z) => {
      const [id, x, y, w, h] = r;
      seen.add(id);
      let L = wins.get(id);
      if (!L) {
        L = { id, x, y, w, h, tx: x, ty: y, tw: w, th: h, z, cols: 0, heights: null };
        wins.set(id, L);
      } else {
        L.tx = x; L.ty = y; L.tw = w; L.th = h; L.z = z;
      }
    });
    for (const id of Array.from(wins.keys())) if (!seen.has(id)) wins.delete(id);
    settled = settled.filter((s) => s.lid === FLOOR_ID || wins.has(s.lid));
  });

  window.api.onCursor((p) => {
    const now = performance.now();
    if (cur.valid) {
      const f = Math.max(0.3, (now - cur.t) / 16.667);
      cur.vx += ((p.x - cur.x) / f - cur.vx) * 0.4;
      cur.vy += ((p.y - cur.y) / f - cur.vy) * 0.4;
      cur.speed = Math.hypot(cur.vx, cur.vy);
    }
    cur.x = p.x; cur.y = p.y; cur.t = now; cur.valid = true;
  });

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
