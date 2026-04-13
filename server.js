const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { createTransport } = (() => {
  try {
    const net = require('net');
    const tls = require('tls');
    return { createTransport: null };
  } catch(e) { return { createTransport: null }; }
})();

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'emails.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'djscott2026';
const PDF_PATH = path.join(__dirname, 'ADHD_Cognitive_Codex.pdf');
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'dj@djscottconsulting.com';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT || '587';
const SMTP_USER = process.env.SMTP_USER || ''
const SMTP_PASS = process.env.SMTP_PASS || '';

// ââ Download tokens (valid for 30 minutes) ââ
const downloadTokens = new Map();
function createDownloadToken() {
  const token = crypto.randomBytes(24).toString('hex');
  downloadTokens.set(token, Date.now() + 30 * 60 * 1000);
  return token;
}
function isValidToken(token)  {
  const expires = downloadTokens.get(token);
  if (!expires) return false;
  if (Date.now() > expires) { downloadTokens.delete(token); return false; }
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of downloadTokens) { if (now > exp) downloadTokens.delete(t); }
}, 10 * 60 * 1000);

// ââ Simple JSON database ââ
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
  catch { return { subscribers: [] }; }
}
function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
if (!fs.existsSync(DB_FILE)) saveDB({ subscribers: [] });

// —— Email notification (SMTP via STARTTLS on port 587) ——
function sendNotification(subscriberEmail) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log('[EMAIL] SMTP not configured. Would notify ' + NOTIFY_EMAIL + ' about new subscriber: ' + subscriberEmail);
    return;
  }
  const net = require('net');
  const tls = require('tls');
  const from = SMTP_USER;
  const to = NOTIFY_EMAIL;
  const subject = 'New ADHD Codex Subscriber: ' + subscriberEmail;
  const body = 'New subscriber on ADHD Cognitive Codex landing page:\n\nEmail: ' + subscriberEmail + '\nTime: ' + new Date().toISOString() + '\n\n\u2014 DJ Scott Consulting';

  const mailCommands = [
    'EHLO adhd-codex',
    'AUTH LOGIN',
    Buffer.from(from).toString('base64'),
    Buffer.from(SMTP_PASS).toString('base64'),
    'MAIL FROM:<' + from + '>',
    'RCPT TO:<' + to + '>',
    'DATA',
    'From: ' + from + '\r\nTo: ' + to + '\r\nSubject: ' + subject + '\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n' + body + '\r\n.',
    'QUIT'
  ];

  // State machine: 0=wait greeting, 1=sent EHLO wait 250, 2=sent STARTTLS wait 220, 3=TLS auth
  let state = 0;
  let cmdIdx = 0;

  const sock = net.createConnection(parseInt(SMTP_PORT) || 587, SMTP_HOST, () => {
    console.log('[EMAIL] Connected to ' + SMTP_HOST + ':' + SMTP_PORT);
  });
  sock.setEncoding('utf-8');

  sock.on('data', (data) => {
    const lines = data.trim();
    console.log('[EMAIL] [state=' + state + '] S: ' + lines.substring(0, 120));

    if (state === 0 && lines.startsWith('220')) {
      // Got greeting, send EHLO
      state = 1;
      sock.write('EHLO adhd-codex\r\n');
    } else if (state === 1 && lines.includes('250')) {
      // Got EHLO response, send STARTTLS
      state = 2;
      sock.write('STARTTLS\r\n');
    } else if (state === 2 && lines.startsWith('220')) {
      // STARTTLS accepted, upgrade socket to TLS
      state = 3;
      const tlsSock = tls.connect({ socket: sock, host: SMTP_HOST }, () => {
        console.log('[EMAIL] TLS handshake complete');
        // Send first command (EHLO) on TLS socket
        tlsSock.write(mailCommands[cmdIdx++] + '\r\n');
      });
      tlsSock.setEncoding('utf-8');
      tlsSock.on('data', (d) => {
        console.log('[EMAIL] TLS S: ' + d.trim().substring(0, 120));
        if (d.includes('221')) {
          console.log('[EMAIL] Notification sent to ' + to + ' about ' + subscriberEmail);
          tlsSock.destroy();
          return;
        }
        if (cmdIdx < mailCommands.length) {
          tlsSock.write(mailCommands[cmdIdx++] + '\r\n');
        }
      });
      tlsSock.on('error', (err) => console.error('[EMAIL] TLS Error:', err.message || err));
    }
  });

  sock.on('error', (err) => console.error('[EMAIL] Error:', err.message || err));
  sock.setTimeout(15000, () => { console.error('[EMAIL] Timeout'); sock.destroy(); });
}

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// ââ Helpers ââ
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// ââ Server ââ
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // ââ Block direct PDF access ââ
  if (pathname.toLowerCase().endsWith('.pdf') && pathname !== '/download') {
    res.writeHead(403);
    return res.end('Access denied. Subscribe to download.');
  }

  // ââ POST /api/subscribe ââ
  if (req.method === 'POST' && pathname === '/api/subscribe') {
    try {
      const raw = await readBody(req);
      const { email } = JSON.parse(raw);

      if (!email || typeof email !== 'string')
        return json(res, 400, { error: 'Email is required.' });

      const cleaned = email.trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned))
        return json(res, 400, { error: 'Please enter a valid email address.' });

      const db = loadDB();
      const alreadySubscribed = db.subscribers.some(s => s.email === cleaned);

      if (!alreadySubscribed) {
        db.subscribers.push({
          id: db.subscribers.length + 1,
          email: cleaned,
          subscribed_at: new Date().toISOString(),
          source: 'landing_page'
        });
        saveDB(db);
        console.log('[+] New subscriber: ' + cleaned + '  (total: ' + db.subscribers.length + ')');
        sendNotification(cleaned);
      }

      const token = createDownloadToken();
      return json(res, 200, {
        message: alreadySubscribed ? 'Welcome back!' : 'Subscribed successfully!',
        downloadToken: token,
        duplicate: alreadySubscribed
      });
    } catch (err) {
      console.error('Subscribe error:', err);
      return json(res, 500, { error: 'Server error. Please try again.' });
    }
  }

  // ââ GET /download?token=xxx ââ
  if (req.method === 'GET' && pathname === '/download') {
    const token = parsed.query.token;
    if (!token || !isValidToken(token)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link Expired</title>
        <style>body{font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f3f0;color:#1a1a2e;text-align:center}
        .box{max-width:420px;padding:3rem;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
        h1{font-size:1.4rem;margin-bottom:.8rem}p{color:#4a4a60;margin-bottom:1.5rem}
        a{display:inline-block;padding:.7rem 1.4rem;background:linear-gradient(135deg,#4361ee,#7b2ff7);color:#fff;border-radius:10px;text-decoration:none;font-weight:600}</style></head>
        <body><div class="box"><h1>Download link expired</h1><p>No worries \u2014 just enter your email again on the homepage to get a fresh download link.</p><a href="/#get-codex">Go to Homepage</a></div></body></html>`);
    }

    try {
      const pdf = fs.readFileSync(PDF_PATH);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="ADHD_Cognitive_Codex.pdf"',
        'Content-Length': pdf.length
      });
      return res.end(pdf);
    } catch (err) {
      console.error('PDF read error:', err);
      res.writeHead(500);
      return res.end('Error serving file.');
    }
  }

  // ââ GET /api/admin/subscribers ââ
  if (req.method === 'GET' && pathname === '/api/admin/subscribers') {
    if (parsed.query.token !== ADMIN_TOKEN)
      return json(res, 401, { error: 'Unauthorized' });
    const db = loadDB();
    return json(res, 200, { total: db.subscribers.length, subscribers: [...db.subscribers].reverse() });
  }

  // ââ GET /api/admin/export (CSV) ââ
  if (req.method === 'GET' && pathname === '/api/admin/export') {
    if (parsed.query.token !== ADMIN_TOKEN)
      return json(res, 401, { error: 'Unauthorized' });
    const db = loadDB();
    let csv = 'id,email,subscribed_at,source\n';
    db.subscribers.forEach(s => {
      csv += s.id + ',"' + s.email + '","' + s.subscribed_at + '","' + s.source + '"\n';
    });
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="subscribers.csv"'
    });
    return res.end(csv);
  }

  // ââ Static files ââ
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    try {
      const index = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(index);
    } catch {
      res.writeHead(404);
      res.end('Not Found');
    }
  }
});

server.listen(PORT, () => {
  const db = loadDB();
  console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551   ADHD Cognitive Codex \u2013 DJ Scott Consulting     \u2551
\u2551   http://localhost:${PORT}                           \u2551
\u2551   Subscribers: ${String(db.subscribers.length).padEnd(33)}\u2551
\u2551   Notify: ${NOTIFY_EMAIL.padEnd(38)}\u2551
\u2551   SMTP: ${SMTP_HOST ? 'configured' : 'not set (console only)'}\u2551
\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d
  `);
});
