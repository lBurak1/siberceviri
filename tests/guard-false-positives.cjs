// False-positive check: honest translations of typical training content must pass SCGuard.validate.
// Usage: node tests/guard-false-positives.cjs <extension-dir>
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const extDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'extension'));
const ctx = { crypto: globalThis.crypto };
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(extDir, 'guard.js'), 'utf8'), ctx);
const G = ctx.SCGuard;

const PAIRS = [
  ['Task 3', 'Görev 3'],
  ['What is the flag?', 'Bayrak nedir?'],
  ['Run __C0__ to list the files in the current directory.', 'Geçerli dizindeki dosyaları listelemek için __C0__ komutunu çalıştır.'],
  ['Use __C0__ with the __C1__ flag to scan all ports, then save the output with __C2__.', 'Tüm portları taramak için __C0__ aracını __C1__ bayrağıyla kullan, ardından çıktıyı __C2__ ile kaydet.'],
  ['Privilege escalation is the process of gaining higher permissions on a system.', 'Yetki yükseltme (privilege escalation), bir sistemde daha yüksek izinler elde etme sürecidir.'],
  ['Read the official documentation at https://nmap.org/book/man.html before you continue.', 'Devam etmeden önce https://nmap.org/book/man.html adresindeki resmi dokümantasyonu oku.'],
  ['SQL injection occurs when user input is concatenated directly into a database query without parameterization.', 'SQL enjeksiyonu (SQL injection), kullanıcı girdisi parametreleştirme yapılmadan doğrudan bir veritabanı sorgusuna eklendiğinde ortaya çıkar.'],
  ['Cross-site scripting (XSS) allows an attacker to execute JavaScript in the browser of another user.', 'Siteler arası betik çalıştırma (cross-site scripting, XSS), bir saldırganın başka bir kullanıcının tarayıcısında JavaScript çalıştırmasına olanak tanır.'],
  ['Burp Suite', 'Burp Suite'],
  ['A web application firewall (WAF) inspects HTTP traffic and blocks requests that match known attack patterns, such as SQL injection or XSS payloads.', 'Web uygulama güvenlik duvarı (web application firewall, WAF), HTTP trafiğini inceler ve SQL enjeksiyonu (SQL injection) veya XSS payload\'ları gibi bilinen saldırı kalıplarına uyan istekleri engeller.']
];

let fail = 0;
for (const [en, tr] of PAIRS) {
  const v = G.validate(en, tr);
  if (!v.ok) { fail++; console.log(`  FALSE POSITIVE (${v.reason}): ${en}`); }
}
console.log(`guard false-positive check: ${PAIRS.length - fail}/${PAIRS.length} honest translations accepted`);
process.exitCode = fail ? 1 : 0;
