const API = '/api';
let currentRepo = null;
let currentVisibility = 'public';
let currentOwner = null;
let currentTab = 'dashboard';
let authHeader = null;
let currentUsername = null;

// --- 認証ヘルパー ---
function makeBasicAuth(user, pass) {
  return 'Basic ' + btoa(unescape(encodeURIComponent(user + ':' + pass)));
}

async function apiFetch(params, auth) {
  const qs = new URLSearchParams(params).toString();
  const headers = {};
  const a = auth !== undefined ? auth : authHeader;
  if (a) headers['Authorization'] = a;
  const res = await fetch(`${API}?${qs}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// --- ログインモーダル ---
function showLogin() {
  document.getElementById('login-modal').classList.add('show');
  document.getElementById('login-user').focus();
}
function closeLogin() {
  document.getElementById('login-modal').classList.remove('show');
  document.getElementById('login-error').style.display = 'none';
}

async function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!user || !pass) return;
  const auth = makeBasicAuth(user, pass);
  try {
    const data = await apiFetch({ action: 'repos' }, auth);
    if (data.username) {
      authHeader = auth;
      currentUsername = data.username;
      closeLogin();
      updateUserBar();
      renderRepoList(data.repos);
    } else {
      document.getElementById('login-error').textContent = 'ユーザー名またはパスワードが違います';
      document.getElementById('login-error').style.display = 'block';
    }
  } catch (e) {
    document.getElementById('login-error').textContent = `エラー: ${e.message}`;
    document.getElementById('login-error').style.display = 'block';
  }
}

// Enter キーでログイン
document.getElementById('login-pass').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

function doLogout() {
  authHeader = null;
  currentUsername = null;
  currentRepo = null;
  updateUserBar();
  loadRepos();
  document.getElementById('content').innerHTML =
    '<div class="loading">リポジトリを選択してください</div>';
}

function updateUserBar() {
  const bar = document.getElementById('user-bar');
  if (currentUsername) {
    bar.innerHTML = `
      <span class="username">👤 ${escHtml(currentUsername)}</span>
      <button class="btn-logout" onclick="doLogout()">ログアウト</button>`;
  } else {
    bar.innerHTML = `
      <span id="user-label">未ログイン</span>
      <button class="btn-login" onclick="showLogin()">ログイン</button>`;
  }
}

// --- リポジトリ一覧 ---
async function loadRepos() {
  try {
    const data = await apiFetch({ action: 'repos' });
    renderRepoList(data.repos);
  } catch (e) {
    document.getElementById('repo-list-public').innerHTML =
      `<div class="error" style="font-size:12px;">Error: ${e.message}</div>`;
  }
}

function renderRepoList(repos) {
  const pubList  = document.getElementById('repo-list-public');
  const privList = document.getElementById('repo-list-private');
  const privSec  = document.getElementById('private-section');

  pubList.innerHTML  = '';
  privList.innerHTML = '';

  const pubRepos  = repos.filter(r => r.visibility === 'public');
  const privRepos = repos.filter(r => r.visibility === 'private');

  pubRepos.forEach(repo => pubList.appendChild(makeRepoItem(repo)));

  if (privRepos.length > 0) {
    privSec.style.display = 'block';
    privRepos.forEach(repo => privList.appendChild(makeRepoItem(repo)));
  } else {
    privSec.style.display = 'none';
  }
}

function makeRepoItem(repo) {
  const div = document.createElement('div');
  div.className = 'repo-item';
  const label = repo.name.replace('.git', '');
  const badge = repo.visibility === 'private'
    ? '<span class="badge badge-private">private</span>'
    : '<span class="badge badge-public">public</span>';
  div.innerHTML = `<span>${escHtml(label)}</span>${badge}`;
  div.onclick = () => selectRepo(repo, div);
  return div;
}

function selectRepo(repo, el) {
  document.querySelectorAll('.repo-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  currentRepo       = repo.name;
  currentVisibility = repo.visibility;
  currentOwner      = repo.owner;
  showTab(currentTab);
}

// --- タブ ---
function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active',
      ['dashboard', 'commits', 'files', 'diff'][i] === tab);
  });
  if (!currentRepo) {
    document.getElementById('content').innerHTML =
      '<div class="loading">リポジトリを選択してください</div>';
    return;
  }
  if (tab === 'dashboard') renderDashboard();
  else if (tab === 'commits') renderCommits();
  else if (tab === 'files') renderFiles();
  else if (tab === 'diff') renderDiff();
}

function repoParams(extra) {
  const p = { repo: currentRepo, visibility: currentVisibility, ...extra };
  if (currentOwner) p.owner = currentOwner;
  return p;
}

// --- クローンURL ---
function getCloneUrl() {
  const host = location.hostname;
  if (currentVisibility === 'private' && currentOwner) {
    return `http://${currentOwner}@${host}/git/private/${currentOwner}/${currentRepo}`;
  }
  return `http://${host}/git/public/${currentRepo}`;
}

function copyCloneUrl(btn) {
  const url = getCloneUrl();
  const ta = document.createElement('textarea');
  ta.value = url;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = 'Copy';
    btn.classList.remove('copied');
  }, 2000);
}

// --- ダッシュボード ---
async function renderDashboard() {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const [data, readmeData] = await Promise.all([
      apiFetch(repoParams({ action: 'commits' })),
      apiFetch(repoParams({ action: 'readme' }))
    ]);
    const latest = data.commits[0] || {};
    const visLabel = currentVisibility === 'private'
      ? '<span class="badge badge-private">private</span>'
      : '<span class="badge badge-public">public</span>';
    const cloneUrl = getCloneUrl();
    // readmeHtml はサーバーサイドで変換済み
    const readmeHtml = readmeData.readmeHtml
      ? `<div class="readme-box">
          <div class="readme-header">📄 ${escHtml(readmeData.filename)}</div>
          <div class="readme-body">${readmeData.readmeHtml}</div>
         </div>`
      : '';
    c.innerHTML = `
      <div class="repo-title">
        <h2>${escHtml(currentRepo.replace('.git',''))}</h2>${visLabel}
      </div>
      <div class="clone-url-box">
        <span class="clone-label">Clone:</span>
        <code>${escHtml(cloneUrl)}</code>
        <button class="btn-copy" onclick="copyCloneUrl(this)">Copy</button>
      </div>
      <div class="stats">
        <div class="stat-card">
          <div class="stat-num">${data.commits.length}</div>
          <div class="stat-label">Recent Commits</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="font-size:18px">${escHtml(latest.author || '-')}</div>
          <div class="stat-label">Latest Author</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="font-size:20px">${latest.date ? latest.date.split('T')[0] : '-'}</div>
          <div class="stat-label">Last Commit</div>
        </div>
      </div>
      <div style="margin-top:20px;">
        <h3 style="color:var(--muted);font-size:13px;margin-bottom:12px;">LATEST COMMIT</h3>
        ${data.commits.slice(0, 1).map(renderCommitCard).join('')}
      </div>
      ${readmeHtml}`;
  } catch (e) {
    c.innerHTML = `<div class="error">Error: ${e.message}</div>`;
  }
}

function renderCommitCard(commit) {
  const hash = (commit.hash || '').substring(0, 7);
  const date = (commit.date || '').split('T')[0];
  return `<div class="commit">
    <div class="commit-title">${escHtml(commit.title)}</div>
    <div class="commit-meta">
      <span class="commit-hash" onclick="loadDiff('${escHtml(commit.hash)}')">${hash}</span>
      &nbsp;·&nbsp;${escHtml(commit.author)}&nbsp;·&nbsp;${date}
    </div></div>`;
}

// --- コミット一覧 ---
async function renderCommits() {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const data = await apiFetch(repoParams({ action: 'commits' }));
    c.innerHTML = data.commits.length
      ? data.commits.map(renderCommitCard).join('')
      : '<div class="loading">コミットがありません</div>';
  } catch (e) {
    c.innerHTML = `<div class="error">Error: ${e.message}</div>`;
  }
}

// --- ファイルツリー ---
async function renderFiles(filePath = '') {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const data = await apiFetch(repoParams({ action: 'tree', f: filePath }));
    const breadcrumb = filePath
      ? `<div style="margin-bottom:12px;color:var(--muted);font-size:12px;">📁 ${escHtml(filePath)}</div>`
      : '';
    const back = filePath
      ? `<div class="file-item" onclick="renderFiles('${escHtml(filePath.split('/').slice(0,-1).join('/'))}')">
           <span>📁</span> ..</div>`
      : '';
    const items = data.files.map(f => {
      const icon = f.type === 'tree' ? '📁' : '📄';
      const onclick = f.type === 'tree'
        ? `renderFiles('${escHtml(f.path)}')`
        : currentVisibility === 'private'
          ? `alert('ファイル内容の表示は /gitweb/ では非対応（プライベートリポジトリ）')`
          : `window.open('/gitweb/?p=${encodeURIComponent(currentRepo)}&a=blob&f=${encodeURIComponent(f.path)}&hb=HEAD')`;
      return `<div class="file-item" onclick="${onclick}">
        <span>${icon}</span>${escHtml(f.name)}</div>`;
    }).join('');
    c.innerHTML = breadcrumb + '<div>' + back + items + '</div>';
  } catch (e) {
    c.innerHTML = `<div class="error">Error: ${e.message}</div>`;
  }
}

// --- diff ---
async function renderDiff(h = '') {
  const c = document.getElementById('content');
  if (!h) {
    c.innerHTML = '<div class="loading">コミットハッシュをクリックして差分を表示</div>';
    return;
  }
  c.innerHTML = '<div class="loading">Loading diff...</div>';
  try {
    const data = await apiFetch(repoParams({ action: 'diff', h }));
    const lines = data.diff.split('\n').map(line => {
      if (line.startsWith('+')) return `<span class="diff-add">${escHtml(line)}</span>`;
      if (line.startsWith('-')) return `<span class="diff-del">${escHtml(line)}</span>`;
      if (line.startsWith('@@')) return `<span class="diff-hunk">${escHtml(line)}</span>`;
      return escHtml(line);
    }).join('\n');
    c.innerHTML = `<pre class="diff">${lines}</pre>`;
  } catch (e) {
    c.innerHTML = `<div class="error">Error: ${e.message}</div>`;
  }
}

function loadDiff(hash) {
  showTab('diff');
  renderDiff(hash);
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// --- コードブロックのコピーボタン ---
function copyToClipboardFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '2em';
  textarea.style.height = '2em';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.boxShadow = 'none';
  textarea.style.background = 'transparent';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    const successful = document.execCommand('copy');
    if (!successful) throw new Error('Copy command failed');
  } catch (err) {
    console.error('Fallback copy failed:', err);
    throw err;
  } finally {
    document.body.removeChild(textarea);
  }
}

document.addEventListener('click', async (e) => {
  const button = e.target.closest('.copy-button');
  if (!button) return;
  const codeBlock = button.closest('.code-block');
  const codeElement = codeBlock.querySelector('code');
  const code = codeElement.textContent;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      copyToClipboardFallback(code);
    }
    const originalText = button.textContent;
    button.textContent = 'コピーしました！';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('copied');
    }, 2000);
  } catch (err) {
    console.error('コピーに失敗しました:', err);
    button.textContent = 'エラー';
    setTimeout(() => {
      button.classList.remove('copied');
      button.textContent = 'コピー';
    }, 2000);
  }
});

// 初期化
loadRepos();
