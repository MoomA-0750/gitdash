const API = (window.BASE_PATH || '') + '/api';
let currentRepo = null;
let currentVisibility = 'public';
let currentOwner = null;
let currentTab = 'dashboard';
let currentFilePath = '';
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

// --- API POST ヘルパー ---
async function apiPost(action, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (authHeader) headers['Authorization'] = authHeader;
  const res = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
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
  const createBtn = document.getElementById('btn-create-repo');
  if (currentUsername) {
    bar.innerHTML = `
      <span class="username">👤 ${escHtml(currentUsername)}</span>
      <button class="btn-logout" onclick="doLogout()">ログアウト</button>`;
    if (createBtn) createBtn.style.display = 'flex';
  } else {
    bar.innerHTML = `
      <span id="user-label">未ログイン</span>
      <button class="btn-login" onclick="showLogin()">ログイン</button>`;
    if (createBtn) createBtn.style.display = 'none';
  }
}

// --- リポジトリ作成モーダル ---
function showCreateRepo() {
  if (!currentUsername) {
    showLogin();
    return;
  }
  document.getElementById('create-repo-modal').classList.add('show');
  document.getElementById('create-repo-name').focus();
}

function closeCreateRepo() {
  document.getElementById('create-repo-modal').classList.remove('show');
  document.getElementById('create-repo-error').style.display = 'none';
  document.getElementById('create-repo-name').value = '';
  document.getElementById('create-repo-desc').value = '';
  document.querySelector('input[name="create-repo-vis"][value="public"]').checked = true;
}

async function doCreateRepo() {
  const repoName = document.getElementById('create-repo-name').value.trim();
  const description = document.getElementById('create-repo-desc').value.trim();
  const visibility = document.querySelector('input[name="create-repo-vis"]:checked').value;
  const errEl = document.getElementById('create-repo-error');

  if (!repoName) {
    errEl.textContent = 'リポジトリ名を入力してください';
    errEl.style.display = 'block';
    return;
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(repoName)) {
    errEl.textContent = '英数字・ハイフン・アンダースコア・ドットのみ使用できます';
    errEl.style.display = 'block';
    return;
  }

  try {
    await apiPost('create_repo', { repoName, visibility, description });
    closeCreateRepo();
    await loadRepos();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

// --- リポジトリ削除 ---
async function deleteRepo() {
  const repoLabel = currentRepo.replace('.git', '');
  const input = prompt(`リポジトリ「${repoLabel}」を削除します。\n確認のためリポジトリ名を入力してください:`);
  if (input === null) return; // キャンセル
  if (input.trim() !== repoLabel) {
    alert('リポジトリ名が一致しません。削除をキャンセルしました。');
    return;
  }
  try {
    await apiPost('delete_repo', {
      repoName: currentRepo,
      visibility: currentVisibility,
      owner: currentOwner
    });
    currentRepo = null;
    currentOwner = null;
    currentVisibility = 'public';
    document.getElementById('content').innerHTML =
      '<div class="loading">リポジトリを選択してください</div>';
    await loadRepos();
  } catch (e) {
    alert(`削除に失敗しました: ${e.message}`);
  }
}

// --- リポジトリ可視性変更 ---
async function changeVisibility() {
  const newVis = currentVisibility === 'public' ? 'private' : 'public';
  const repoLabel = currentRepo.replace('.git', '');
  const msg = currentVisibility === 'public'
    ? `リポジトリ「${repoLabel}」を private に変更します。\n他のユーザーからアクセスできなくなります。よろしいですか？`
    : `リポジトリ「${repoLabel}」を public に変更します。\n全てのユーザーがアクセスできるようになります。よろしいですか？`;
  if (!confirm(msg)) return;
  try {
    await apiPost('change_visibility', {
      repoName: currentRepo,
      visibility: currentVisibility,
      owner: currentOwner,
      newVisibility: newVis
    });
    currentVisibility = newVis;
    await loadRepos();
    renderDashboard();
  } catch (e) {
    alert(`可視性の変更に失敗しました: ${e.message}`);
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
    const visLabel = currentVisibility === 'private'
      ? '<span class="badge badge-private">private</span>'
      : '<span class="badge badge-public">public</span>';
    const ownerLabel = currentOwner
      ? `<span class="repo-owner">by ${escHtml(currentOwner)}</span>`
      : '';
    const cloneUrl = getCloneUrl();

    // 空リポジトリの場合
    if (data.empty) {
      c.innerHTML = `
        <div class="repo-title">
          <h2>${escHtml(currentRepo.replace('.git',''))}</h2>${visLabel}${ownerLabel}
          ${currentUsername && currentUsername === currentOwner
            ? `<button class="btn-change-visibility" onclick="changeVisibility()">${currentVisibility === 'public' ? 'privateに変更' : 'publicに変更'}</button>
               <button class="btn-delete-repo" onclick="deleteRepo()">リポジトリを削除</button>`
            : ''}
        </div>
        <div class="clone-url-box">
          <span class="clone-label">Clone:</span>
          <code>${escHtml(cloneUrl)}</code>
          <button class="btn-copy" onclick="copyCloneUrl(this)">Copy</button>
        </div>
        <div class="empty-repo-guide">
          <h3>📭 空のリポジトリです</h3>
          <p>このリポジトリにはまだコミットがありません。<br>以下の手順で最初のコミットを追加してください。</p>
          <div class="code-guide">
            <h4>新規プロジェクトを開始する場合</h4>
            <pre>git clone ${escHtml(cloneUrl)}
cd ${escHtml(currentRepo.replace('.git',''))}
echo "# ${escHtml(currentRepo.replace('.git',''))}" &gt; README.md
git add README.md
git commit -m "Initial commit"
git push origin main</pre>
          </div>
          <div class="code-guide">
            <h4>既存のプロジェクトをプッシュする場合</h4>
            <pre>cd your-project
git remote add origin ${escHtml(cloneUrl)}
git push -u origin main</pre>
          </div>
        </div>`;
      return;
    }

    const latest = data.commits[0] || {};
    // readmeHtml はサーバーサイドで変換済み
    const readmeHtml = readmeData.readmeHtml
      ? `<div class="readme-box">
          <div class="readme-header">📄 ${escHtml(readmeData.filename)}</div>
          <div class="readme-body">${readmeData.readmeHtml}</div>
         </div>`
      : '';
    c.innerHTML = `
      <div class="repo-title">
        <h2>${escHtml(currentRepo.replace('.git',''))}</h2>${visLabel}${ownerLabel}
        ${currentUsername && currentUsername === currentOwner
          ? `<button class="btn-change-visibility" onclick="changeVisibility()">${currentVisibility === 'public' ? 'privateに変更' : 'publicに変更'}</button>
             <button class="btn-delete-repo" onclick="deleteRepo()">リポジトリを削除</button>`
          : ''}
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
    if (data.empty) {
      c.innerHTML = '<div class="loading">空のリポジトリです — まだコミットがありません</div>';
    } else {
      c.innerHTML = data.commits.length
        ? data.commits.map(renderCommitCard).join('')
        : '<div class="loading">コミットがありません</div>';
    }
  } catch (e) {
    c.innerHTML = `<div class="error">Error: ${e.message}</div>`;
  }
}

// --- ファイルビューア（2カラム） ---
async function renderFiles() {
  const c = document.getElementById('content');
  currentFilePath = '';

  c.innerHTML = `
    <div class="file-viewer-container">
      <div class="file-tree-panel" id="file-tree-panel">
        <div class="file-tree-header">Files</div>
        <div class="file-tree-content" id="file-tree-content">
          <div class="loading" style="padding:12px;">Loading...</div>
        </div>
      </div>
      <div class="file-content-panel" id="file-content-panel">
        <div class="file-content-placeholder">
          <span>ファイルを選択してください</span>
        </div>
      </div>
    </div>`;

  await loadFileTree('');
}

async function loadFileTree(filePath) {
  const treeContent = document.getElementById('file-tree-content');
  if (!treeContent) return;
  treeContent.innerHTML = '<div class="loading" style="padding:12px;">Loading...</div>';

  try {
    const data = await apiFetch(repoParams({ action: 'tree', f: filePath }));
    if (data.empty) {
      treeContent.innerHTML = '<div class="loading" style="padding:12px;">空のリポジトリです</div>';
      return;
    }

    const breadcrumb = filePath
      ? `<div class="file-tree-breadcrumb">📁 ${escHtml(filePath)}</div>`
      : '';

    const back = filePath
      ? `<div class="file-item" onclick="loadFileTree('${escHtml(filePath.split('/').slice(0,-1).join('/'))}')">
           <span>📁</span> ..</div>`
      : '';

    const items = data.files.map(f => {
      const icon = f.type === 'tree' ? '📁' : '📄';
      const onclick = f.type === 'tree'
        ? `loadFileTree('${escHtml(f.path)}')`
        : `loadFileContent('${escHtml(f.path)}')`;
      const activeClass = (f.type !== 'tree' && f.path === currentFilePath) ? ' file-item-active' : '';
      return `<div class="file-item${activeClass}" onclick="${onclick}">
        <span>${icon}</span>${escHtml(f.name)}</div>`;
    }).join('');

    treeContent.innerHTML = breadcrumb + back + items;
  } catch (e) {
    treeContent.innerHTML = `<div class="error" style="padding:12px;">Error: ${e.message}</div>`;
  }
}

async function loadFileContent(filePath) {
  currentFilePath = filePath;
  const contentPanel = document.getElementById('file-content-panel');
  if (!contentPanel) return;
  contentPanel.innerHTML = '<div class="loading">Loading...</div>';

  // 選択中ファイルをハイライト
  document.querySelectorAll('#file-tree-content .file-item').forEach(item => {
    item.classList.toggle('file-item-active',
      item.textContent.trim().replace(/^[📁📄]\s*/, '') === filePath.split('/').pop());
  });

  try {
    const data = await apiFetch(repoParams({ action: 'blob', f: filePath, hb: 'HEAD' }));
    const fileName = filePath.split('/').pop();

    // サイズ表示
    const sizeLabel = data.size
      ? (data.size > 1024 ? `${(data.size / 1024).toFixed(1)} KB` : `${data.size} B`)
      : '';

    const headerHtml = `
      <div class="file-content-header">
        <div class="file-content-filename">📄 ${escHtml(fileName)}</div>
        <div class="file-content-meta">
          <span class="file-content-size">${sizeLabel}</span>
          ${!data.binary && !data.error && !data.truncated && data.content
            ? '<button class="btn-copy file-copy-btn" onclick="copyFileContent(this)">Copy</button>'
            : ''}
        </div>
      </div>`;

    if (data.error) {
      contentPanel.innerHTML = headerHtml +
        `<div class="file-content-body"><div class="error" style="margin:16px;">${escHtml(data.error)}</div></div>`;
    } else if (data.binary) {
      contentPanel.innerHTML = headerHtml +
        `<div class="file-content-body">
          <div class="file-binary-message">バイナリファイルは表示できません (${sizeLabel})</div>
        </div>`;
    } else if (data.truncated) {
      contentPanel.innerHTML = headerHtml +
        `<div class="file-content-body">
          <div class="file-binary-message">ファイルが大きすぎます (${sizeLabel})</div>
        </div>`;
    } else if (data.renderMode === 'markdown') {
      contentPanel.innerHTML = headerHtml +
        `<div class="file-content-body">
          <div class="readme-body" style="padding:20px 24px;">${data.contentHtml}</div>
        </div>`;
      contentPanel.dataset.rawContent = data.content;
    } else {
      // コード表示（行番号付き）
      const lines = data.content.split('\n');
      const lineNums = lines.map((_, i) =>
        `<span class="line-number">${i + 1}</span>`
      ).join('\n');

      const codeHtml = data.highlightedHtml || escHtml(data.content);

      contentPanel.innerHTML = headerHtml +
        `<div class="file-content-body">
          <div class="code-viewer">
            <div class="line-numbers">${lineNums}</div>
            <pre class="code-content"><code>${codeHtml}</code></pre>
          </div>
        </div>`;
      contentPanel.dataset.rawContent = data.content;
    }
  } catch (e) {
    contentPanel.innerHTML =
      `<div class="file-content-body"><div class="error" style="margin:16px;">Error: ${e.message}</div></div>`;
  }
}

function copyFileContent(btn) {
  const panel = document.getElementById('file-content-panel');
  const rawContent = panel.dataset.rawContent || '';
  const codeEl = panel.querySelector('.code-content code');
  const text = rawContent || (codeEl ? codeEl.textContent : '');

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      copyToClipboardFallback(text);
    }
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  } catch (err) {
    btn.textContent = 'Error';
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  }
}

// --- diff (side-by-side) ---

// unified diff をファイル単位に分割
function parseDiffFiles(diffText) {
  const lines = diffText.split('\n');
  // コミットヘッダー（diff --git より前）を分離
  let headerEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('diff --git ')) { headerEnd = i; break; }
    if (i === lines.length - 1) headerEnd = lines.length;
  }
  const commitHeader = lines.slice(0, headerEnd).join('\n');

  // ファイル単位に分割
  const files = [];
  let current = null;
  for (let i = headerEnd; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      // ファイル名を抽出（diff --git a/path b/path）
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      const fileName = m ? m[2] : line;
      current = { fileName, meta: [line], hunks: [] };
    } else if (current && line.startsWith('@@')) {
      // hunkヘッダーをパース: @@ -oldStart,oldLen +newStart,newLen @@
      const hm = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      const oldStart = hm ? parseInt(hm[1]) : 1;
      const newStart = hm ? parseInt(hm[3]) : 1;
      current.hunks.push({ header: line, oldStart, newStart, lines: [] });
    } else if (current && current.hunks.length > 0) {
      current.hunks[current.hunks.length - 1].lines.push(line);
    } else if (current) {
      current.meta.push(line);
    }
  }
  if (current) files.push(current);
  return { commitHeader, files };
}

// hunkリストからside-by-side HTMLテーブル行を生成
function buildSideBySide(hunks) {
  let rows = '';
  for (const hunk of hunks) {
    // hunkヘッダー行
    rows += `<tr class="diff-line-hunk">
      <td class="diff-line-num"></td><td class="diff-line-content" colspan="1">${escHtml(hunk.header)}</td>
      <td class="diff-line-num"></td><td class="diff-line-content" colspan="1">${escHtml(hunk.header)}</td>
    </tr>`;

    let oldNum = hunk.oldStart;
    let newNum = hunk.newStart;

    // 行をグループに分けて処理（-と+の連続をペアリング）
    const hLines = hunk.lines;
    let i = 0;
    while (i < hLines.length) {
      const line = hLines[i];
      if (line.startsWith('-')) {
        // 連続する - を収集
        const dels = [];
        while (i < hLines.length && hLines[i].startsWith('-')) {
          dels.push(hLines[i].substring(1));
          i++;
        }
        // 直後の連続する + を収集
        const adds = [];
        while (i < hLines.length && hLines[i].startsWith('+')) {
          adds.push(hLines[i].substring(1));
          i++;
        }
        // ペアリング
        const maxLen = Math.max(dels.length, adds.length);
        for (let j = 0; j < maxLen; j++) {
          const hasDel = j < dels.length;
          const hasAdd = j < adds.length;
          rows += `<tr>
            <td class="diff-line-num ${hasDel ? 'diff-num-del' : ''}">${hasDel ? oldNum++ : ''}</td>
            <td class="diff-line-content ${hasDel ? 'diff-line-del' : ''}">${hasDel ? escHtml(dels[j]) : ''}</td>
            <td class="diff-line-num ${hasAdd ? 'diff-num-add' : ''}">${hasAdd ? newNum++ : ''}</td>
            <td class="diff-line-content ${hasAdd ? 'diff-line-add' : ''}">${hasAdd ? escHtml(adds[j]) : ''}</td>
          </tr>`;
        }
      } else if (line.startsWith('+')) {
        // 単独の + 行（前に - がないケース）
        rows += `<tr>
          <td class="diff-line-num"></td>
          <td class="diff-line-content"></td>
          <td class="diff-line-num diff-num-add">${newNum++}</td>
          <td class="diff-line-content diff-line-add">${escHtml(line.substring(1))}</td>
        </tr>`;
        i++;
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file" 等
        i++;
      } else {
        // コンテキスト行（スペース先頭 or 空行）
        const content = line.startsWith(' ') ? line.substring(1) : line;
        rows += `<tr>
          <td class="diff-line-num">${oldNum++}</td>
          <td class="diff-line-content">${escHtml(content)}</td>
          <td class="diff-line-num">${newNum++}</td>
          <td class="diff-line-content">${escHtml(content)}</td>
        </tr>`;
        i++;
      }
    }
  }
  return rows;
}

// diff ファイルセクションの折りたたみ
function toggleDiffFile(el) {
  const body = el.nextElementSibling;
  const arrow = el.querySelector('.diff-arrow');
  if (body.style.display === 'none') {
    body.style.display = '';
    arrow.textContent = '▼';
  } else {
    body.style.display = 'none';
    arrow.textContent = '▶';
  }
}

// コミットヘッダーをパースして構造化HTMLに変換
function parseCommitHeader(headerText) {
  const lines = headerText.split('\n');
  const info = { hash: '', author: '', authorDate: '', committer: '', commitDate: '', message: [] };
  let inMessage = false;

  for (const line of lines) {
    if (line.startsWith('commit ')) {
      info.hash = line.replace('commit ', '').trim();
    } else if (line.startsWith('Author:')) {
      info.author = line.replace('Author:', '').trim();
    } else if (line.startsWith('AuthorDate:')) {
      info.authorDate = line.replace('AuthorDate:', '').trim();
    } else if (line.startsWith('Commit:')) {
      info.committer = line.replace('Commit:', '').trim();
    } else if (line.startsWith('CommitDate:')) {
      info.commitDate = line.replace('CommitDate:', '').trim();
      inMessage = true;
    } else if (inMessage) {
      // コミットメッセージ行（先頭スペースを除去）
      info.message.push(line.replace(/^    /, ''));
    }
  }

  // メッセージの前後の空行をトリム
  while (info.message.length && !info.message[0].trim()) info.message.shift();
  while (info.message.length && !info.message[info.message.length - 1].trim()) info.message.pop();

  const title = info.message[0] || '';
  const body = info.message.slice(1).join('\n').trim();
  const shortHash = info.hash.substring(0, 10);

  // 日付を整形
  const dateStr = info.authorDate ? new Date(info.authorDate).toLocaleString('ja-JP') : info.authorDate;

  let html = `<div class="diff-commit-card">
    <div class="diff-commit-title">${escHtml(title)}</div>`;
  if (body) {
    html += `<pre class="diff-commit-body">${escHtml(body)}</pre>`;
  }
  html += `<div class="diff-commit-meta">
      <span class="diff-commit-hash">${escHtml(shortHash)}</span>
      <span class="diff-commit-author">${escHtml(info.author)}</span>
      <span class="diff-commit-date">${escHtml(dateStr)}</span>
    </div>
  </div>`;
  return html;
}

async function renderDiff(h = '') {
  const c = document.getElementById('content');
  if (!h) {
    c.innerHTML = '<div class="loading">コミットハッシュをクリックして差分を表示</div>';
    return;
  }
  c.innerHTML = '<div class="loading">Loading diff...</div>';
  try {
    const data = await apiFetch(repoParams({ action: 'diff', h }));
    const { commitHeader, files } = parseDiffFiles(data.diff);

    let html = `<div class="diff-container">`;

    // コミットヘッダーを構造化表示
    if (commitHeader.trim()) {
      html += parseCommitHeader(commitHeader);
    }

    // 変更ファイル数サマリー
    if (files.length > 0) {
      html += `<div class="diff-summary">${files.length} files changed</div>`;
    }

    // ファイル別 side-by-side diff
    for (const file of files) {
      const rows = buildSideBySide(file.hunks);
      html += `
        <div class="diff-file">
          <div class="diff-file-header" onclick="toggleDiffFile(this)">
            <span class="diff-arrow">▼</span>
            <span class="diff-file-name">${escHtml(file.fileName)}</span>
          </div>
          <div class="diff-file-body">
            <table class="diff-table"><tbody>${rows}</tbody></table>
          </div>
        </div>`;
    }

    html += `</div>`;
    c.innerHTML = html;
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
