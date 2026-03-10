const { execFile } = require('child_process');

const HTPASSWD_FILE = '/etc/httpd/.htpasswd';

// htpasswd -v でBasic認証を検証
function verifyHtpasswd(username, password) {
  return new Promise((resolve) => {
    execFile('htpasswd', ['-v', '-b', HTPASSWD_FILE, username, password],
      { timeout: 5000 },
      (err) => resolve(!err)
    );
  });
}

// Authorization ヘッダーからユーザーを取得・検証
async function getCurrentUser(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Basic ')) return null;

  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const [username, ...rest] = decoded.split(':');
    const password = rest.join(':');
    if (await verifyHtpasswd(username, password)) {
      return username;
    }
  } catch (e) {}
  return null;
}

module.exports = { getCurrentUser };
