const { execFile } = require('child_process');
const path = require('path');

const PUBLIC_ROOT = '/var/lib/git/public';
const PRIVATE_ROOT = '/var/lib/git/private';

// git コマンドを Promise で実行
function gitExec(repoPath, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repoPath, ...args], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout);
    });
  });
}

// リポジトリパスを取得
function getRepoPath(repo, visibility, owner) {
  if (visibility === 'private') {
    return path.join(PRIVATE_ROOT, owner, repo);
  }
  return path.join(PUBLIC_ROOT, repo);
}

// README.md を取得（生のマークダウン文字列）
async function getReadme(repo, visibility, owner, branch) {
  const repoPath = getRepoPath(repo, visibility, owner);
  const ref = branch || 'HEAD';

  // 空リポジトリチェック
  if (await isEmptyRepo(repoPath)) {
    return { repo, readme: '', filename: '', empty: true };
  }

  const candidates = ['README.md', 'readme.md', 'Readme.md'];

  for (const name of candidates) {
    try {
      const content = await gitExec(repoPath, ['show', `${ref}:${name}`]);
      return { repo, readme: content, filename: name, empty: false };
    } catch (e) {
      continue;
    }
  }
  return { repo, readme: '', filename: '', empty: false };
}

// ブランチ一覧を取得
async function getBranches(repo, visibility, owner) {
  const repoPath = getRepoPath(repo, visibility, owner);

  if (isEmptyRepo(repoPath)) {
    return { repo, branches: [], current: '', empty: true };
  }

  // デフォルトブランチ名を取得
  let current = '';
  try {
    const out = await gitExec(repoPath, ['symbolic-ref', '--short', 'HEAD']);
    current = out.trim();
  } catch (e) {
    // detached HEAD の場合は空文字
  }

  // ブランチ一覧（最終コミット日順）
  let branches = [];
  try {
    const out = await gitExec(repoPath, [
      'for-each-ref', '--format=%(refname:short)', '--sort=-committerdate', 'refs/heads/'
    ]);
    branches = out.trim().split('\n').filter(Boolean);
  } catch (e) {
    branches = [];
  }

  return { repo, branches, current, empty: false };
}

// リポジトリが空（コミットなし）かチェック（ファイルシステムベース）
function isEmptyRepo(repoPath) {
  const fs = require('fs');
  // refs/heads/ にブランチファイルがあるかチェック
  const refsHeads = path.join(repoPath, 'refs', 'heads');
  try {
    const entries = fs.readdirSync(refsHeads);
    if (entries.length > 0) return false;
  } catch (e) {
    // refs/heads が存在しない場合は空とみなす
  }
  // packed-refs にブランチが含まれている場合もチェック
  const packedRefs = path.join(repoPath, 'packed-refs');
  try {
    const content = fs.readFileSync(packedRefs, 'utf8');
    return !content.includes('refs/heads/');
  } catch (e) {
    return true;
  }
}

// コミット一覧を取得
async function getCommits(repo, visibility, owner, branch) {
  const repoPath = getRepoPath(repo, visibility, owner);
  const ref = branch || 'HEAD';

  // 空リポジトリチェック
  if (await isEmptyRepo(repoPath)) {
    return { repo, commits: [], empty: true };
  }

  const stdout = await gitExec(repoPath, [
    'log', ref, '--pretty=format:%H\t%s\t%an\t%ae\t%aI', '-20'
  ]);

  const commits = [];
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length >= 5) {
      commits.push({
        hash: parts[0],
        title: parts[1],
        author: parts[2],
        email: parts[3],
        date: parts[4],
        url: ''
      });
    }
  }
  return { repo, commits, empty: false };
}

// diff を取得
async function getDiff(repo, h, visibility, owner) {
  const repoPath = getRepoPath(repo, visibility, owner);
  const stdout = await gitExec(repoPath, ['show', '--format=fuller', h]);
  return { repo, hash: h, diff: stdout };
}

// ファイルツリーを取得
async function getTree(repo, f, hb, visibility, owner) {
  const repoPath = getRepoPath(repo, visibility, owner);

  // 空リポジトリチェック
  if (await isEmptyRepo(repoPath)) {
    return { repo, path: f, files: [], empty: true };
  }

  const ref = f ? `${hb}:${f}` : `${hb}`;
  const stdout = await gitExec(repoPath, ['ls-tree', ref]);

  const files = [];
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length === 2) {
      const meta = parts[0];
      const name = parts[1];
      const ftype = meta.includes('tree') ? 'tree' : 'blob';
      const fpath = f ? `${f}/${name}` : name;
      files.push({ type: ftype, name, path: fpath });
    }
  }
  return { repo, path: f, files, empty: false };
}

// ファイル内容を取得（blob）
async function getBlob(repo, filePath, hb, visibility, owner) {
  const repoPath = getRepoPath(repo, visibility, owner);

  if (isEmptyRepo(repoPath)) {
    return { repo, path: filePath, content: '', empty: true };
  }

  const ref = `${hb}:${filePath}`;

  // サイズ確認（1MB上限）
  let size;
  try {
    const sizeOut = await gitExec(repoPath, ['cat-file', '-s', ref]);
    size = parseInt(sizeOut.trim(), 10);
  } catch (e) {
    return { repo, path: filePath, content: '', error: 'File not found' };
  }

  const MAX_SIZE = 1024 * 1024;
  if (size > MAX_SIZE) {
    return {
      repo, path: filePath, content: '', size, truncated: true,
      error: `ファイルが大きすぎます (${(size / 1024).toFixed(1)} KB)`
    };
  }

  try {
    const content = await gitExec(repoPath, ['show', ref]);
    // バイナリ判定: 先頭8000文字にnullバイトが含まれるか
    const isBinary = content.slice(0, 8000).includes('\0');
    if (isBinary) {
      return { repo, path: filePath, content: '', size, binary: true };
    }
    return { repo, path: filePath, content, size, binary: false };
  } catch (e) {
    return { repo, path: filePath, content: '', error: e.message };
  }
}

// リポジトリ一覧を取得
function getReposFromDir(dirpath, visibility) {
  const fs = require('fs');
  const repos = [];
  if (!fs.existsSync(dirpath)) return repos;

  for (const name of fs.readdirSync(dirpath).sort()) {
    const full = path.join(dirpath, name);
    if (name.endsWith('.git') && fs.statSync(full).isDirectory()) {
      let desc = '';
      try {
        desc = fs.readFileSync(path.join(full, 'description'), 'utf8').trim();
        if (desc.startsWith('Unnamed repository')) desc = '';
      } catch (e) {}
      let repoOwner = null;
      try {
        repoOwner = fs.readFileSync(path.join(full, 'owner'), 'utf8').trim();
      } catch (e) {}
      repos.push({ name, description: desc, visibility, owner: repoOwner });
    }
  }
  return repos;
}

function getPrivateReposForUser(username) {
  const userDir = path.join(PRIVATE_ROOT, username);
  const repos = getReposFromDir(userDir, 'private');
  for (const r of repos) r.owner = username;
  return repos;
}

function getRepos(username) {
  const repos = getReposFromDir(PUBLIC_ROOT, 'public');
  if (username) {
    repos.push(...getPrivateReposForUser(username));
  }
  const sharedRepos = username ? getSharedReposForUser(username) : [];
  return { repos, sharedRepos, username };
}

// リポジトリを新規作成（bareリポジトリ）
async function createRepo(repoName, visibility, owner, description) {
  // バリデーション: 英数字・ハイフン・アンダースコア・ドットのみ
  if (!repoName || !/^[a-zA-Z0-9._-]+$/.test(repoName)) {
    throw new Error('リポジトリ名は英数字・ハイフン・アンダースコア・ドットのみ使用できます');
  }

  // パストラバーサル防止
  if (repoName.includes('..') || repoName.includes('/') || repoName.includes('\\')) {
    throw new Error('不正なリポジトリ名です');
  }

  // .git サフィックス自動付与
  const dirName = repoName.endsWith('.git') ? repoName : repoName + '.git';

  // リポジトリパスを決定
  let repoPath;
  if (visibility === 'private') {
    if (!owner) throw new Error('プライベートリポジトリにはオーナーが必要です');
    const ownerDir = path.join(PRIVATE_ROOT, owner);
    // オーナーディレクトリがなければ作成
    const fs = require('fs');
    if (!fs.existsSync(ownerDir)) {
      fs.mkdirSync(ownerDir, { recursive: true });
    }
    repoPath = path.join(ownerDir, dirName);
  } else {
    repoPath = path.join(PUBLIC_ROOT, dirName);
  }

  // 同名リポジトリ存在チェック
  const fs = require('fs');
  if (fs.existsSync(repoPath)) {
    throw new Error(`リポジトリ "${repoName}" は既に存在します`);
  }

  // git init --bare で初期化
  await new Promise((resolve, reject) => {
    execFile('git', ['init', '--bare', repoPath], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout);
    });
  });

  // description ファイルに説明を書き込み
  if (description) {
    fs.writeFileSync(path.join(repoPath, 'description'), description, 'utf8');
  }

  // owner ファイルに作成者を記録
  if (owner) {
    fs.writeFileSync(path.join(repoPath, 'owner'), owner, 'utf8');
  }

  return {
    name: dirName,
    description: description || '',
    visibility,
    owner: owner || null
  };
}

// リポジトリを削除
function deleteRepo(repoName, visibility, owner) {
  const fs = require('fs');

  // バリデーション
  if (!repoName || !/^[a-zA-Z0-9._-]+$/.test(repoName)) {
    throw new Error('不正なリポジトリ名です');
  }
  if (repoName.includes('..') || repoName.includes('/') || repoName.includes('\\')) {
    throw new Error('不正なリポジトリ名です');
  }

  const repoPath = getRepoPath(repoName, visibility, owner);

  // 存在確認
  if (!fs.existsSync(repoPath)) {
    throw new Error(`リポジトリ "${repoName}" が見つかりません`);
  }

  // ownerファイルを読み取り
  let repoOwner = null;
  try {
    repoOwner = fs.readFileSync(path.join(repoPath, 'owner'), 'utf8').trim();
  } catch (e) {}

  // 削除実行
  fs.rmSync(repoPath, { recursive: true, force: true });

  return { name: repoName, deleted: true };
}

// リポジトリの可視性を変更（ディレクトリを移動）
function changeVisibility(repoName, currentVisibility, owner, newVisibility) {
  const fs = require('fs');

  // バリデーション
  if (!repoName || !/^[a-zA-Z0-9._-]+$/.test(repoName)) {
    throw new Error('不正なリポジトリ名です');
  }
  if (repoName.includes('..') || repoName.includes('/') || repoName.includes('\\')) {
    throw new Error('不正なリポジトリ名です');
  }
  if (currentVisibility === newVisibility) {
    throw new Error('既に同じ可視性です');
  }
  if (!owner) {
    throw new Error('オーナー情報が必要です');
  }

  const srcPath = getRepoPath(repoName, currentVisibility, owner);
  const dstPath = getRepoPath(repoName, newVisibility, owner);

  // 移動元の存在確認
  if (!fs.existsSync(srcPath)) {
    throw new Error(`リポジトリ "${repoName}" が見つかりません`);
  }

  // 移動先の重複チェック
  if (fs.existsSync(dstPath)) {
    throw new Error(`移動先に同名のリポジトリ "${repoName}" が既に存在します`);
  }

  // privateに変更する場合、オーナーディレクトリを作成
  if (newVisibility === 'private') {
    const ownerDir = path.join(PRIVATE_ROOT, owner);
    if (!fs.existsSync(ownerDir)) {
      fs.mkdirSync(ownerDir, { recursive: true });
    }
  }

  // ディレクトリを移動
  fs.renameSync(srcPath, dstPath);

  return {
    name: repoName,
    visibility: newVisibility,
    owner
  };
}

// リポジトリの共有ユーザー一覧を取得
function getRepoShared(repoName, visibility, owner) {
  const fs = require('fs');
  const repoPath = getRepoPath(repoName, visibility, owner);
  try {
    const content = fs.readFileSync(path.join(repoPath, 'shared'), 'utf8');
    return content.trim().split('\n').map(u => u.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// リポジトリの共有ユーザー一覧を更新（空配列でファイル削除）
function setRepoShared(repoName, visibility, owner, sharedUsers) {
  const fs = require('fs');
  const repoPath = getRepoPath(repoName, visibility, owner);
  if (!fs.existsSync(repoPath)) {
    throw new Error(`リポジトリ "${repoName}" が見つかりません`);
  }
  const users = sharedUsers.map(u => u.trim()).filter(Boolean);
  const sharedPath = path.join(repoPath, 'shared');
  if (users.length > 0) {
    fs.writeFileSync(sharedPath, users.join('\n') + '\n', 'utf8');
  } else {
    try { fs.unlinkSync(sharedPath); } catch (e) {}
  }
  return { name: repoName, sharedWith: users };
}

// 指定ユーザーと共有されているリポジトリを全走査して返す
function getSharedReposForUser(username) {
  const fs = require('fs');
  const repos = [];

  function checkDir(dirpath, visibility, ownerName) {
    if (!fs.existsSync(dirpath)) return;
    for (const name of fs.readdirSync(dirpath).sort()) {
      if (!name.endsWith('.git')) continue;
      const full = path.join(dirpath, name);
      if (!fs.statSync(full).isDirectory()) continue;
      try {
        const content = fs.readFileSync(path.join(full, 'shared'), 'utf8');
        const users = content.trim().split('\n').map(u => u.trim()).filter(Boolean);
        if (!users.includes(username)) continue;
      } catch (e) {
        continue;
      }
      // ownerが自分自身のリポジトリはSHAREDに含めない
      const repoOwner = ownerName || (() => {
        try { return fs.readFileSync(path.join(full, 'owner'), 'utf8').trim(); } catch (e) { return null; }
      })();
      if (repoOwner === username) continue;
      let desc = '';
      try {
        desc = fs.readFileSync(path.join(full, 'description'), 'utf8').trim();
        if (desc.startsWith('Unnamed repository')) desc = '';
      } catch (e) {}
      repos.push({ name, description: desc, visibility, owner: repoOwner });
    }
  }

  // パブリックリポジトリを走査
  checkDir(PUBLIC_ROOT, 'public', null);

  // 全プライベートユーザーのリポジトリを走査
  if (fs.existsSync(PRIVATE_ROOT)) {
    for (const ownerDir of fs.readdirSync(PRIVATE_ROOT).sort()) {
      const ownerPath = path.join(PRIVATE_ROOT, ownerDir);
      if (!fs.statSync(ownerPath).isDirectory()) continue;
      checkDir(ownerPath, 'private', ownerDir);
    }
  }

  return repos;
}

// リポジトリのownerを取得
function getRepoOwner(repoName, visibility, owner) {
  const fs = require('fs');
  const repoPath = getRepoPath(repoName, visibility, owner);
  try {
    return fs.readFileSync(path.join(repoPath, 'owner'), 'utf8').trim();
  } catch (e) {
    return null;
  }
}

// ユーザーが所有する全リポジトリの共有情報をまとめて返す
function getUserReposWithSharing(username) {
  const repos = [];

  // パブリックリポジトリのうちオーナーが自分のもの
  const publicRepos = getReposFromDir(PUBLIC_ROOT, 'public');
  for (const repo of publicRepos) {
    if (repo.owner === username) {
      const sharedWith = getRepoShared(repo.name, 'public', username);
      repos.push({ ...repo, sharedWith });
    }
  }

  // プライベートリポジトリ
  const privateRepos = getPrivateReposForUser(username);
  for (const repo of privateRepos) {
    const sharedWith = getRepoShared(repo.name, 'private', username);
    repos.push({ ...repo, sharedWith });
  }

  return { repos, username };
}

module.exports = {
  getReadme,
  getCommits,
  getDiff,
  getTree,
  getBlob,
  getRepos,
  getBranches,
  createRepo,
  deleteRepo,
  getRepoOwner,
  changeVisibility,
  getRepoShared,
  setRepoShared,
  getSharedReposForUser,
  getUserReposWithSharing,
  PUBLIC_ROOT,
  PRIVATE_ROOT
};
