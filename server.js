/**
 * 產品／化學品申請系統 - 後端伺服器
 * 純 Node.js，無需安裝任何套件
 *
 * 啟動方式：
 *   node server.js
 *
 * 預設埠號：3000
 * 管理密碼：1234（可在下方 ADMIN_PIN 修改）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'applications.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// 確保 data 目錄存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

// ---------- 資料存取 ----------
function readApps() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeApps(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function generateAppNo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'A';
  for (let i = 0; i < 8; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

// ---------- MIME ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Pin',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(text);
}

function checkAdmin(req) {
  const pin = req.headers['x-admin-pin'] || '';
  return pin === ADMIN_PIN;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  // 防止路徑穿越
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      if (pathname !== '/' && !path.extname(pathname)) {
        return serveStatic(req, res, '/');
      }
      // 首頁找不到時給清楚說明（常見於 public/ 未上傳到 GitHub）
      if (pathname === '/' || pathname === '/index.html') {
        const html = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>頁面未找到</title></head><body style="font-family:sans-serif;max-width:480px;margin:2rem auto;padding:1rem;line-height:1.6"><h1>找不到申請表單頁面</h1><p>伺服器已啟動，但 <code>public/index.html</code> 不存在。</p><p>請確認 GitHub 倉庫根目錄有：</p><pre>server.js\npackage.json\npublic/\n  index.html</pre><p>補上傳後，在 Railway 重新 Deploy 即可。</p><p><a href="/api/health">查看 /api/health 診斷</a></p></body></html>`;
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      sendText(res, 404, 'Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Pin',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  try {
    // GET /api/health  診斷（公開）
    if (method === 'GET' && pathname === '/api/health') {
      let publicFiles = [];
      try {
        publicFiles = fs.readdirSync(PUBLIC_DIR);
      } catch (e) {
        publicFiles = ['(public 目錄不存在)'];
      }
      return sendJSON(res, 200, {
        ok: true,
        port: PORT,
        hasIndex: fs.existsSync(path.join(PUBLIC_DIR, 'index.html')),
        publicDir: PUBLIC_DIR,
        publicFiles,
        cwd: process.cwd(),
        dirname: __dirname,
      });
    }

    // POST /api/applications  新增申請（公開）
    if (method === 'POST' && pathname === '/api/applications') {
      const body = await readBody(req);
      if (!body || !Array.isArray(body.items) || body.items.length === 0) {
        return sendJSON(res, 400, { ok: false, error: '請至少提交一項物品' });
      }
      for (const it of body.items) {
        if (!it.category || !it.name || !it.ingredients) {
          return sendJSON(res, 400, { ok: false, error: '每項物品需包含類別、名稱、成份／用途' });
        }
      }
      const appNo = generateAppNo();
      const record = {
        appNo,
        items: body.items.map((it) => ({
          category: String(it.category).trim(),
          name: String(it.name).trim(),
          ingredients: String(it.ingredients).trim(),
        })),
        remarks: body.remarks ? String(body.remarks).trim() : '',
        submittedAt: new Date().toISOString(),
      };
      const list = readApps();
      list.push(record);
      writeApps(list);
      return sendJSON(res, 201, { ok: true, appNo });
    }

    // GET /api/applications  清單（需管理密碼）
    if (method === 'GET' && pathname === '/api/applications') {
      if (!checkAdmin(req)) {
        return sendJSON(res, 401, { ok: false, error: '未授權，請提供正確管理密碼' });
      }
      const list = readApps();
      return sendJSON(res, 200, { ok: true, data: list });
    }

    // DELETE /api/applications  清空（需管理密碼）
    if (method === 'DELETE' && pathname === '/api/applications') {
      if (!checkAdmin(req)) {
        return sendJSON(res, 401, { ok: false, error: '未授權' });
      }
      writeApps([]);
      return sendJSON(res, 200, { ok: true });
    }

    // GET /api/export.csv  匯出 CSV（需管理密碼）
    if (method === 'GET' && pathname === '/api/export.csv') {
      if (!checkAdmin(req)) {
        return sendJSON(res, 401, { ok: false, error: '未授權' });
      }
      const list = readApps();
      const header = ['申請編號', '送出時間', '物品序', '物品類別', '申請物品名稱', '成份／用途', '備註'];
      const rows = [header.join(',')];
      list.forEach((app) => {
        const time = app.submittedAt
          ? new Date(app.submittedAt).toISOString().replace('T', ' ').slice(0, 16)
          : '';
        const remarks = csvEscape(app.remarks || '');
        (app.items || []).forEach((it, idx) => {
          rows.push(
            [
              csvEscape(app.appNo),
              csvEscape(time),
              idx + 1,
              csvEscape(it.category || ''),
              csvEscape(it.name || ''),
              csvEscape(it.ingredients || ''),
              remarks,
            ].join(',')
          );
        });
      });
      const csv = '\uFEFF' + rows.join('\n'); // BOM for Excel
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="applications_${Date.now()}.csv"`,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(csv);
      return;
    }

    // 靜態檔案
    serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { ok: false, error: '伺服器錯誤' });
  }
});

function csvEscape(val) {
  const s = String(val).replace(/"/g, '""');
  if (/[",\n\r]/.test(s)) return `"${s}"`;
  return s;
}

server.listen(PORT, '0.0.0.0', () => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  const hasIndex = fs.existsSync(indexPath);
  console.log('');
  console.log('========================================');
  console.log('  產品／化學品申請系統已啟動');
  console.log('========================================');
  console.log(`  PORT: ${PORT}`);
  console.log(`  public/index.html: ${hasIndex ? 'OK' : 'MISSING!'}`);
  console.log(`  PUBLIC_DIR: ${PUBLIC_DIR}`);
  console.log(`  管理密碼：  ${ADMIN_PIN}`);
  console.log('========================================');
  console.log('');
  if (!hasIndex) {
    console.error('警告：找不到 public/index.html，首頁會顯示錯誤說明。');
  }
});
