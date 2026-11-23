const $ = id => document.getElementById(id);
const monthKey = () => 'spent:' + new Date().toISOString().slice(0, 7);

const HINTS = {
  hibrit: 'Sayfa çevirisi ücretsiz. Sadece seçip Alt+T ile çevirdiğin metinler Claude kullanır (seçim başına ~0,02 cent; $1 ≈ 5000 seçim).',
  google: 'Hiç para harcamaz. Teknik terimler sözlükle korunur, ama çeviri bazen yapay olabilir.',
  claude: '<span class="warn">Sayfa da Claude ile çevrilir.</span> Yalnızca ekranda gördüğün kısım çevrilir ve önbelleğe alınır; uzun bir oda yaklaşık 1 cent tutar.'
};

function flash(text) {
  $('msg').textContent = text;
  setTimeout(() => { $('msg').textContent = ''; }, 2500);
}

async function load() {
  const s = await chrome.storage.local.get(['engine', 'apiKey', 'budgetUsd', 'defter', monthKey()]);
  $('engine').value = s.engine || 'hibrit';
  $('engineHint').innerHTML = HINTS[$('engine').value];
  $('key').value = s.apiKey || '';
  const budget = typeof s.budgetUsd === 'number' ? s.budgetUsd : 1;
  $('budget').value = budget;
  const spent = s[monthKey()] || 0;
  $('spent').textContent = `$${spent.toFixed(4)} / $${budget.toFixed(2)}`;
  $('barFill').style.width = budget > 0 ? Math.min(100, (spent / budget) * 100) + '%' : '100%';
  renderDefter(s.defter || []);
}

function renderDefter(list) {
  $('count').textContent = list.length ? `(${list.length})` : '';
  const box = $('defter');
  box.textContent = '';
  if (!list.length) {
    box.innerHTML = '<div class="hint">Alt+T ile çevirdiğin bir şeyi "★ Deftere ekle" ile kaydet.</div>';
    return;
  }
  list.forEach((w, i) => {
    const row = document.createElement('div');
    row.className = 'w';
    const d = document.createElement('div');
    const tr = document.createElement('div');
    tr.textContent = w.tr;
    const en = document.createElement('div');
    en.className = 'en';
    en.textContent = w.en;
    en.title = w.en;
    d.append(tr, en);
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Sil';
    del.onclick = async () => {
      const { defter = [] } = await chrome.storage.local.get('defter');
      defter.splice(i, 1);
      await chrome.storage.local.set({ defter });
      renderDefter(defter);
    };
    row.append(d, del);
    box.appendChild(row);
  });
}

$('engine').onchange = async () => {
  await chrome.storage.local.set({ engine: $('engine').value });
  $('engineHint').innerHTML = HINTS[$('engine').value];
  flash('Kaydedildi');
};

$('saveKey').onclick = async () => {
  const k = $('key').value.trim();
  if (k && !k.startsWith('sk-ant-')) { flash('Anahtar sk-ant- ile başlamalı'); return; }
  await chrome.storage.local.set({ apiKey: k });
  flash(k ? 'Anahtar kaydedildi' : 'Anahtar silindi');
};

$('saveBudget').onclick = async () => {
  const v = Math.max(0, parseFloat($('budget').value) || 0);
  await chrome.storage.local.set({ budgetUsd: v });
  flash('Bütçe kaydedildi');
  load();
};

$('toggle').onclick = () => {
  chrome.runtime.sendMessage({ type: 'cmd-active', cmd: 'toggle-page' }, res => {
    if (chrome.runtime.lastError || res?.error) flash('Bu sayfada çalışamıyor');
    else window.close();
  });
};

$('clearCache').onclick = () => {
  chrome.runtime.sendMessage({ type: 'clearCache' }, res => flash(`${res?.removed ?? 0} çeviri silindi`));
};

$('copy').onclick = async () => {
  const { defter = [] } = await chrome.storage.local.get('defter');
  await navigator.clipboard.writeText(defter.map(w => `${w.en}\t${w.tr}`).join('\n'));
  flash('Defter panoya kopyalandı');
};

$('shortcuts').onclick = () => {
  const edge = navigator.userAgent.includes('Edg/');
  chrome.tabs.create({ url: edge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' });
};

load();
