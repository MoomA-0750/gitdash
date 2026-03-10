#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import subprocess
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import re
import base64

GITWEB_URL = 'http://localhost/gitweb/gitweb.cgi'
HTPASSWD_FILE = '/etc/httpd/.htpasswd'
PUBLIC_ROOT = '/var/lib/git/public'
PRIVATE_ROOT = '/var/lib/git/private'

def send_json(data, status=200):
    print('Content-Type: application/json; charset=utf-8')
    print('Access-Control-Allow-Origin: *')
    print(f'Status: {status} OK')
    print()
    print(json.dumps(data, ensure_ascii=False, indent=2))

def verify_htpasswd(username, password):
    """htpasswd -v コマンドで認証"""
    try:
        result = subprocess.run(
            ['htpasswd', '-v', '-b', HTPASSWD_FILE, username, password],
            capture_output=True, text=True, timeout=5
        )
        return result.returncode == 0
    except Exception:
        return False

def get_current_user():
    """Authorization ヘッダーからユーザー名を取得・検証"""
    auth = os.environ.get('HTTP_AUTHORIZATION', '')
    if not auth.startswith('Basic '):
        return None
    try:
        decoded = base64.b64decode(auth[6:]).decode('utf-8')
        username, password = decoded.split(':', 1)
        if verify_htpasswd(username, password):
            return username
    except Exception:
        pass
    return None

def fetch_gitweb(params):
    filtered = {k: v for k, v in params.items() if v != ''}
    url = GITWEB_URL + '?' + urllib.parse.urlencode(filtered)
    with urllib.request.urlopen(url, timeout=10) as r:
        return r.read().decode('utf-8')

def get_repos_from_dir(dirpath, visibility):
    repos = []
    if not os.path.isdir(dirpath):
        return repos
    for name in sorted(os.listdir(dirpath)):
        full = os.path.join(dirpath, name)
        if name.endswith('.git') and os.path.isdir(full):
            desc = ''
            try:
                with open(os.path.join(full, 'description')) as f:
                    desc = f.read().strip()
                if desc.startswith('Unnamed repository'):
                    desc = ''
            except Exception:
                pass
            repos.append({
                'name': name,
                'description': desc,
                'visibility': visibility,
                'owner': None
            })
    return repos

def get_private_repos_for_user(username):
    user_dir = os.path.join(PRIVATE_ROOT, username)
    repos = get_repos_from_dir(user_dir, 'private')
    for r in repos:
        r['owner'] = username
    return repos

def get_repos():
    username = get_current_user()
    repos = get_repos_from_dir(PUBLIC_ROOT, 'public')
    if username:
        repos += get_private_repos_for_user(username)
    return {'repos': repos, 'username': username}

def get_commits(repo, visibility, owner):
    if visibility == 'private':
        repo_path = os.path.join(PRIVATE_ROOT, owner, repo)
        result = subprocess.run(
            ['git', '-C', repo_path, 'log',
             '--pretty=format:%H\t%s\t%an\t%ae\t%aI', '-20'],
            capture_output=True, text=True
        )
        commits = []
        for line in result.stdout.strip().split('\n'):
            if not line:
                continue
            parts = line.split('\t')
            if len(parts) >= 5:
                commits.append({
                    'hash': parts[0], 'title': parts[1],
                    'author': parts[2], 'email': parts[3],
                    'date': parts[4], 'url': ''
                })
        return {'repo': repo, 'commits': commits}
    else:
        xml_text = fetch_gitweb({'p': repo, 'a': 'atom'})
        root = ET.fromstring(xml_text)
        ns = {'atom': 'http://www.w3.org/2005/Atom'}
        commits = []
        for entry in root.findall('atom:entry', ns):
            title  = entry.findtext('atom:title',   default='', namespaces=ns)
            author = entry.find('atom:author', ns)
            name   = author.findtext('atom:name',  default='', namespaces=ns) if author is not None else ''
            email  = author.findtext('atom:email', default='', namespaces=ns) if author is not None else ''
            date   = entry.findtext('atom:updated', default='', namespaces=ns)
            link   = entry.find('atom:link', ns)
            href   = link.get('href', '') if link is not None else ''
            h      = href.split('h=')[-1].split(';')[0] if 'h=' in href else ''
            commits.append({
                'hash': h, 'title': title,
                'author': name, 'email': email,
                'date': date, 'url': href
            })
        return {'repo': repo, 'commits': commits}

def get_diff(repo, h, visibility, owner):
    if visibility == 'private':
        repo_path = os.path.join(PRIVATE_ROOT, owner, repo)
        result = subprocess.run(
            ['git', '-C', repo_path, 'show', '--format=fuller', h],
            capture_output=True, text=True
        )
        return {'repo': repo, 'hash': h, 'diff': result.stdout}
    else:
        text = fetch_gitweb({'p': repo, 'a': 'commitdiff_plain', 'h': h})
        return {'repo': repo, 'hash': h, 'diff': text}

def get_tree(repo, f='', hb='HEAD', visibility='public', owner=None):
    if visibility == 'private':
        repo_path = os.path.join(PRIVATE_ROOT, owner, repo)
        result = subprocess.run(
            ['git', '-C', repo_path, 'ls-tree', f'{hb}:{f}'],
            capture_output=True, text=True
        )
        files = []
        for line in result.stdout.strip().split('\n'):
            if not line:
                continue
            parts = line.split('\t')
            if len(parts) == 2:
                meta, name = parts
                ftype = 'tree' if 'tree' in meta else 'blob'
                fpath = f'{f}/{name}'.lstrip('/') if f else name
                files.append({'type': ftype, 'name': name, 'path': fpath})
        return {'repo': repo, 'path': f, 'files': files}
    else:
        params = {'p': repo, 'a': 'tree', 'hb': hb}
        if f:
            params['f'] = f
        html = fetch_gitweb(params)
        files = []
        seen = set()
        for td in re.findall(r'<td class="list">(.*?)</td>', html, re.DOTALL):
            m = re.search(r'a=blob(?:_plain)?[^"]*?;f=([^";]+)[^"]*?"[^>]*>([^<]+)</a>', td)
            if m:
                path, name = m.group(1), m.group(2).strip()
                if path not in seen:
                    seen.add(path)
                    files.append({'type': 'blob', 'name': name, 'path': path})
                continue
            m = re.search(r'a=tree[^"]*?;f=([^";]+)[^"]*?"[^>]*>([^<]+)</a>', td)
            if m:
                path, name = m.group(1), m.group(2).strip()
                if path not in seen and name != '..':
                    seen.add(path)
                    files.append({'type': 'tree', 'name': name, 'path': path})
        return {'repo': repo, 'path': f, 'files': files}

def get_readme(repo, visibility, owner):
    """リポジトリのREADME.mdを取得"""
    if visibility == 'private':
        repo_path = os.path.join(PRIVATE_ROOT, owner, repo)
    else:
        repo_path = os.path.join(PUBLIC_ROOT, repo)
    # README候補ファイル名
    for name in ['README.md', 'readme.md', 'Readme.md']:
        result = subprocess.run(
            ['git', '-C', repo_path, 'show', f'HEAD:{name}'],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            return {'repo': repo, 'readme': result.stdout, 'filename': name}
    return {'repo': repo, 'readme': '', 'filename': ''}

def main():
    qs = os.environ.get('QUERY_STRING', '')
    params = urllib.parse.parse_qs(qs)
    action     = params.get('action',     [''])[0]
    repo       = params.get('repo',       [''])[0]
    h          = params.get('h',          [''])[0]
    f          = params.get('f',          [''])[0]
    hb         = params.get('hb',         ['HEAD'])[0]
    visibility = params.get('visibility', ['public'])[0]
    owner      = params.get('owner',      [''])[0]

    if visibility == 'private':
        username = get_current_user()
        if not username:
            send_json({'error': 'Unauthorized'}, 401)
            return
        if username != owner:
            send_json({'error': 'Forbidden'}, 403)
            return

    try:
        if   action == 'repos':   send_json(get_repos())
        elif action == 'commits': send_json(get_commits(repo, visibility, owner))
        elif action == 'diff':    send_json(get_diff(repo, h, visibility, owner))
        elif action == 'tree':    send_json(get_tree(repo, f, hb, visibility, owner))
        elif action == 'readme':  send_json(get_readme(repo, visibility, owner))
        else: send_json({'error': 'unknown action'}, 400)
    except Exception as e:
        send_json({'error': str(e)}, 500)

if __name__ == '__main__':
    main()
