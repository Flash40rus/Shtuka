// scanner.js — AI-камера для «Штуки»
// Стоп-кадр → MobileNet → label → шаблон персонажа → сохранение.

(() => {
  'use strict';

  const S = window.Shtuka;
  if (!S) { console.warn('[scanner] Shtuka API не найден'); return; }

  const scannerEl = document.getElementById('scanner');
  const videoEl   = document.getElementById('cam');
  const infoEl    = document.getElementById('scannerInfo');
  const snapBtn   = document.getElementById('snapBtn');
  const cancelBtn = document.getElementById('cancelScan');
  const scanBtn   = document.getElementById('scanBtn');

  let stream = null;
  let model = null;
  let busy = false;

  // ---------- Правила маппинга label → персонаж ----------
  const RULES = [
    { match: ['coffee mug', 'mug', 'cup', 'teacup'],     emoji: '☕', kind: 'cup',    jump: 1.00, doubleJump: false },
    { match: ['banana'],                                  emoji: '🍌', kind: 'banana', jump: 1.10, doubleJump: false },
    { match: ['cat', 'tabby', 'kitten', 'siamese'],       emoji: '🐱', kind: 'cat',    jump: 1.20, doubleJump: false },
    { match: ['sock', 'stocking'],                        emoji: '🧦', kind: 'sock',   jump: 1.00, doubleJump: true  },
    { match: ['keyboard', 'laptop', 'computer', 'notebook computer'], emoji: '⌨️', kind: 'kbd', jump: 0.90, doubleJump: false },
    { match: ['book', 'binder', 'comic book'],            emoji: '📚', kind: 'book',   jump: 1.00, doubleJump: false },
    { match: ['apple', 'orange', 'strawberry', 'pineapple', 'fruit'], emoji: '🍎', kind: 'fruit', jump: 1.05, doubleJump: false },
    { match: ['bottle', 'water bottle', 'beer bottle', 'wine bottle'], emoji: '🍾', kind: 'bottle', jump: 1.05, doubleJump: false },
    { match: ['shoe', 'sneaker', 'boot', 'running shoe', 'sandal'], emoji: '👟', kind: 'shoe', jump: 1.15, doubleJump: false },
    { match: ['dog', 'puppy', 'retriever', 'terrier', 'husky'],     emoji: '🐶', kind: 'dog',  jump: 1.05, doubleJump: true  },
    { match: ['phone', 'cellular', 'cell phone', 'iphone', 'smartphone'], emoji: '📱', kind: 'phone', jump: 1.00, doubleJump: true },
    { match: ['pizza', 'burger', 'sandwich', 'hot dog', 'pretzel'],  emoji: '🍕', kind: 'food', jump: 1.05, doubleJump: false },
    { match: ['backpack', 'bag', 'rucksack'],             emoji: '🎒', kind: 'bag',    jump: 0.95, doubleJump: false },
    { match: ['ball', 'soccer ball', 'basketball'],       emoji: '⚽', kind: 'ball',   jump: 1.25, doubleJump: false },
    { match: ['balloon'],                                 emoji: '🎈', kind: 'balloon', jump: 1.35, doubleJump: true },
    { match: ['lamp', 'light bulb'],                      emoji: '💡', kind: 'lamp',   jump: 1.00, doubleJump: false },
    { match: ['clock', 'watch', 'alarm clock'],           emoji: '⏰', kind: 'clock',  jump: 1.00, doubleJump: false },
    { match: ['plant', 'flower', 'pot'],                  emoji: '🌱', kind: 'plant',  jump: 1.00, doubleJump: false },
    { match: ['pencil', 'pen', 'marker'],                 emoji: '✏️', kind: 'pen',    jump: 1.00, doubleJump: false },
    { match: ['hat', 'cap', 'helmet'],                    emoji: '🎩', kind: 'hat',    jump: 1.00, doubleJump: false },
  ];

  const FALLBACKS = ['🎲', '🧸', '🪑', '🧃', '🍩', '🪥', '🧢', '🥁', '🪀'];
  const SURPRISE_NAMES = ['Штуковина', 'Непонятно что', 'Сюрприз', 'Загадка', 'Артефакт', 'Хрень'];

  function prettifyLabel(label) {
    if (!label) return 'Штука';
    return label.split(',')[0].trim().replace(/\b\w/g, c => c.toUpperCase());
  }

  function classifyLabelToTemplate(label) {
    const l = (label || '').toLowerCase();
    for (const rule of RULES) {
      for (const key of rule.match) {
        if (l.includes(key)) {
          return {
            emoji: rule.emoji,
            name: prettifyLabel(label),
            kind: rule.kind,
            jump: rule.jump,
            doubleJump: rule.doubleJump,
            sourceLabel: label,
            confidence: 1.0,
          };
        }
      }
    }
    const emoji = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
    const name = SURPRISE_NAMES[Math.floor(Math.random() * SURPRISE_NAMES.length)];
    return {
      emoji,
      name: `${name} (${prettifyLabel(label)})`,
      kind: 'mystery',
      jump: 0.95 + Math.random() * 0.3,
      doubleJump: Math.random() < 0.25,
      sourceLabel: label,
      confidence: 0.0,
    };
  }

  // ---------- Модель ----------
  async function loadModel() {
    if (model) return model;
    if (typeof mobilenet === 'undefined') {
      throw new Error('MobileNet не загружен (проверь интернет)');
    }
    infoEl.textContent = 'Загружаю AI (первый раз ~5 сек)…';
    model = await mobilenet.load({ version: 2, alpha: 1.0 });
    return model;
  }

  // ---------- Камера ----------
  async function openScanner() {
    scannerEl.classList.remove('hidden');
    infoEl.textContent = 'Наведи на предмет';
    snapBtn.disabled = true;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
      snapBtn.disabled = false;
    } catch (e) {
      console.error('[scanner] camera error', e);
      infoEl.textContent = 'Не могу открыть камеру. Разреши доступ в настройках браузера.';
    }

    loadModel().catch(err => console.error('[scanner] model load', err));
  }

  function closeScanner() {
    scannerEl.classList.add('hidden');
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    videoEl.srcObject = null;
    busy = false;
    snapBtn.disabled = false;
  }

  // ---------- Снимок + классификация ----------
  async function snapAndClassify() {
    if (busy) return;
    busy = true;
    snapBtn.disabled = true;
    infoEl.textContent = 'Анализирую…';

    try {
      const net = await loadModel();

      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      if (!vw || !vh) throw new Error('Нет видеопотока');

      const size = Math.min(vw, vh);
      const sx = (vw - size) / 2;
      const sy = (vh - size) / 2;

      const c = document.createElement('canvas');
      c.width = 224;
      c.height = 224;
      c.getContext('2d').drawImage(videoEl, sx, sy, size, size, 0, 0, 224, 224);

      const preds = await net.classify(c, 5);
      if (!preds || !preds.length) {
        infoEl.textContent = 'Не разобрал. Попробуй ещё раз.';
        busy = false;
        snapBtn.disabled = false;
        return;
      }

      const top = preds[0];
      const tpl = classifyLabelToTemplate(top.className);
      tpl.confidence = top.probability;
      tpl.photo = c.toDataURL('image/jpeg', 0.75);

      const name = prettifyLabel(top.className);
      infoEl.textContent = `Это ${name} (${Math.round(top.probability * 100)}%)!`;

      setTimeout(() => {
        const saved = saveGeneratedCharacter(tpl);
        S.addCharacter(saved);
        S.selectCharacter(saved.id);
        closeScanner();
      }, 700);

    } catch (e) {
      console.error('[scanner] classify error', e);
      infoEl.textContent = e.message || 'Ошибка анализа. Попробуй снова.';
      busy = false;
      snapBtn.disabled = false;
    }
  }

  // ---------- Хранилище ----------
  function loadGenerated() {
    try { return JSON.parse(localStorage.getItem(S.LS_GENERATED) || '[]'); }
    catch { return []; }
  }

  function saveGeneratedCharacter(tpl) {
    const id = 'gen_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const char = {
      id,
      emoji: tpl.emoji,
      name: tpl.name,
      jump: tpl.jump,
      doubleJump: tpl.doubleJump,
      generated: true,
      kind: tpl.kind,
      label: tpl.sourceLabel,
      confidence: tpl.confidence,
      photo: tpl.photo,
      createdAt: Date.now(),
    };

    const list = loadGenerated();
    list.unshift(char);
    const trimmed = list.slice(0, 20);

    try {
      localStorage.setItem(S.LS_GENERATED, JSON.stringify(trimmed));
    } catch (e) {
      // Переполнено — режем до 5
      localStorage.setItem(S.LS_GENERATED, JSON.stringify(trimmed.slice(0, 5)));
    }
    return char;
  }

  // ---------- Events ----------
  if (scanBtn)   scanBtn.addEventListener('click', openScanner);
  if (cancelBtn) cancelBtn.addEventListener('click', closeScanner);
  if (snapBtn)   snapBtn.addEventListener('click', snapAndClassify);

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !scannerEl.classList.contains('hidden')) closeScanner();
  });

  // ---------- Public API ----------
  window.Scanner = { getGenerated: loadGenerated };
})();