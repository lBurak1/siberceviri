(() => {
  if (window.__siberCeviri) return;
  window.__siberCeviri = true;

  // Çevrilecek metin blokları
  const CAND = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd, figcaption, summary';
  // Bunların içindeki hiçbir şeye dokunulmaz
  const SKIP = 'pre, code, kbd, samp, script, style, textarea, input, select, button, nav, footer, svg, ' +
    '.sc-ui, .sc-tr, [contenteditable="true"], .monaco-editor, .ace_editor, .xterm, .CodeMirror, .cm-editor';
  // Satır içi kod: yer tutucuyla korunur, olduğu gibi geri konur
  const INLINE_CODE = new Set(['CODE', 'KBD', 'SAMP', 'TT', 'VAR']);
  const NO_WALK = 'pre, script, style, svg, button, input, textarea, select, .sc-tr, .sc-ui';
  const PH_RE = /_{1,2}\s*C\s*(\d+)\s*_{1,2}/gi;
  const BATCH_SEGMENTS = 20;
  const BATCH_CHARS = 5000;

  let active = false;
  let io = null, mo = null, scanTimer = null, flushTimer = null, busy = false;
  let observed = new WeakSet();
  const queue = new Set();

  // -------------------------------------------------------------------------
  // Metin çıkarma ve geri yazma
  // -------------------------------------------------------------------------
  function extract(el) {
    const codes = [];
    let out = '';
    const walk = node => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) { out += ch.nodeValue; continue; }
        if (ch.nodeType !== 1) continue;
        if (INLINE_CODE.has(ch.tagName)) { out += `__C${codes.length}__`; codes.push(ch.textContent); continue; }
        if (ch.tagName === 'BR') { out += '\n'; continue; }
        if (ch.matches(CAND) || ch.matches(NO_WALK)) continue; // iç içe bloklar kendi başına çevrilir
        walk(ch);
      }
    };
    walk(el);
    const text = out.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { text, codes };
  }

  function worthTranslating(text) {
    const plain = text.replace(PH_RE, ' ');
    return /[A-Za-z]{3,}/.test(plain) && plain.replace(/[^A-Za-z]/g, '').length >= 3;
  }

  function buildTranslated(translated, codes, tag) {
    const box = document.createElement(tag);
    box.className = 'sc-tr';
    let last = 0;
    const pushText = s => {
      s.split('\n').forEach((line, i) => {
        if (i) box.appendChild(document.createElement('br'));
        if (line) box.appendChild(document.createTextNode(line));
      });
    };
    translated.replace(PH_RE, (m, d, offset) => {
      pushText(translated.slice(last, offset));
      const c = document.createElement('code');
      c.textContent = codes[+d] ?? m;
      box.appendChild(c);
      last = offset + m.length;
      return m;
    });
    pushText(translated.slice(last));
    return box;
  }

  function render(el, translated, codes) {
    el.querySelectorAll(':scope > .sc-tr').forEach(n => n.remove());
    el.appendChild(buildTranslated(translated, codes, 'span'));
    el.dataset.scDone = '1';
  }

  // -------------------------------------------------------------------------
  // Sayfa çevirisi (yalnızca ekrana gelen bloklar — Claude'da para tasarrufu)
  // -------------------------------------------------------------------------
  function eligible(el) {
    if (el.dataset.scDone) return false;
    if (el.closest(SKIP)) return false;
    return true;
  }

  function scan() {
    if (!active) return;
    document.querySelectorAll(CAND).forEach(el => {
      if (observed.has(el) || !eligible(el)) return;
      observed.add(el);
      io.observe(el);
    });
  }

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 350);
  }

  async function flush() {
    if (busy || !active) return;
    busy = true;
    try {
      while (queue.size && active) {
        const batch = [];
        let chars = 0;
        for (const el of queue) {
          queue.delete(el);
          if (!el.isConnected || el.dataset.scDone) continue;
          const { text, codes } = extract(el);
          if (!worthTranslating(text)) { el.dataset.scDone = 'skip'; continue; }
          batch.push({ el, text, codes });
          el.dataset.scDone = 'pending';
          chars += text.length;
          if (batch.length >= BATCH_SEGMENTS || chars >= BATCH_CHARS) break;
        }
        if (!batch.length) continue;

        setFab('busy');
        const res = await send({ type: 'translate', mode: 'page', segments: batch.map(b => b.text) });
        if (res.error) {
          batch.forEach(b => { delete b.el.dataset.scDone; observed.delete(b.el); });
          toast(res.error);
          break;
        }
        if (res.notice) toast(res.notice);
        batch.forEach((b, i) => {
          if (!active) { delete b.el.dataset.scDone; return; }
          const tr = res.translations[i];
          if (tr) render(b.el, tr, b.codes); else delete b.el.dataset.scDone;
        });
      }
    } finally {
      busy = false;
      setFab(active ? 'on' : 'off');
      if (queue.size && active) scheduleFlush();
    }
  }

  function enable() {
    if (active) return;
    active = true;
    io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) { queue.add(e.target); io.unobserve(e.target); }
      }
      if (queue.size) scheduleFlush();
    }, { rootMargin: '400px 0px' });
    mo = new MutationObserver(muts => {
      const ours = muts.every(m => [...m.addedNodes].every(n => n.nodeType === 1 && n.classList?.contains('sc-tr')));
      if (ours) return;
      clearTimeout(scanTimer);
      scanTimer = setTimeout(scan, 600);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    scan();
    setFab('on');
    saveSiteState(true);
  }

  function disable() {
    active = false;
    io?.disconnect(); mo?.disconnect();
    io = mo = null;
    queue.clear();
    document.querySelectorAll('.sc-tr').forEach(n => n.remove());
    document.querySelectorAll('[data-sc-done]').forEach(n => delete n.dataset.scDone);
    observed = new WeakSet(); // yeniden açılınca her şey tekrar taransın
    setFab('off');
    saveSiteState(false);
  }

  const toggle = () => (active ? disable() : enable());

  function saveSiteState(on) {
    try {
      chrome.storage.local.get('autoSites').then(({ autoSites = {} }) => {
        if (on) autoSites[location.hostname] = true; else delete autoSites[location.hostname];
        chrome.storage.local.set({ autoSites });
      });
    } catch {}
  }

  // -------------------------------------------------------------------------
  // Seçili metni çevirme (Alt+T / sağ tık)
  // -------------------------------------------------------------------------
  let popBox = null;
  function closeBox() { popBox?.remove(); popBox = null; }

  async function translateSelection() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text) { toast('Önce çevirmek istediğin metni seç.'); return; }
    const rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : { left: 20, bottom: 80 };

    closeBox();
    popBox = document.createElement('div');
    popBox.className = 'sc-ui sc-box';
    const top = Math.max(8, rect.bottom + window.scrollY + 8);
    const left = Math.min(Math.max(8, rect.left + window.scrollX), window.scrollX + document.documentElement.clientWidth - 440);
    popBox.style.top = top + 'px';
    popBox.style.left = Math.max(8, left) + 'px';

    const head = document.createElement('div');
    head.className = 'sc-box-head';
    const title = document.createElement('span');
    title.textContent = 'SiberÇeviri';
    const close = document.createElement('button');
    close.className = 'sc-x';
    close.textContent = '✕';
    close.onclick = closeBox;
    head.append(title, close);

    const body = document.createElement('div');
    body.className = 'sc-box-body';
    body.textContent = 'Çevriliyor…';
    popBox.append(head, body);
    document.body.appendChild(popBox);

    const res = await send({ type: 'translate', mode: 'selection', segments: [text] });
    if (!popBox) return;
    if (res.error) { body.textContent = res.error; return; }
    const tr = res.translations[0] || '';
    body.textContent = '';
    tr.split('\n').forEach((line, i) => { if (i) body.appendChild(document.createElement('br')); body.appendChild(document.createTextNode(line)); });

    const foot = document.createElement('div');
    foot.className = 'sc-box-foot';
    const eng = document.createElement('span');
    eng.className = 'sc-eng';
    eng.textContent = res.cached ? 'önbellekten' : (res.engine === 'claude' ? 'Claude Haiku' : 'Google (ücretsiz)');
    const save = document.createElement('button');
    save.className = 'sc-btn';
    save.textContent = '★ Deftere ekle';
    save.onclick = async () => {
      await send({ type: 'saveWord', en: text, tr });
      save.textContent = '✓ Eklendi';
      save.disabled = true;
    };
    foot.append(eng, save);
    popBox.appendChild(foot);
    if (res.notice) toast(res.notice);
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBox(); });
  document.addEventListener('mousedown', e => { if (popBox && !popBox.contains(e.target)) closeBox(); });

  // -------------------------------------------------------------------------
  // Arayüz: yüzen TR düğmesi + bildirim
  // -------------------------------------------------------------------------
  const fab = document.createElement('button');
  fab.className = 'sc-ui sc-fab';
  fab.title = 'SiberÇeviri — sayfa çevirisini aç/kapat (Alt+Y)\nSeçili metin için: Alt+T';
  fab.textContent = 'TR';
  fab.onclick = toggle;
  document.body.appendChild(fab);

  function setFab(state) {
    fab.dataset.state = state;
  }
  setFab('off');

  let toastTimer = null;
  function toast(msg) {
    let t = document.querySelector('.sc-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'sc-ui sc-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
  }

  // -------------------------------------------------------------------------
  // İletişim
  // -------------------------------------------------------------------------
  function send(msg) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(msg, res => {
          if (chrome.runtime.lastError) resolve({ error: 'Eklenti yeniden yüklendi, sayfayı yenile (F5).' });
          else resolve(res || { error: 'Yanıt alınamadı.' });
        });
      } catch {
        resolve({ error: 'Eklenti yeniden yüklendi, sayfayı yenile (F5).' });
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'cmd') {
      if (msg.cmd === 'toggle-page') toggle();
      if (msg.cmd === 'translate-selection') translateSelection();
      sendResponse({ ok: true, active });
    }
  });

  // Bu sitede daha önce açık bırakıldıysa otomatik başlat
  chrome.storage.local.get('autoSites').then(({ autoSites = {} }) => {
    if (autoSites[location.hostname]) enable();
  }).catch(() => {});
})();
