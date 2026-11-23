// Test sayfasini sadece bu bilgisayarda (127.0.0.1:8765) yayinlar.
const http = require('http');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'test-page.html');
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
}).listen(8765, '127.0.0.1', () => {
  console.log('Test sayfasi: http://127.0.0.1:8765  (kapatmak icin Ctrl+C)');
});
