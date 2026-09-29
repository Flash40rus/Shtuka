// game.js — кор-луп «Штуки»
// Управление: тап — прыжок, свайп вниз — подкат.
// Публичный API (window.Shtuka) используется scanner.js.

(() => {
  'use strict';

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 100));
  resize();

  // ---------- Constants ----------
  const GRAVITY = 2200;
  const JUMP_V = -900;
  const SLIDE_TIME = 0.55;
  const BASE_SPEED = 320;
  const MAX_SPEED_BONUS = 420;
  const LS_GENERATED = 'shtuka_generated_v1';
  const LS_BEST = 'shtuka_best';

  // ---------- Базовые персонажи ----------
  const BASE_CHARACTERS = [
    { id: 'base_cup',    emoji: '☕', name: 'Кружка',      jump: 1.00, doubleJump: false },
    { id: 'base_sock',   emoji: '🧦', name: 'Носок',       jump: 1.00, doubleJump: true  },
    { id: 'base_banana', emoji: '🍌', name: 'Банан',       jump: 1.10, doubleJump: false },
    { id: 'base_cat',    emoji: '🐱', name: 'Кот',         jump: 1.20, doubleJump: false },
    { id: 'base_kbd',    emoji: '⌨️', name: 'Клавиатура',  jump: 0.90, doubleJump: false },
    { id: 'base_book',   emoji: '📚', name: 'Книга',       jump: 1.00, doubleJump: false },
  ];

  // Список всех персонажей (базовые + сгенерированные из localStorage)
  const CHARACTERS = [...BASE_CHARACTERS];

  // ---------- State ----------
  let selectedChar = CHARACTERS[0];
  let state = 'menu';
  let best = parseInt(localStorage.getItem(LS_BEST) || '0', 10);

  const G = {
    t: 0,
    distance: 0,
    score: 0,
    speed: BASE_SPEED,
    groundY: 0,
    bgOffset: 0,
    stars: [],
    player: null,
    obstacles: [],
    particles: [],
    spawnTimer: 1.0,
  };

  // ---------- Public API (для scanner.js) ----------
  window.Shtuka = {
    addCharacter(c) {
      if (!CHARACTERS.find(x => x.id === c.id)) CHARACTERS.push(c);
      buildCharPicker();
    },
    selectCharacter(id) {
      const c = CHARACTERS.find(x => x.id === id);
      if (c) { selectedChar = c; buildCharPicker(); }
    },
    removeCharacter(id) {
      const idx = CHARACTERS.findIndex(x => x.id === id);
      if (idx >= 0) CHARACTERS.splice(idx, 1);
      if (selectedChar.id === id) selectedChar = CHARACTERS[0];
      buildCharPicker();
    },
    getSelected() { return selectedChar; },
    getAll()      { return CHARACTERS; },
    LS_GENERATED,
  };

  // ---------- Reset ----------
  function resetGame() {
    G.t = 0;
    G.distance = 0;
    G.score = 0;
    G.speed = BASE_SPEED;
    G.groundY = Math.floor(H * 0.78);
    G.bgOffset = 0;
    G.obstacles.length = 0;
    G.particles.length = 0;
    G.spawnTimer = 1.0;

    G.stars = [];
    for (let i = 0; i < 70; i++) {
      G.stars.push({
        x: Math.random() * W,
        y: Math.random() * G.groundY,
        r: Math.random() * 1.4 + 0.4,
        depth: Math.random() * 0.4 + 0.1,
      });
    }

    const c = selectedChar;
    G.player = {
      x: W * 0.22,
      y: G.groundY,
      vy: 0,
      w: 46,
      h: 46,
      onGround: true,
      jumps: 0,
      sliding: false,
      slideTimer: 0,
      rotation: 0,
      emoji: c.emoji,
      photo: c.photo || null,
      char: c,
    };

    // Готовим картинку, если у персонажа есть фото
    if (c.photo && !c._img) {
      const img = new Image();
      img.src = c.photo;
      c._img = img;
    }
  }

  // ---------- Input ----------
  let touchStartY = 0;
  let touchStartT = 0;

  function onDown(clientY) {
    if (state !== 'playing') return;
    touchStartY = clientY;
    touchStartT = performance.now();
  }

  function onUp(clientY) {
    if (state !== 'playing') return;
    const dy = clientY - touchStartY;
    const dt = performance.now() - touchStartT;
    if (dy > 40 && dt < 500) doSlide();
    else doJump();
  }

  canvas.addEventListener('touchstart', e => onDown(e.touches[0].clientY), { passive: true });
  canvas.addEventListener('touchend',   e => onUp(e.changedTouches[0].clientY), { passive: true });
  canvas.addEventListener('mousedown',  e => onDown(e.clientY));
  canvas.addEventListener('mouseup',    e => onUp(e.clientY));

  window.addEventListener('keydown', e => {
    if (state !== 'playing') return;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault(); doJump();
    }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault(); doSlide();
    }
  });

  function doJump() {
    const p = G.player;
    if (!p) return;
    if (p.onGround) {
      p.vy = JUMP_V * (p.char.jump || 1);
      p.onGround = false;
      p.jumps = 1;
      p.sliding = false;
      burst(p.x, p.y, '#4ade80', 6);
    } else if (p.char.doubleJump && p.jumps < 2) {
      p.vy = JUMP_V * 0.85 * (p.char.jump || 1);
      p.jumps = 2;
      burst(p.x, p.y, '#60a5fa', 8);
    }
  }

  function doSlide() {
    const p = G.player;
    if (!p) return;
    if (p.onGround) {
      p.sliding = true;
      p.slideTimer = SLIDE_TIME;
    } else {
      p.vy = Math.max(p.vy, 900);
    }
  }

  // ---------- Particles ----------
  function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      G.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 320,
        vy: (Math.random() - 1) * 280,
        life: 0.5, maxLife: 0.5,
        color,
        size: Math.random() * 4 + 2,
      });
    }
  }

  // ---------- Obstacles ----------
  function spawnObstacle() {
    const palette = [
      { w: 44, h: 52,  kind: 'block', emoji: '📦' },
      { w: 44, h: 100, kind: 'tall',  emoji: '🗼' },
      { w: 92, h: 40,  kind: 'wide',  emoji: '🧱' },
    ];
    if (G.score > 150) palette.push({ w: 60, h: 40, kind: 'bird', emoji: '🦅' });

    const o = palette[Math.floor(Math.random() * palette.length)];
    const y = o.kind === 'bird' ? G.groundY - 72 : G.groundY;

    G.obstacles.push({ x: W + 60, y, w: o.w, h: o.h, emoji: o.emoji });
  }

  // ---------- Update ----------
  function update(dt) {
    if (state !== 'playing') return;

    G.t += dt;
    G.speed = BASE_SPEED + Math.min(G.score * 0.15, MAX_SPEED_BONUS);
    G.distance += G.speed * dt;
    G.score += G.speed * dt * 0.05;
    G.bgOffset = (G.bgOffset + G.speed * dt * 0.3) % W;

    const p = G.player;

    p.vy += GRAVITY * dt;
    p.y += p.vy * dt;

    if (p.y >= G.groundY) {
      if (!p.onGround) burst(p.x, p.y, '#94a3b8', 4);
      p.y = G.groundY;
      p.vy = 0;
      p.onGround = true;
      p.jumps = 0;
    }

    if (p.sliding) {
      p.slideTimer -= dt;
      if (p.slideTimer <= 0) p.sliding = false;
    }

    p.rotation = p.onGround ? 0 : p.rotation + dt * 4;

    G.spawnTimer -= dt;
    if (G.spawnTimer <= 0) {
      spawnObstacle();
      const interval = Math.max(0.7, 1.4 - G.score * 0.001);
      G.spawnTimer = interval + Math.random() * 0.4;
    }

    const px = p.x - p.w / 2;
    const py = p.sliding ? p.y - p.h * 0.5 : p.y - p.h;
    const pw = p.w;
    const ph = p.sliding ? p.h * 0.5 : p.h;

    for (let i = G.obstacles.length - 1; i >= 0; i--) {
      const o = G.obstacles[i];
      o.x -= G.speed * dt;

      if (px < o.x + o.w && px + pw > o.x && py < o.y && py + ph > o.y - o.h) {
        return gameOver();
      }
      if (o.x + o.w < -80) G.obstacles.splice(i, 1);
    }

    for (let i = G.particles.length - 1; i >= 0; i--) {
      const pt = G.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 800 * dt;
      pt.life -= dt;
      if (pt.life <= 0) G.particles.splice(i, 1);
    }

    document.getElementById('score').textContent = Math.floor(G.score);
  }

  // ---------- Render ----------
  function render() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0a1020');
    sky.addColorStop(0.55, '#182238');
    sky.addColorStop(1, '#334155');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#ffffff';
    for (const s of G.stars) {
      let sx = (s.x - G.bgOffset * s.depth) % W;
      if (sx < 0) sx += W;
      ctx.globalAlpha = 0.35 + s.depth;
      ctx.beginPath();
      ctx.arc(sx, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawHills(0.15, '#1a2438', 200);
    drawHills(0.32, '#0d1424', 140);

    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, G.groundY, W, H - G.groundY);

    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, G.groundY);
    ctx.lineTo(W, G.groundY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(74, 222, 128, 0.25)';
    ctx.lineWidth = 2;
    const off = (G.distance * 1.2) % 60;
    for (let x = -off; x < W; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, G.groundY + 22);
      ctx.lineTo(x + 30, G.groundY + 22);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const o of G.obstacles) {
      ctx.font = `${o.h}px serif`;
      ctx.fillText(o.emoji, o.x + o.w / 2, o.y);
    }

    for (const pt of G.particles) {
      ctx.globalAlpha = pt.life / pt.maxLife;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const p = G.player;
    if (p) {
      ctx.save();
      ctx.translate(p.x, p.y - p.h / 2);
      if (p.rotation) ctx.rotate(p.rotation);
      if (p.sliding) ctx.scale(1.25, 0.72);

      if (p.photo) {
        // Фото-персонаж: круглый аватар
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, p.h / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        if (p.char._img && p.char._img.complete) {
          ctx.drawImage(p.char._img, -p.h / 2, -p.h / 2, p.h, p.h);
        } else {
          ctx.fillStyle = '#334155';
          ctx.fillRect(-p.h / 2, -p.h / 2, p.h, p.h);
        }
        ctx.restore();
        // Обводка
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, p.h / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.font = `${p.h}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.emoji, 0, 0);
      }
      ctx.restore();
    }
  }

  function drawHills(speedFactor, color, height) {
    const baseY = G.groundY;
    const off = (G.distance * speedFactor) % 400;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-off, baseY);
    for (let x = -off; x < W + 400; x += 200) {
      ctx.lineTo(x + 100, baseY - height - Math.sin(x * 0.01) * 30);
      ctx.lineTo(x + 200, baseY);
    }
    ctx.lineTo(W + 400, H);
    ctx.lineTo(-off, H);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- Loop ----------
  let lastT = 0;
  function loop(t) {
    const dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---------- UI ----------
  const menuEl  = document.getElementById('menu');
  const overEl  = document.getElementById('gameover');
  const scoreEl = document.getElementById('score');
  const finalEl = document.getElementById('finalScore');
  const bestEl  = document.getElementById('bestScore');

  function showScreen(el) {
    menuEl.classList.add('hidden');
    overEl.classList.add('hidden');
    if (el) el.classList.remove('hidden');
  }

  function startGame() {
    resetGame();
    state = 'playing';
    scoreEl.textContent = '0';
    showScreen(null);
  }

  function gameOver() {
    state = 'gameover';
    const final = Math.floor(G.score);
    if (final > best) {
      best = final;
      localStorage.setItem(LS_BEST, String(best));
    }
    finalEl.textContent = final;
    bestEl.textContent = best;
    if (G.player) burst(G.player.x, G.player.y - 24, '#ef4444', 24);
    showScreen(overEl);
  }

  // ---------- Character picker ----------
  function buildCharPicker() {
    const container = document.getElementById('characters');
    if (!container) return;
    container.innerHTML = '';

    // Сгенерированные с фото — вперёд
    const generated = CHARACTERS.filter(c => c.generated);
    const base = CHARACTERS.filter(c => !c.generated);
    const merged = [...generated, ...base];

    merged.forEach(c => {
      const el = document.createElement('div');
      el.className = 'char' + (c.id === selectedChar.id ? ' active' : '');
      el.setAttribute('aria-label', c.name);
      el.title = c.name;

      if (c.photo) {
        const img = document.createElement('img');
        img.src = c.photo;
        img.alt = c.name;
        el.appendChild(img);
      } else {
        el.textContent = c.emoji;
      }

      el.onclick = () => {
        selectedChar = c;
        buildCharPicker();
      };

      // Долгое нажатие — удалить сгенерированного
      if (c.generated) {
        let tId = null;
        const start = () => {
          tId = setTimeout(() => {
            if (confirm(`Удалить «${c.name}»?`)) {
              const list = (window.Scanner?.getGenerated() || [])
                .filter(x => x.id !== c.id);
              localStorage.setItem(LS_GENERATED, JSON.stringify(list));
              window.Shtuka.removeCharacter(c.id);
            }
          }, 700);
        };
        const cancel = () => clearTimeout(tId);
        el.addEventListener('touchstart', start, { passive: true });
        el.addEventListener('touchend', cancel);
        el.addEventListener('touchmove', cancel);
        el.addEventListener('mousedown', start);
        el.addEventListener('mouseup', cancel);
        el.addEventListener('mouseleave', cancel);
      }

      container.appendChild(el);
    });
  }

  // ---------- Buttons ----------
  document.getElementById('playBtn').onclick  = startGame;
  document.getElementById('retryBtn').onclick = startGame;
  document.getElementById('menuBtn').onclick  = () => {
    state = 'menu';
    resetGame();
    showScreen(menuEl);
  };

  document.getElementById('shareBtn').onclick = async () => {
    const name = selectedChar.name.toLowerCase();
    const score = Math.floor(G.score);
    const text = `Моя «${name}» пробежала ${score} очков в «Штуке»! 🏃 Попробуй побить → https://flash40rus.github.io/Shtuka/`;
    try {
      if (navigator.share) await navigator.share({ title: 'Штука', text });
      else { await navigator.clipboard.writeText(text); alert('Скопировано!'); }
    } catch (e) { /* отменили */ }
  };

  // ---------- Boot ----------
  (function hydrateGenerated() {
    try {
      const list = JSON.parse(localStorage.getItem(LS_GENERATED) || '[]');
      list.forEach(c => {
        if (!CHARACTERS.find(x => x.id === c.id)) CHARACTERS.push(c);
      });
      if (list.length) selectedChar = list[0];
    } catch (e) { console.warn('hydrate failed', e); }
  })();

  buildCharPicker();
  resetGame();
  showScreen(menuEl);
  requestAnimationFrame(loop);
})();