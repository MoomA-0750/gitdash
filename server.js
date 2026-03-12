const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { getCurrentUser } = require('./lib/auth');
const git = require('./lib/git');
const { parseMarkdown } = require('./lib/markdown');
const { highlightCode } = require('./lib/syntax-highlight');

const PORT = process.env.PORT || 5987;
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');

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
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  });
}

// --- POST body パーサー ---
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
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

  // プライベートリポジトリの認証チェック（オーナーまたは共有ユーザーのみ）
  if (visibility === 'private') {
    const username = await getCurrentUser(req);
    if (!username) {
      return sendError(res, 'Unauthorized', 401);
    }
    if (username !== owner) {
      const sharedUsers = git.getRepoShared(repo, visibility, owner);
      if (!sharedUsers.includes(username)) {
        return sendError(res, 'Forbidden', 403);
      }
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
        sendJson(res, await git.getCommits(repo, visibility, owner, hb));
        break;
      case 'branches':
        sendJson(res, await git.getBranches(repo, visibility, owner));
        break;
      case 'diff':
        sendJson(res, await git.getDiff(repo, h, visibility, owner));
        break;
      case 'tree':
        sendJson(res, await git.getTree(repo, f, hb, visibility, owner));
        break;
      case 'blob': {
        const blobData = await git.getBlob(repo, f, hb, visibility, owner);
        if (!blobData.binary && !blobData.error && !blobData.truncated && !blobData.empty && blobData.content) {
          const ext = (f || '').split('.').pop().toLowerCase();
          if (ext === 'md' || ext === 'markdown') {
            blobData.contentHtml = await parseMarkdown(blobData.content);
            blobData.renderMode = 'markdown';
          } else {
            blobData.highlightedHtml = await highlightCode(blobData.content, ext);
            blobData.renderMode = 'code';
            blobData.language = ext;
          }
        }
        sendJson(res, blobData);
        break;
      }
      case 'readme': {
        const readmeData = await git.getReadme(repo, visibility, owner, hb);
        // サーバーサイドでマークダウンをHTMLに変換
        if (readmeData.readme) {
          readmeData.readmeHtml = await parseMarkdown(readmeData.readme);
        } else {
          readmeData.readmeHtml = '';
        }
        sendJson(res, readmeData);
        break;
      }
      case 'create_repo': {
        // 認証必須
        const username = await getCurrentUser(req);
        if (!username) {
          return sendError(res, 'ログインが必要です', 401);
        }
        const body = await readBody(req);
        const repoName = body.repoName || '';
        const repoVisibility = body.visibility || 'public';
        const description = body.description || '';
        const repoOwner = username;
        const result = await git.createRepo(repoName, repoVisibility, repoOwner, description);
        sendJson(res, result);
        break;
      }
      case 'change_visibility': {
        // 認証必須
        const username = await getCurrentUser(req);
        if (!username) {
          return sendError(res, 'ログインが必要です', 401);
        }
        const body = await readBody(req);
        const repoName = body.repoName || '';
        const repoVisibility = body.visibility || 'public';
        const repoOwner = body.owner || '';
        const newVisibility = body.newVisibility || '';

        if (!newVisibility) {
          return sendError(res, '新しい可視性を指定してください', 400);
        }

        // ownerファイルを確認し、リクエストユーザーと一致するかチェック
        const actualOwner = git.getRepoOwner(repoName, repoVisibility, repoOwner);
        if (!actualOwner) {
          return sendError(res, 'このリポジトリのオーナー情報がありません', 403);
        }
        if (actualOwner !== username) {
          return sendError(res, 'リポジトリのオーナーのみ変更できます', 403);
        }

        const result = git.changeVisibility(repoName, repoVisibility, actualOwner, newVisibility);
        sendJson(res, result);
        break;
      }
      case 'get_shared': {
        // アクセス権のあるユーザーなら共有一覧を取得可能（認証チェックは上部で済み）
        const sharedUsers = git.getRepoShared(repo, visibility, owner);
        sendJson(res, { sharedWith: sharedUsers });
        break;
      }
      case 'set_shared': {
        // 認証必須・オーナーのみ
        const username = await getCurrentUser(req);
        if (!username) {
          return sendError(res, 'ログインが必要です', 401);
        }
        const body = await readBody(req);
        const repoName = body.repoName || '';
        const repoVisibility = body.visibility || 'public';
        const repoOwner = body.owner || '';
        const sharedUsers = Array.isArray(body.sharedUsers) ? body.sharedUsers : [];

        const actualOwner = git.getRepoOwner(repoName, repoVisibility, repoOwner);
        if (!actualOwner) {
          return sendError(res, 'このリポジトリのオーナー情報がありません', 403);
        }
        if (actualOwner !== username) {
          return sendError(res, 'リポジトリのオーナーのみ共有設定を変更できます', 403);
        }

        const result = git.setRepoShared(repoName, repoVisibility, actualOwner, sharedUsers);
        sendJson(res, result);
        break;
      }
      case 'delete_repo': {
        // 認証必須
        const username = await getCurrentUser(req);
        if (!username) {
          return sendError(res, 'ログインが必要です', 401);
        }
        const body = await readBody(req);
        const repoName = body.repoName || '';
        const repoVisibility = body.visibility || 'public';
        const repoOwner = body.owner || '';

        // ownerファイルを確認し、リクエストユーザーと一致するかチェック
        const actualOwner = git.getRepoOwner(repoName, repoVisibility, repoOwner);
        if (!actualOwner) {
          return sendError(res, 'このリポジトリのオーナー情報がありません。削除できません。', 403);
        }
        if (actualOwner !== username) {
          return sendError(res, 'リポジトリのオーナーのみ削除できます', 403);
        }

        const result = git.deleteRepo(repoName, repoVisibility, repoOwner);
        sendJson(res, result);
        break;
      }
      case 'user_repos_detail': {
        const username = await getCurrentUser(req);
        if (!username) {
          return sendError(res, 'ログインが必要です', 401);
        }
        sendJson(res, git.getUserReposWithSharing(username));
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
    if (pathname === BASE_PATH + '/api' || pathname === BASE_PATH + '/api/') {
      await handleApi(req, res, params);
      return;
    }

    // 静的ファイル
    if (pathname.startsWith(BASE_PATH + '/static/')) {
      const stripped = pathname.slice(BASE_PATH.length);
      const safePath = path.normalize(stripped).replace(/^(\.\.(\/|\\|$))+/, '');
      const filePath = path.join(__dirname, safePath);
      serveStatic(req, res, filePath);
      return;
    }

    // ダッシュボード（ルート）
    if (pathname === BASE_PATH + '/' || pathname === BASE_PATH + '/index.html' || pathname === BASE_PATH) {
      let html = fs.readFileSync(path.join(__dirname, 'dashboard', 'index.html'), 'utf8');
      html = html.replace('__BASE_PATH__', BASE_PATH);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      res.end(html);
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Git Dashboard server running on http://127.0.0.1:${PORT}${BASE_PATH || '/'}`);
});
