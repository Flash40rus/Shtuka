// scanner.js — AI-камера «Штуки» v3 (с фоллбэком и диагностикой)
// Если MobileNet не загружается — выдаём случайного персонажа с фото.

(() => {
  'use strict';

  const S = window.Shtuka;
  if (!S) { console.error('[scanner] Shtuka API не найден'); return; }

  const scannerEl = document.getElementById('scanner');
  const videoEl   = document.getElementById('cam');
  const infoEl    = document.getElementById('scannerInfo');
  const snapBtn   = document.getElementById('snapBtn');
  const cancelBtn = document.getElementById('cancelScan');
  const scanBtn   = document.getElementById('scanBtn');

  if (!scannerEl || !videoEl || !snapBtn) {
    console.error('[scanner] DOM-элементы не найдены');
    return;
  }

  let stream = null;
  let model = null;
  let modelPromise = null;
  let busy = false;

  function log(msg) {
    console.log('[scanner]', msg);
    if (infoEl) infoEl.textContent = msg;
  }

  // ---------- Правила ----------
  const RULES = [
    { match: ['coffee mug', 'mug', 'cup', 'teacup'],     emoji: '☕', kind: 'cup',    jump: 1.00, doubleJump: false },
    { match: ['banana'],                                  emoji: '🍌', kind: 'banana', jump: 1.10, doubleJump: false },
    { match: ['cat', 'tabby', 'kitten', 'siamese'],       emoji: '🐱', kind: 'cat',    jump: 1.20, doubleJump: false },
    { match: ['sock', 'stocking'],                        emoji: '🧦', kind: 'sock',   jump: 1.00, doubleJump: true  },
    { match: ['keyboard', 'laptop', 'computer'],          emoji: '⌨️', kind: 'kbd',    jump: 0.90, doubleJump: false },
    { match: ['book', 'binder', 'comic book'],            emoji: '📚', kind: 'book',   jump: 1.00, doubleJump: false },
    { match: ['apple', 'orange', 'strawberry', 'pineapple', 'fruit'], emoji: '🍎', kind: 'fruit', jump: 1.05, doubleJump: false },
    { match: ['bottle', 'water bottle', 'beer bottle', 'wine bottle'], emoji: '🍾', kind: 'bottle', jump: 1.05, doubleJump: false },
    { match: ['shoe', 'sneaker', 'boot', 'running shoe'], emoji: '👟', kind: 'shoe',   jump: 1.15, doubleJump: false },
    { match: ['dog', 'puppy', 'retriever', 'terrier'],    emoji: '🐶', kind: 'dog',    jump: 1.05, doubleJump: true  },
    { match: ['phone', 'cellular', 'cell phone', 'smartphone'], emoji: '📱', kind: 'phone', jump: 1.00, doubleJump: true },
    { match: ['pizza', 'burger', 'sandwich', 'hot dog'],  emoji: '🍕', kind: 'food',   jump: 1.05, doubleJump: false },
    { match: ['ball', 'soccer ball', 'basketball'],       emoji: '⚽', kind: 'ball',   jump: 1.25, doubleJump: false },
    { match: ['balloon'],                                 emoji: '🎈', kind: 'balloon', jump: 1.35, doubleJump: true },
    { match: ['pencil', 'pen', 'marker'],                 emoji: '✏️', kind: 'pen',    jump: 1.00, doubleJump: false },
    { match: ['hat', 'cap', 'helmet'],                    emoji: '🎩', kind: 'hat',    jump: 1.00, doubleJump: false },
  ];

  const FALLBACKS = ['🎲', '🧸', '🪑', '🧃', '🍩', '🪥', '🧢', '🥁', '🪀', '🎁'];
  const SURPRISE_NAMES = ['Штуковина', 'Непонятно что', 'Сюрприз', 'Загадка', 'Артефакт'];

  function prettifyLabel(label) {
    if (!label) return 'Штука';
    return String(label).split(',')[0].trim().replace(/\b\w/g, c => c.toUpperCase());
  }

  function classifyLabelToTemplate(label) {
    const l = String(label || '').toLowerCase();
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
      name: `${name}`,
      kind: 'mystery',
      jump: 0.95 + Math.random() * 0.3,
      doubleJump: Math.random() < 0.25,
      sourceLabel: label,
      confidence: 0.0,
    };
  }

  // ---------- Загрузка модели (с таймаутом и кэшем промиса) ----------
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`Таймаут: ${label}`)), ms)),
    ]);
  }

  function ensureModel() {
    if (model) return Promise.resolve(model);
    if (modelPromise) return modelPromise;

    modelPromise = (async () => {
      if (typeof tf === 'undefined') {
        throw new Error('TensorFlow.js не загрузился (нет интернета или блокировка CDN)');
      }
      if (typeof mobilenet === 'undefined') {
        throw new Error('MobileNet не загрузился (нет интернета или блокировка CDN)');
      }
      log('Загружаю AI (~17 МБ, только первый раз)…');
      const m = await withTimeout(
        mobilenet.load({ version: 2, alpha: 1.0 }),
        60000,
        'загрузка MobileNet'
      );
      model = m;
      log('AI готов ✓');
      return m;
    })();

    // Если упало — сбросим промис, чтобы можно было попробовать снова
    modelPromise.catch(() => { modelPromise = null; });

    return modelPromise;
  }

  // ---------- Камера ----------
  async function openScanner() {
    scannerEl.classList.remove('hidden');
    log('Наведи на предмет');
    snapBtn.disabled = true;
    snapBtn.textContent = 'Снять';

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
      snapBtn.disabled = false;
      log('Наведи на предмет');
    } catch (e) {
      console.error('[scanner] camera error', e);
      log('Нет доступа к камере: ' + (e.message || e.name));
      return;
    }

    // Прогреваем модель в фоне (не блокирует UI)
    ensureModel().catch(err => {
      console.warn('[scanner] предзагрузка AI не удалась:', err.message);
    });
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
    snapBtn.textContent = 'Снять';
  }

  // ---------- Fallback: если AI не смог — рандомный персонаж с фото ----------
  function fallbackCharacter(photoDataUrl) {
    const emoji = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
    const name = SURPRISE_NAMES[Math.floor(Math.random() * SURPRISE_NAMES.length)];
    return {
      emoji,
      name,
      kind: 'mystery',
      jump: 0.95 + Math.random() * 0.3,
      doubleJump: Math.random() < 0.25,
      sourceLabel: '(без AI)',
      confidence: 0.0,
      photo: photoDataUrl,
    };
  }

  // ---------- Снимок + классификация ----------
  async function snapAndClassify() {
    if (busy) return;
    busy = true;
    snapBtn.disabled = true;
    snapBtn.textContent = '…';

    // Вибро-фидбек
    try { navigator.vibrate && navigator.vibrate(25); } catch {}

    let photoDataUrl = null;

    try {
      // 1. Сразу делаем снимок — на случай если AI упадёт
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      if (!vw || !vh) throw new Error('Видео ещё не готово');

      const size = Math.min(vw, vh);
      const sx = (vw - size) / 2;
      const sy = (vh - size) / 2;

      const c = document.createElement('canvas');
      c.width = 224;
      c.height = 224;
      c.getContext('2d').drawImage(videoEl, sx, sy, size, size, 0, 0, 224, 224);
      photoDataUrl = c.toDataURL('image/jpeg', 0.75);

      log('Фото сделано. Анализирую…');

      // 2. Пробуем AI
      let tpl;
      try {
        const net = await ensureModel();
        const preds = await withTimeout(net.classify(c, 5), 15000, 'классификация');
        if (preds && preds.length) {
          tpl = classifyLabelToTemplate(preds[0].className);
          tpl.confidence = preds[0].probability;
          log(`Это ${prettifyLabel(preds[0].className)} (${Math.round(preds[0].probability * 100)}%)!`);
        } else {
          tpl = fallbackCharacter(photoDataUrl);
          log('Не разобрал — делаю случайного');
        }
      } catch (aiErr) {
        console.warn('[scanner] AI недоступен:', aiErr.message);
        tpl = fallbackCharacter(photoDataUrl);
        log('AI недоступен → случайный персонаж');
      }

      tpl.photo = photoDataUrl;

      // 3. Сохраняем через 0.6с (чтобы юзер увидел сообщение)
      setTimeout(() => {
        const saved = saveGeneratedCharacter(tpl);
        S.addCharacter(saved);
        S.selectCharacter(saved.id);
        closeScanner();
        // Короткий фидбек в меню
        try { navigator.vibrate && navigator.vibrate([20, 40, 20]); } catch {}
      }, 600);

    } catch (e) {
      console.error('[scanner] snap error', e);
      log('Ошибка: ' + (e.message || 'неизвестная'));
      busy = false;
      snapBtn.disabled = false;
      snapBtn.textContent = 'Снять';
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
      console.warn('[scanner] localStorage переполнен, чищу');
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

  window.Scanner = { getGenerated: loadGenerated };
})();