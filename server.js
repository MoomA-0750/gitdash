const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { getCurrentUser } = require('./lib/auth');
const git = require('./lib/git');
const { parseMarkdown } = require('./lib/markdown');

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// --- JSON レスポンス ---
function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res, message, status = 500) {
  sendJson(res, { error: message }, status);
}

// --- 静的ファイル配信 ---
function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

// --- API ハンドラー ---
async function handleApi(req, res, params) {
  const action     = params.get('action') || '';
  const repo       = params.get('repo') || '';
  const h          = params.get('h') || '';
  const f          = params.get('f') || '';
  const hb         = params.get('hb') || 'HEAD';
  const visibility = params.get('visibility') || 'public';
  const owner      = params.get('owner') || '';

  // プライベートリポジトリの認証チェック
  if (visibility === 'private') {
    const username = await getCurrentUser(req);
    if (!username) {
      return sendError(res, 'Unauthorized', 401);
    }
    if (username !== owner) {
      return sendError(res, 'Forbidden', 403);
    }
  }

  try {
    switch (action) {
      case 'repos': {
        const username = await getCurrentUser(req);
        sendJson(res, git.getRepos(username));
        break;
      }
      case 'commits':
        sendJson(res, await git.getCommits(repo, visibility, owner));
        break;
      case 'diff':
        sendJson(res, await git.getDiff(repo, h, visibility, owner));
        break;
      case 'tree':
        sendJson(res, await git.getTree(repo, f, hb, visibility, owner));
        break;
      case 'readme': {
        const readmeData = await git.getReadme(repo, visibility, owner);
        // サーバーサイドでマークダウンをHTMLに変換
        if (readmeData.readme) {
          readmeData.readmeHtml = await parseMarkdown(readmeData.readme);
        } else {
          readmeData.readmeHtml = '';
        }
        sendJson(res, readmeData);
        break;
      }
      default:
        sendError(res, 'unknown action', 400);
    }
  } catch (e) {
    console.error(`API error [${action}]:`, e.message);
    sendError(res, e.message, 500);
  }
}

// --- リクエストハンドラー ---
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const params = new URLSearchParams(parsed.search || '');

  try {
    // API
    if (pathname === '/api' || pathname === '/api/') {
      await handleApi(req, res, params);
      return;
    }

    // 静的ファイル
    if (pathname.startsWith('/static/')) {
      const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
      const filePath = path.join(__dirname, safePath);
      serveStatic(req, res, filePath);
      return;
    }

    // ダッシュボード（ルート）
    if (pathname === '/' || pathname === '/index.html') {
      serveStatic(req, res, path.join(__dirname, 'dashboard', 'index.html'));
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  } catch (e) {
    console.error('Server error:', e);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Git Dashboard server running on http://localhost:${PORT}`);
});
