// word-box/lib/syntax-highlight.js をベースにgitdash用に調整
// パス参照を ../static/ に変更
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let cmAPI = null;

const LANG_EXT_MAP = {
  'javascript': '.js', 'js': '.js',
  'typescript': '.ts', 'ts': '.ts',
  'json': '.json',
  'tsx': '.tsx', 'jsx': '.jsx',
  'html': '.html', 'htm': '.htm',
  'css': '.css', 'scss': '.scss', 'less': '.less',
  'vue': '.vue',
  'markdown': '.md', 'md': '.md',
  'yaml': '.yaml', 'yml': '.yml',
  'xml': '.xml', 'svg': '.svg',
  'csharp': '.cs', 'cs': '.cs',
  'java': '.java',
  'kotlin': '.kt', 'kt': '.kt',
  'c': '.c', 'cpp': '.cpp', 'c++': '.cpp',
  'objectivec': '.m', 'objc': '.m',
  'scala': '.scala',
  'swift': '.swift',
  'python': '.py', 'py': '.py',
  'ruby': '.rb', 'rb': '.rb',
  'go': '.go',
  'rust': '.rs', 'rs': '.rs',
  'elixir': '.ex', 'ex': '.ex',
  'haxe': '.hx',
  'r': '.r',
  'perl': '.pl', 'pl': '.pl',
  'php': '.php',
  'sql': '.sql',
  'shell': '.sh', 'bash': '.sh', 'sh': '.sh',
  'coffeescript': '.coffee',
  'clojure': '.clj',
  'ocaml': '.ml', 'fsharp': '.fs',
  'cypher': '.cql',
  'jsp': '.jsp',
  'text': null,
};

const EXT_MIME_MAP = {
  '.ts': 'text/typescript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.coffee': 'text/x-coffeescript',
  '.tsx': 'text/typescript-jsx',
  '.jsx': 'text/jsx',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.jsp': 'application/x-jsp',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.less': 'text/x-less',
  '.vue': 'text/x-vue',
  '.md': 'text/x-markdown',
  '.markdown': 'text/x-markdown',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.xml': 'text/xml',
  '.svg': 'text/xml',
  '.m': 'text/x-objectivec',
  '.scala': 'text/x-scala',
  '.cs': 'text/x-csharp',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cpp': 'text/x-c++src',
  '.hpp': 'text/x-c++src',
  '.kt': 'text/x-kotlin',
  '.ml': 'text/x-ocaml',
  '.fs': 'text/x-fsharp',
  '.swift': 'text/x-swift',
  '.sh': 'text/x-sh',
  '.sql': 'text/x-sql',
  '.cql': 'application/x-cypher-query',
  '.go': 'text/x-go',
  '.pl': 'text/x-perl',
  '.php': 'application/x-httpd-php',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.clj': 'text/x-clojure',
  '.rs': 'text/x-rustsrc',
  '.ex': 'text/x-elixir',
  '.exs': 'text/x-elixir',
  '.hx': 'text/x-haxe',
  '.r': 'text/x-rsrc',
};

function initCodeMirror() {
  if (cmAPI) return;

  // gitdash用: static/ ディレクトリを参照
  const highlighterPath = path.resolve(__dirname, '..', 'static', 'highlighter.js');
  const commonPath = path.resolve(__dirname, '..', 'static', 'highlighter', 'common.js');

  const highlighterCode = fs.readFileSync(highlighterPath, 'utf8');
  const commonCode = fs.readFileSync(commonPath, 'utf8');

  const workerGlobal = {
    self: null,
    postMessage: function() {},
    importScripts: function() {
      vm.runInContext(commonCode, ctx);
    },
    console: console,
    Promise: Promise,
    Set: Set,
    Map: Map,
    Object: Object,
    Array: Array,
    Error: Error,
    Math: Math,
    String: String,
    Number: Number,
    RegExp: RegExp,
    JSON: JSON,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    isFinite: isFinite,
    undefined: undefined,
    Infinity: Infinity,
    NaN: NaN,
  };
  workerGlobal.self = workerGlobal;

  const ctx = vm.createContext(workerGlobal);
  vm.runInContext(highlighterCode, ctx);

  if (typeof workerGlobal.onmessage === 'function') {
    workerGlobal.postMessage = function() {};
    workerGlobal.onmessage({ data: { extension: '.js', contents: '', tabSize: 4, addModeClass: false } });
  }

  cmAPI = {
    highlightAsync: async function(code, extension) {
      const mime = EXT_MIME_MAP[extension];
      if (!mime) return null;

      let result = null;
      workerGlobal.postMessage = function(tokenMap) {
        result = tokenMap;
      };

      if (typeof workerGlobal.onmessage === 'function') {
        await workerGlobal.onmessage({
          data: { extension, contents: code, tabSize: 4, addModeClass: false }
        });
      }

      return result;
    },
  };

  if (typeof workerGlobal.onmessage === 'function') {
    workerGlobal.onmessage({
      data: { extension: '.js', contents: '', tabSize: 4, addModeClass: false }
    });
  }

  console.log('Syntax highlighter initialized.');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function highlightCode(code, language) {
  initCodeMirror();

  const langLower = (language || '').toLowerCase();
  const extension = LANG_EXT_MAP[langLower];
  if (!extension) {
    return escapeHtml(code);
  }

  try {
    const tokenMap = await cmAPI.highlightAsync(code, extension);
    if (!tokenMap || Object.keys(tokenMap).length === 0) {
      return escapeHtml(code);
    }

    return applyTokenMap(code, tokenMap);
  } catch (e) {
    console.error('Highlight error:', e.message);
    return escapeHtml(code);
  }
}

function applyTokenMap(code, tokenMap) {
  const lines = code.split('\n');
  const htmlLines = lines.map((line, lineIdx) => {
    const lineTokens = tokenMap[lineIdx];
    if (!lineTokens) {
      return escapeHtml(line);
    }

    const positions = Object.keys(lineTokens).map(Number).sort((a, b) => a - b);
    let result = '';
    let cursor = 0;

    for (const start of positions) {
      const { length, token } = lineTokens[start];
      if (cursor < start) {
        result += escapeHtml(line.slice(cursor, start));
      }
      const classes = token.split(' ').map(t => 'cm-' + t).join(' ');
      result += `<span class="${classes}">${escapeHtml(line.slice(start, start + length))}</span>`;
      cursor = start + length;
    }

    if (cursor < line.length) {
      result += escapeHtml(line.slice(cursor));
    }

    return result;
  });

  return htmlLines.join('\n');
}

module.exports = { highlightCode };
