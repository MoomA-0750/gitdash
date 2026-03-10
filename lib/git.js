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
async function getReadme(repo, visibility, owner) {
  const repoPath = getRepoPath(repo, visibility, owner);
  const candidates = ['README.md', 'readme.md', 'Readme.md'];

  for (const name of candidates) {
    try {
      const content = await gitExec(repoPath, ['show', `HEAD:${name}`]);
      return { repo, readme: content, filename: name };
    } catch (e) {
      // ファイルが存在しない場合は次の候補を試す
      continue;
    }
  }
  return { repo, readme: '', filename: '' };
}

// コミット一覧を取得
async function getCommits(repo, visibility, owner) {
  const repoPath = getRepoPath(repo, visibility, owner);
  const stdout = await gitExec(repoPath, [
    'log', '--pretty=format:%H\t%s\t%an\t%ae\t%aI', '-20'
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
  return { repo, commits };
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
  return { repo, path: f, files };
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
      repos.push({ name, description: desc, visibility, owner: null });
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
  return { repos, username };
}

module.exports = {
  getReadme,
  getCommits,
  getDiff,
  getTree,
  getRepos,
  PUBLIC_ROOT,
  PRIVATE_ROOT
};
