// SiberÇeviri — video altyazısı (Udemy + arcX + Vimeo/Wistia/Bunny/Mux gömülü oynatıcılar):
// dersin transkriptini kendisi alır, Türkçeye çevirir ve videoyla senkron gösterir.
// Udemy'de CC açmaya gerek yok; diğer sitelerde transkript bulunamazsa CC → English açılınca canlı çevirir. Mod: kapalı → TR + EN → sadece TR → kapalı (Alt+U veya oynatıcıdaki "TR" düğmesi)
// "Döküm" düğmesi: dersin tam Türkçe transkripti (tıkla → o saniyeye git, kopyala → deftere).
(() => {
  if (window.__siberUdemy) return;
  window.__siberUdemy = true;

  const UDEMY = /(^|\.)udemy\.com$/.test(location.hostname);
  // Ekranda görünen İngilizce altyazı (Udemy + yaygın oynatıcılar: Vimeo, Video.js, Plyr, JW, Shaka, Wistia)
  const UDEMY_CUE = '[data-purpose="captions-cue-text"], [class*="captions-display--captions-cue-text"], ' +
    '.vp-captions, .vjs-text-track-cue, .plyr__caption, .jw-text-track-cue, .shaka-text-container span, .w-captions-line, [class*="caption-text"], [class*="captions-text"]' +
    (/vdocipher\.com$/.test(location.hostname) ? ', [class*="caption"] span, [class*="subtitle"] span, [class*="Caption"] span' : '');
  const MODES = ['off', 'both', 'tr'];
  const LABEL = { off: 'TR altyazı: kapalı', both: 'TR altyazı: Türkçe + İngilizce', tr: 'TR altyazı: sadece Türkçe' };
  const norm = s => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  let mode = 'off';
  let ders = null;           // { id, cues: [{bas, son, en, tr}], durum: 'yukleniyor'|'hazir'|'yok' }
  let sonDers = '';
  let yukleNo = 0;           // her yeni yükleme bir öncekini iptal eder
  let sonHata = '';
  const sozluk = new Map();  // en → tr (bütün yüklemeler ortak kullanır)
  const trOf = c => c.tr || sozluk.get(c.en) || '';

  // ---------------------------------------------------------------------------
  function send(msg) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(msg, res => {
          if (chrome.runtime.lastError) resolve({ error: 'Eklenti yeniden yüklendi, sayfayı yenile (F5).' });
          else resolve(res || { error: 'Yanıt alınamadı.' });
        });
      } catch { resolve({ error: 'Eklenti yeniden yüklendi, sayfayı yenile (F5).' }); }
    });
  }
  async function cevir(metinler) {
    const res = await send({ type: 'translate', mode: 'caption', segments: metinler });
    if (res.error || !Array.isArray(res.translations)) { sonHata = res.error || 'Çeviri yanıtı boş geldi.'; bildir(sonHata); ciz(); return null; }
    sonHata = '';
    return res.translations;
  }

  // ---------------------------------------------------------------------------
  // Transkripti bulma: 1) Udemy API (ders altyazı listesi)  2) sayfanın indirdiği .vtt
  // ---------------------------------------------------------------------------
  const dersId = () => UDEMY ? (location.pathname.match(/\/lecture\/(\d+)/) || [])[1] : location.pathname;
  const kursSlug = () => (location.pathname.match(/\/course\/([^/]+)/) || [])[1];

  async function kursId() {
    for (const el of document.querySelectorAll('[data-module-args]')) {
      try { const a = JSON.parse(el.getAttribute('data-module-args')); if (a.courseId) return a.courseId; } catch {}
    }
    const slug = kursSlug(); if (!slug) return null;
    try {
      const r = await fetch(`/api-2.0/courses/${encodeURIComponent(slug)}/?fields[course]=id`, { credentials: 'include' });
      if (r.ok) return (await r.json()).id;
    } catch {}
    return null;
  }

  async function apiVtt() {
    if (!UDEMY) return vimeoVtt();
    const lid = dersId(), cid = await kursId();
    if (!lid || !cid) return null;
    try {
      const r = await fetch(`/api-2.0/users/me/subscribed-courses/${cid}/lectures/${lid}/?fields[lecture]=asset&fields[asset]=captions`, { credentials: 'include' });
      if (!r.ok) return null;
      const caps = (await r.json())?.asset?.captions || [];
      const en = caps.find(c => /^en/i.test(c.locale_id || c.locale || '') && c.source !== 'auto') || caps.find(c => /^en/i.test(c.locale_id || c.locale || ''));
      return en?.url || null;
    } catch { return null; }
  }

  // Vimeo gömülü oynatıcı: player.vimeo.com/video/<id>/config → İngilizce altyazı dosyası
  async function vimeoVtt() {
    if (location.hostname !== 'player.vimeo.com') return null;
    const id = (location.pathname.match(/\/video\/(\d+)/) || [])[1]; if (!id) return null;
    try {
      const r = await fetch(`/video/${id}/config${location.search}`, { credentials: 'include' });
      if (!r.ok) return null;
      const tt = (await r.json())?.request?.text_tracks || [];
      const en = tt.find(t => /^en/i.test(t.lang) && !/auto/i.test(t.kind || '')) || tt.find(t => /^en/i.test(t.lang)) || tt[0];
      return en?.url ? new URL(en.url, location.origin).href : null;
    } catch { return null; }
  }

  // <track src="..."> etiketleri (HTML5 oynatıcılar)
  function trackVtt() {
    const l = [...document.querySelectorAll('video track[src]')].filter(t => /sub|cap/i.test(t.kind || 'subtitles'));
    const en = l.find(t => /^en/i.test(t.srclang || t.label || '')) || l[0];
    return en ? en.src : null;
  }

  function sayfaVtt() {
    try {
      const l = performance.getEntriesByType('resource').map(e => e.name).filter(n => /\.(vtt|srt)(\?|$)/i.test(n));
      return l.at(-1) || trackVtt();
    } catch { return trackVtt(); }
  }

  // Oynatıcının kendi yüklediği altyazı izleri (HLS içine gömülü altyazılar dahil) → doğrudan cümleler
  function izCues() {
    const v = video(); if (!v?.textTracks) return [];
    const izler = [...v.textTracks].filter(t => /sub|cap/i.test(t.kind));
    const iz = izler.find(t => /^en/i.test(t.language || t.label || '')) || izler[0];
    if (!iz) return [];
    if (iz.mode === 'disabled') iz.mode = 'hidden';   // cümleleri yüklesin ama ekranda göstermesin
    return [...(iz.cues || [])].map(c => ({ bas: c.startTime, son: c.endTime, en: norm(c.text), tr: '' })).filter(c => c.en);
  }

  async function metinAl(url) {
    try { const r = await fetch(url, { credentials: 'omit' }); if (r.ok) return await r.text(); } catch {}
    const res = await send({ type: 'fetchText', url });   // CORS engeli → arka plandan indir
    return res.text || '';
  }

  // HLS (.m3u8) akışlarındaki altyazı listesi: ana liste → SUBTITLES izi → .vtt parçaları → birleştir
  const kaynaklar = () => { try { return performance.getEntriesByType('resource').map(e => e.name); } catch { return []; } };
  async function hlsCues() {
    const listeler = [...new Set(kaynaklar().filter(n => /\.m3u8(\?|$)/i.test(n)))];
    const v = video(); if (v?.currentSrc && /\.m3u8/i.test(v.currentSrc)) listeler.unshift(v.currentSrc);
    for (const ana of listeler) {
      const txt = await metinAl(ana);
      const medya = txt.split('\n').filter(l => /^#EXT-X-MEDIA:.*TYPE=SUBTITLES/i.test(l));
      if (!medya.length) continue;
      const sec = medya.find(l => /LANGUAGE="en/i.test(l)) || medya[0];
      const uri = (sec.match(/URI="([^"]+)"/) || [])[1]; if (!uri) continue;
      const altListeUrl = new URL(uri, ana).href;
      const altListe = await metinAl(altListeUrl);
      const parcalar = altListe.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => new URL(l, altListeUrl).href).slice(0, 600);
      const hepsi = [];
      for (let i = 0; i < parcalar.length; i += 8) {
        const metinler = await Promise.all(parcalar.slice(i, i + 8).map(metinAl));
        metinler.forEach(t => { if (t.includes('-->')) hepsi.push(...vttAyristir(t)); });
      }
      const gor = new Set();
      const cues = hepsi.filter(c => { const k = c.bas + '|' + c.en; if (gor.has(k)) return false; gor.add(k); return true; }).sort((a, b) => a.bas - b.bas);
      if (cues.length) return cues;
    }
    return [];
  }

  // Tanı raporu: transkript bulunamayınca oynatıcının ne kullandığını gösterir (adreslerin ?token kısmı silinir)
  function tani() {
    const kisalt = u => { try { const x = new URL(u, location.href); return x.host + x.pathname.slice(0, 90); } catch { return String(u).slice(0, 90); } };
    const v = video();
    const sat = [
      `SiberÇeviri ${chrome.runtime.getManifest().version} tanı`,
      `çerçeve: ${location.host}${location.pathname.slice(0, 60)} (${window === top ? 'ana sayfa' : 'iframe'})`,
      `video: ${v ? kisalt(v.currentSrc || v.src || '(kaynak yok)') : 'yok'}`,
      `video izleri: ${v ? [...v.textTracks].map(t => `${t.kind}/${t.language || '-'}/${t.label || '-'}/${t.mode}/${t.cues ? t.cues.length : '?'}`).join(', ') || 'yok' : '-'}`,
      `track etiketleri: ${[...document.querySelectorAll('track')].map(t => kisalt(t.src)).join(', ') || 'yok'}`,
      `iframe'ler: ${[...document.querySelectorAll('iframe')].map(f => kisalt(f.src || 'about:blank')).join(', ') || 'yok'}`,
      `oynatıcı sınıfları: ${[...new Set([...(v?.closest('div')?.parentElement?.querySelectorAll('[class]') || [])].flatMap(e => [...e.classList]).filter(c => /cap|sub|track|player|vjs|plyr|jw|shaka|media/i.test(c)))].slice(0, 25).join(' ') || '-'}`,
      'ilgili istekler:',
      ...[...new Set(kaynaklar().filter(n => /vtt|srt|m3u8|mpd|caption|subtitle|transcript|texttrack/i.test(n)).map(kisalt))].slice(-25).map(s => '  ' + s),
    ];
    return sat.join('\n');
  }

  const sn = t => { const p = t.trim().replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  function vttAyristir(txt) {
    const cues = [];
    for (const blok of txt.replace(/\r/g, '').split(/\n{2,}/)) {
      const sat = blok.split('\n');
      const i = sat.findIndex(l => l.includes('-->'));
      if (i < 0) continue;
      const [a, b] = sat[i].split('-->');
      const en = norm(sat.slice(i + 1).join(' '));
      if (en) cues.push({ bas: sn(a), son: sn(b.trim().split(/\s/)[0]), en, tr: '' });
    }
    return cues;
  }

  async function dersYukle() {
    const id = dersId() || location.pathname;
    const no = ++yukleNo;
    const gecerli = () => no === yukleNo;
    const d = { id, cues: [], durum: 'yukleniyor' };
    ders = d;
    let url = await apiVtt(), cues = [];
    if (!url && !UDEMY) { cues = await hlsCues(); if (!gecerli()) return; if (cues.length) url = 'hls'; }
    for (let i = 0; !url && i < 10 && gecerli(); i++) {
      url = sayfaVtt();
      if (!url && !UDEMY) { cues = izCues(); if (cues.length) break; }
      if (!url) await new Promise(r => setTimeout(r, 800));
    }
    if (!gecerli()) return;
    if (url && url !== 'hls') {
      const txt = await metinAl(url);
      if (!gecerli()) return;
      cues = txt.includes('-->') ? vttAyristir(txt) : [];
    }
    if (!cues.length && !UDEMY) { cues = izCues(); if (cues.length) d.kaynak = 'iz'; }
    else if (!url) d.kaynak = 'iz';
    if (!cues.length) { d.durum = 'yok'; dokumCiz(); return; }
    d.cues = cues;
    ciz(); dokumCiz();

    // 30'ar cümlelik paketler halinde çevir; şu anki konumdan başla ki ekrandaki hemen gelsin
    const v = video(); const t = v ? v.currentTime : 0;
    const bas = Math.max(0, cues.findIndex(c => c.son >= t));
    const sira = [...cues.slice(bas), ...cues.slice(0, bas)];
    for (let i = 0; i < sira.length; i += 30) {
      if (!gecerli() || mode === 'off' && panel.hidden) return;
      const paket = sira.slice(i, i + 30).filter(c => !trOf(c));
      if (!paket.length) continue;
      const out = await cevir([paket.map(c => c.en).join('\n')]);
      const satir = (out?.[0] || '').split('\n').map(s => s.trim()).filter(Boolean);
      if (satir.length === paket.length) paket.forEach((c, k) => { c.tr = satir[k]; sozluk.set(c.en, satir[k]); });
      else if (out) {   // satırlar eşleşmediyse tek tek çevir
        const tek = await cevir(paket.map(c => c.en));
        if (tek) paket.forEach((c, k) => { if (tek[k]) { c.tr = tek[k]; sozluk.set(c.en, tek[k]); } });
      } else {          // hata: biraz bekle, aynı paketi bir kez daha dene
        d.hata = (d.hata || 0) + 1;
        if (d.hata > 3) break;
        await new Promise(r => setTimeout(r, 3000));
        i -= 30;
        continue;
      }
      ciz(); if (i === 0 || i % 120 === 0) dokumCiz();
    }
    if (gecerli()) { d.durum = 'hazir'; dokumCiz(); }
  }

  // ---------------------------------------------------------------------------
  // Ekranda gösterme (kendi altyazı katmanımız, videoyla senkron)
  // ---------------------------------------------------------------------------
  const video = () => document.querySelector('video');
  const oynatici = () => {
    const u = UDEMY && document.querySelector('[class*="video-player--container"], [data-purpose="video-player"]');
    if (u) return u;
    const v = video(); if (!v) return null;
    const fs = document.fullscreenElement;
    const p = fs && fs !== v && fs.contains(v) ? fs : v.parentElement;
    if (p && getComputedStyle(p).position === 'static') p.style.position = 'relative';
    return p;
  };
  // Oynatıcının kendi İngilizce altyazısı şu an ekranda mı?
  const yerliAcik = () => !!document.querySelector(UDEMY_CUE)?.textContent.trim() ||
    [...(video()?.textTracks || [])].some(t => t.mode === 'showing' && t.activeCues?.length);
  // "Sadece TR" modunda oynatıcının kendi (HTML5) altyazısını gizle, kapatınca geri aç
  const gizlenen = new Set();
  function yerliGizle(gizle) {
    for (const t of video()?.textTracks || []) {
      if (gizle && t.mode === 'showing') { t.mode = 'hidden'; gizlenen.add(t); }
      else if (!gizle && gizlenen.has(t)) { t.mode = 'showing'; gizlenen.delete(t); }
    }
  }

  const katman = document.createElement('div');
  katman.className = 'sc-ovl';

  function ciz() {
    const v = video(), oyn = oynatici();
    if (mode === 'off' || !v || !oyn) { katman.remove(); return; }
    if (katman.parentElement !== oyn) oyn.appendChild(katman);
    const t = v.currentTime;
    const c = ders?.cues.find(x => t >= x.bas && t <= x.son + 0.15);
    yerliGizle(mode === 'tr');
    const udemyAcik = yerliAcik();
    katman.textContent = '';
    if (!c) return;
    if (mode === 'both' && !udemyAcik) { const e = document.createElement('div'); e.className = 'sc-ovl-en'; e.textContent = c.en; katman.appendChild(e); }
    const tr = trOf(c);
    const r = document.createElement('div'); r.className = 'sc-ovl-tr';
    r.textContent = tr || (sonHata ? '⚠ ' + sonHata : mode === 'tr' ? c.en : '…');
    katman.appendChild(r);
    document.querySelectorAll(UDEMY_CUE).forEach(n => n.parentElement?.classList.toggle('sc-cap-sadece', mode === 'tr'));
  }

  // Transkript bulunamazsa yedek yol: ekrandaki Udemy altyazısını canlı çevir (CC → English açık olmalı)
  async function canliYedek() {
    if (mode === 'off' || ders?.durum !== 'yok') return;
    // Ekrandaki altyazıyı oku: önce oynatıcının DOM'u, yoksa video izinin aktif cümlesi
    const ekranda = () => {
      const d = norm(document.querySelector(UDEMY_CUE)?.textContent);
      if (d) return d;
      for (const t of video()?.textTracks || []) if (t.mode !== 'disabled' && t.activeCues?.length) return norm([...t.activeCues].map(c => c.text).join(' '));
      return '';
    };
    const cue = document.querySelector(UDEMY_CUE);
    const en = ekranda(); if (!en) return;
    if (!sozluk.has(en)) { sozluk.set(en, ''); const o = await cevir([en]); sozluk.set(en, o?.[0] || ''); }
    const tr = sozluk.get(en); if (!tr || ekranda() !== en) return;
    const oyn = oynatici(); if (!oyn) return;
    if (katman.parentElement !== oyn) oyn.appendChild(katman);
    katman.textContent = '';
    const r = document.createElement('div'); r.className = 'sc-ovl-tr'; r.textContent = tr; katman.appendChild(r);
    cue.parentElement?.classList.toggle('sc-cap-sadece', mode === 'tr');
  }

  // ---------------------------------------------------------------------------
  // Türkçe döküm paneli
  // ---------------------------------------------------------------------------
  const panel = document.createElement('div');
  panel.className = 'sc-ui sc-dokum';
  panel.hidden = true;
  const dk = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function dokumCiz() {
    if (panel.hidden) return;
    panel.textContent = '';
    const bas = document.createElement('div'); bas.className = 'sc-dokum-bas';
    const baslik = document.createElement('b'); baslik.textContent = 'Türkçe döküm';
    const kopya = document.createElement('button'); kopya.textContent = 'Kopyala';
    kopya.onclick = async () => {
      const metin = ders?.durum === 'yok' ? tani() : (ders?.cues || []).map(c => trOf(c) || c.en).join(' ');
      try { await navigator.clipboard.writeText(metin); kopya.textContent = '✓ Kopyalandı'; } catch { kopya.textContent = 'Kopyalanamadı'; }
    };
    const kapat = document.createElement('button'); kapat.textContent = '✕'; kapat.onclick = () => { panel.hidden = true; };
    bas.append(baslik, kopya, kapat);
    panel.appendChild(bas);

    const govde = document.createElement('div'); govde.className = 'sc-dokum-govde';
    if (!ders || ders.durum === 'yukleniyor' && !ders.cues.length) govde.textContent = 'Transkript alınıyor…';
    else if (ders.durum === 'yok') {
      const a = document.createElement('div');
      a.textContent = 'Bu derste transkript bulunamadı. Oynatıcıda CC / altyazı düğmesi varsa English aç, sonra Döküm\'e iki kez bas (kapat-aç). ' +
        'Yine olmazsa "Kopyala" ile aşağıdaki tanı raporunu kopyalayıp Claude\'a yapıştır.';
      const pre = document.createElement('pre');
      pre.style.cssText = 'white-space:pre-wrap;font-size:11px;color:#8b94a3;margin-top:10px';
      pre.textContent = tani();
      govde.append(a, pre);
    }
    else {
      const bitti = ders.cues.filter(trOf).length;
      const d = document.createElement('div'); d.className = 'sc-dokum-en';
      d.textContent = `${bitti}/${ders.cues.length} cümle çevrildi` + (sonHata ? ` · ⚠ ${sonHata}` : '');
      govde.appendChild(d);
    }
    if (ders?.cues.length) ders.cues.forEach(c => {
      const s = document.createElement('div'); s.className = 'sc-dokum-s';
      const z = document.createElement('span'); z.className = 'sc-dokum-z'; z.textContent = dk(c.bas);
      const tr = document.createElement('div'); tr.textContent = trOf(c) || '…';
      const en = document.createElement('div'); en.className = 'sc-dokum-en'; en.textContent = c.en;
      s.append(z, tr, en);
      s.onclick = () => { const v = video(); if (v) { v.currentTime = c.bas; v.play?.(); } };
      govde.appendChild(s);
    });
    panel.appendChild(govde);
  }

  // ---------------------------------------------------------------------------
  // Düğmeler, mod, ders değişimi
  // ---------------------------------------------------------------------------
  const kutu = document.createElement('div');
  kutu.className = 'sc-ui sc-cap-kutu';
  const dugme = document.createElement('button');
  dugme.className = 'sc-cap-btn'; dugme.textContent = 'TR';
  dugme.onclick = e => { e.stopPropagation(); sonraki(); };
  const dokumBtn = document.createElement('button');
  dokumBtn.className = 'sc-cap-btn'; dokumBtn.textContent = 'Döküm'; dokumBtn.title = 'Dersin Türkçe transkripti';
  dokumBtn.onclick = e => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden && (!ders || ders.durum === 'yok' || ders.id !== (dersId() || location.pathname))) dersYukle();
    dokumCiz();
  };
  kutu.append(dugme, dokumBtn);

  function modAyarla(m, sessiz) {
    mode = m;
    try { chrome.storage.local.set({ udemyAltyazi: m }); } catch {}
    dugme.dataset.mode = m;
    dugme.title = LABEL[m] + '  (Alt+U ile değiştir)';
    if (m === 'off') {
      katman.remove();
      yerliGizle(false);
      document.querySelectorAll('.sc-cap-sadece').forEach(n => n.classList.remove('sc-cap-sadece'));
    } else if (!ders || ders.id !== (dersId() || location.pathname) || (ders.durum !== 'yukleniyor' && ders.cues.some(c => !c.tr))) dersYukle();
    ciz();
    if (!sessiz) bildir(LABEL[m]);
  }
  const sonraki = () => modAyarla(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);

  // Video izinden gelen altyazı parça parça yüklenir (HLS) → yeni cümleleri ekle ve çevir
  let izMesgul = false;
  async function izYenile() {
    if (izMesgul || mode === 'off' || ders?.kaynak !== 'iz' || ders.durum === 'yukleniyor') return;
    const d = ders, var_ = new Set(d.cues.map(c => c.bas + '|' + c.en));
    const yeni = izCues().filter(c => !var_.has(c.bas + '|' + c.en));
    if (!yeni.length) return;
    izMesgul = true;
    d.cues.push(...yeni); d.cues.sort((a, b) => a.bas - b.bas);
    const bekleyen = yeni.filter(c => !trOf(c));
    for (let i = 0; i < bekleyen.length; i += 30) {
      const paket = bekleyen.slice(i, i + 30);
      const out = await cevir(paket.map(c => c.en));
      if (!out) break;
      paket.forEach((c, k) => { if (out[k]) { c.tr = out[k]; sozluk.set(c.en, out[k]); } });
    }
    izMesgul = false;
    ciz(); dokumCiz();
  }

  setInterval(() => {
    izYenile();
    // Ders değişti mi (Udemy sayfayı yenilemeden ders değiştirir)
    // Sadece ders numarası değişince yeniden yükle (Udemy oynarken linkin sonunu sürekli günceller)
    const simdiki = dersId() || '';
    if (simdiki !== sonDers) {
      const ilk = sonDers === '';
      sonDers = simdiki;
      if (!ilk && simdiki && (mode !== 'off' || !panel.hidden)) setTimeout(() => { if (dersId() === simdiki && ders?.id !== simdiki) dersYukle(); }, 1200);
    }
    // Düğmeleri ve paneli oynatıcıya taşı (tam ekranda da görünsün)
    const hedef = document.fullscreenElement || document.body;
    if (kutu.parentElement !== hedef) hedef.appendChild(kutu);
    if (panel.parentElement !== hedef) hedef.appendChild(panel);
    kutu.hidden = !video();
  }, 1000);

  // Video zamanına göre altyazı
  document.addEventListener('timeupdate', e => { if (e.target.tagName === 'VIDEO') { ciz(); canliYedek(); } }, true);
  document.addEventListener('seeked', e => { if (e.target.tagName === 'VIDEO') ciz(); }, true);

  let bTimer = null;
  function bildir(m) {
    let t = document.querySelector('.sc-cap-toast');
    if (!t) { t = document.createElement('div'); t.className = 'sc-ui sc-cap-toast'; }
    (document.fullscreenElement || document.body).appendChild(t);
    t.textContent = m; t.classList.add('show');
    clearTimeout(bTimer); bTimer = setTimeout(() => t.classList.remove('show'), 2500);
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'cmd' && msg.cmd === 'toggle-captions') { sonraki(); sendResponse({ ok: true }); }
  });

  chrome.storage.local.get('udemyAltyazi').then(({ udemyAltyazi }) => {
    modAyarla(MODES.includes(udemyAltyazi) ? udemyAltyazi : 'off', true);
  }).catch(() => modAyarla('off', true));
})();
