// SiberÇeviri — LLM çıktı/girdi koruması (v1.4.0)
// Sayfa metni güvenilmeyen veridir. Bu dosya:
//  1) girdiden segment işaretlerini ayıklar (işaret taklidi),
//  2) her istek için tahmin edilemez işaret (nonce) üretir,
//  3) modelin çıktısını doğrular; şüpheli çeviriyi reddeder (çağıran Google'a düşer).
// Not: Burada test kanaryalarına (KANARYA-*) özel kural YOKTUR; kontroller geneldir.
(function (root) {
  const PH_RE = /_{1,2}\s*C\s*(\d+)\s*_{1,2}/gi;
  const URL_RE = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;
  const SHELL_PIPE_RE = /\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i;
  const TR_SIGNAL_RE = /[çğıöşüÇĞİÖŞÜ]|\b(?:ve|bir|bu|için|ile|olan|olarak|değil|nasıl|şu|da|de|ne|mi)\b/i;

  function makeNonce() {
    const b = new Uint8Array(6);
    (root.crypto || globalThis.crypto).getRandomValues(b);
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }

  // Girdideki <<< ve >>> dizilerini benzer görünen işaretlere çevir: model artık
  // sayfa metnini segment işareti sanamaz.
  function sanitizeInput(text) {
    return text.replace(/<{3,}/g, m => '‹'.repeat(m.length)).replace(/>{3,}/g, m => '›'.repeat(m.length));
  }

  function buildInput(texts, nonce) {
    return texts.map((t, i) => `<<<${nonce}:${i + 1}>>>\n${sanitizeInput(t)}`).join('\n\n');
  }

  // Yalnızca bu isteğin nonce'unu taşıyan işaretleri kabul et.
  // Aynı numara birden fazla geçerse o segment şüphelidir.
  function parseOutput(text, n, nonce) {
    const out = new Array(n);
    const dup = new Set();
    const re = new RegExp(`<<<\\s*${nonce}\\s*:\\s*(\\d+)\\s*>>>`, 'g');
    const parts = text.split(re);
    for (let i = 1; i < parts.length; i += 2) {
      const idx = parseInt(parts[i], 10) - 1;
      const val = (parts[i + 1] || '').trim();
      if (idx < 0 || idx >= n) continue;
      if (out[idx] !== undefined) dup.add(idx);
      out[idx] = val;
    }
    dup.forEach(i => { out[i] = undefined; });
    return { out, duplicates: [...dup] };
  }

  function phCounts(s) {
    const m = new Map();
    s.replace(PH_RE, (_, d) => { m.set(d, (m.get(d) || 0) + 1); return _; });
    return m;
  }

  // Çeviri güvenilir mi? { ok, reason }
  function validate(src, tr) {
    if (!tr) return { ok: false, reason: 'boş çıktı' };
    const inLen = src.length, outLen = tr.length;

    // Uzunluk: aşırı uzama (talimatla tekrar, sızdırma) veya aşırı kısalma (çeviri yerine tek kelime)
    if (outLen > inLen * 3 + 200) return { ok: false, reason: 'çıktı beklenenden çok uzun' };
    if (inLen >= 40 && outLen < inLen * 0.35) return { ok: false, reason: 'çıktı beklenenden çok kısa' };

    // Yer tutucular: girdidekilerin hepsi olmalı, fazlası olmamalı
    const a = phCounts(src), b = phCounts(tr);
    for (const [d, c] of b) if (c > (a.get(d) || 0)) return { ok: false, reason: 'fazladan yer tutucu' };
    for (const [d] of a) if (!b.has(d)) return { ok: false, reason: 'eksik yer tutucu' };

    // Girdide olmayan yeni bağlantı veya "| bash" gibi komut zinciri eklenmemeli
    const srcUrls = new Set((src.match(URL_RE) || []).map(u => u.toLowerCase()));
    for (const u of tr.match(URL_RE) || []) if (!srcUrls.has(u.toLowerCase())) return { ok: false, reason: 'girdide olmayan bağlantı' };
    // Kod/komutlar zaten yer tutucuyla korunur; düz metinde "| bash" görünmesi beklenmez.
    // Girdide olsa bile Claude çıktısı reddedilir (bedeli: o paragraf Google ile çevrilir).
    if (SHELL_PIPE_RE.test(tr)) return { ok: false, reason: 'düz metinde komut zinciri' };

    // Dil: uzun İngilizce girdinin çıktısında Türkçe izi yoksa çeviri yapılmamıştır
    const words = src.replace(PH_RE, ' ').match(/[A-Za-z]{2,}/g) || [];
    if (words.length >= 6 && !TR_SIGNAL_RE.test(tr)) return { ok: false, reason: 'çıktı Türkçe değil' };

    return { ok: true };
  }

  root.SCGuard = { makeNonce, sanitizeInput, buildInput, parseOutput, validate };
})(typeof self !== 'undefined' ? self : globalThis);
