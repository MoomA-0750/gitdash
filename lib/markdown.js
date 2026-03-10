// word-box/lib/markdown.js をベースにgitdash用に調整
// 削除: bookmark, article, magazine, dictionary カード、自動目次挿入
// 維持: コードブロック(シンタックスハイライト), コールアウト, テーブル,
//       ネストリスト, チェックボックス, 見出しID, インライン書式
const { highlightCode } = require('./syntax-highlight');

async function parseMarkdown(text) {
  let html = text;

  // GitHubスタイルのコールアウト（引用ブロック内）
  const callouts = [];
  const calloutRegex = /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n((?:^>.*\n?)*)/gm;
  const calloutMatches = [];
  html = html.replace(calloutRegex, (match, type, content) => {
    const placeholder = `___CALLOUT_${calloutMatches.length}___`;
    calloutMatches.push({ type, content });
    return placeholder;
  });

  for (const { type, content } of calloutMatches) {
    const cleanContent = content
      .split('\n')
      .map(line => line.replace(/^>\s?/, ''))
      .join('\n')
      .trim();

    const calloutCodeBlocks = [];
    const calloutCodeData = [];
    const protectedContent = cleanContent.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const cbPlaceholder = `___CALLOUT_CODE_${calloutCodeBlocks.length}___`;
      const language = lang || 'text';
      calloutCodeData.push({ code: code.trim(), language });
      calloutCodeBlocks.push(cbPlaceholder);
      return cbPlaceholder;
    });

    for (let ci = 0; ci < calloutCodeData.length; ci++) {
      const { code: rawCode, language: lang } = calloutCodeData[ci];
      const highlighted = await highlightCode(rawCode, lang);
      calloutCodeBlocks[ci] = `
<div class="code-block">
  <div class="code-header">
    <span class="code-language">${lang}</span>
    <button class="copy-button">コピー</button>
  </div>
  <pre><code class="language-${lang}">${highlighted}</code></pre>
</div>`;
    }

    let parsedContent = await parseMarkdown(protectedContent);

    calloutCodeBlocks.forEach((code, i) => {
      parsedContent = parsedContent.replace(`___CALLOUT_CODE_${i}___`, code);
    });

    callouts.push(createCallout(type, parsedContent));
  }

  // コードブロック（先に処理して保護）
  const codeBlocks = [];
  const codeBlockData = [];
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `___CODE_BLOCK_${codeBlocks.length}___`;
    const language = lang || 'text';
    const escapedCode = escapeHtml(code.trim());

    const codeBlockHtml = `
<div class="code-block">
  <div class="code-header">
    <span class="code-language">${language}</span>
    <button class="copy-button">コピー</button>
  </div>
  <pre><code class="language-${language}">${escapedCode}</code></pre>
</div>`;

    codeBlockData.push({ code: code.trim(), language });
    codeBlocks.push(codeBlockHtml);
    return placeholder;
  });

  // コードブロックにシンタックスハイライトを適用
  for (let ci = 0; ci < codeBlockData.length; ci++) {
    const { code: rawCode, language: lang } = codeBlockData[ci];
    const highlighted = await highlightCode(rawCode, lang);
    codeBlocks[ci] = `
<div class="code-block">
  <div class="code-header">
    <span class="code-language">${lang}</span>
    <button class="copy-button">コピー</button>
  </div>
  <pre><code class="language-${lang}">${highlighted}</code></pre>
</div>`;
  }

  // テーブルをパース（プレースホルダーで保護）
  const tables = [];
  html = parseTablesWithPlaceholder(html, tables);

  // インラインコード
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 画像（リンクより先に処理）
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // リンク
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // 見出し（IDを付与）
  let headingCounter = 0;
  html = html.replace(/^(#{1,5}) (.+)$/gm, (match, hashes, title) => {
    const level = hashes.length;
    const id = `heading-${headingCounter++}`;
    return `<h${level} id="${id}">${title}</h${level}>`;
  });

  // 水平線
  html = html.replace(/\n---+\n/g, '\n<hr>\n');
  html = html.replace(/\n\*\*\*+\n/g, '\n<hr>\n');
  html = html.replace(/\n___+\n/g, '\n<hr>\n');

  // ネストされたリストをパース
  html = parseNestedLists(html);

  // 打ち消し線
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // 下線
  html = html.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');

  // 強調（**bold**, *italic*）
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 段落（空行で区切る）
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs.map(p => {
    p = p.trim();
    if (p.match(/^<(h[1-6]|ul|ol|pre|hr|blockquote|img|div|a)/)) {
      return p;
    }
    if (p.match(/^___(CODE_BLOCK|CALLOUT|TABLE)_?\d*___$/)) {
      return p;
    }
    if (p.match(/___(CODE_BLOCK|CALLOUT|TABLE)_?\d*___/)) {
      const parts = p.split(/(___(CODE_BLOCK|CALLOUT|TABLE)_?\d*___)/);
      return parts.map(part => {
        if (part.match(/^___(CODE_BLOCK|CALLOUT|TABLE)_?\d*___$/)) {
          return part;
        }
        if (part.match(/^(CODE_BLOCK|CALLOUT|TABLE)$/)) {
          return '';
        }
        const trimmed = part.trim();
        if (!trimmed) return '';
        return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
      }).filter(part => part).join('\n');
    }
    return p ? `<p>${p.replace(/\n/g, '<br>')}</p>` : '';
  }).join('\n');

  // プレースホルダー復元
  codeBlocks.forEach((code, i) => {
    html = html.replace(`___CODE_BLOCK_${i}___`, code);
  });

  callouts.forEach((callout, i) => {
    html = html.replace(`___CALLOUT_${i}___`, callout);
  });

  tables.forEach((table, i) => {
    html = html.replace(`___TABLE_${i}___`, table);
  });

  return html;
}

// コールアウト生成
function createCallout(type, content) {
  const typeConfig = {
    NOTE: { icon: 'ℹ️', label: 'Note', className: 'callout-note' },
    TIP: { icon: '💡', label: 'Tip', className: 'callout-tip' },
    IMPORTANT: { icon: '❗', label: 'Important', className: 'callout-important' },
    WARNING: { icon: '⚠️', label: 'Warning', className: 'callout-warning' },
    CAUTION: { icon: '🔴', label: 'Caution', className: 'callout-caution' }
  };

  const config = typeConfig[type] || typeConfig.NOTE;

  return `
<div class="callout ${config.className}">
  <div class="callout-header">
    <span class="callout-icon">${config.icon}</span>
    <span class="callout-label">${config.label}</span>
  </div>
  <div class="callout-content">${content}</div>
</div>`;
}

// テーブルをパースしてプレースホルダーに置換
function parseTablesWithPlaceholder(html, tables) {
  const lines = html.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.match(/^\|.+\|$/)) {
      if (i + 1 < lines.length && lines[i + 1].match(/^\|[\s\-:|]+\|$/)) {
        const tableLines = [];
        while (i < lines.length && lines[i].match(/^\|.+\|$/)) {
          tableLines.push(lines[i]);
          i++;
        }
        const placeholder = `___TABLE_${tables.length}___`;
        tables.push(buildTable(tableLines));
        result.push(placeholder);
        continue;
      }
    }
    result.push(line);
    i++;
  }

  return result.join('\n');
}

// テーブル行からHTMLを構築
function buildTable(lines) {
  if (lines.length < 2) return lines.join('\n');

  const headerLine = lines[0];
  const separatorLine = lines[1];
  const bodyLines = lines.slice(2);

  function extractCells(line) {
    const placeholder = '\x00ESCAPED_PIPE\x00';
    const escaped = line.slice(1, -1).replace(/\\\|/g, placeholder);
    const cells = escaped.split('|');
    return cells.map(cell => cell.replace(new RegExp(placeholder, 'g'), '|').trim());
  }

  const alignments = extractCells(separatorLine).map(cell => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });

  function processInlineFormatting(text) {
    let result = text;
    result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');
    result = result.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
    return result;
  }

  const headerCells = extractCells(headerLine);
  let tableHtml = '<table>\n<thead>\n<tr>';
  headerCells.forEach((cell, idx) => {
    const align = alignments[idx] || 'left';
    tableHtml += `<th style="text-align: ${align}">${processInlineFormatting(cell)}</th>`;
  });
  tableHtml += '</tr>\n</thead>\n<tbody>';

  for (const bodyLine of bodyLines) {
    const cells = extractCells(bodyLine);
    tableHtml += '\n<tr>';
    cells.forEach((cell, idx) => {
      const align = alignments[idx] || 'left';
      tableHtml += `<td style="text-align: ${align}">${processInlineFormatting(cell)}</td>`;
    });
    tableHtml += '</tr>';
  }

  tableHtml += '\n</tbody>\n</table>';
  return tableHtml;
}

// ネストされたリストをパース
function parseNestedLists(html) {
  const lines = html.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const ulMatch = line.match(/^(\s*)- (.+)$/);
    const olMatch = line.match(/^(\s*)(\d+)\. (.+)$/);

    if (ulMatch || olMatch) {
      const listLines = [];
      while (i < lines.length) {
        const currentLine = lines[i];
        const isUl = currentLine.match(/^(\s*)- (.+)$/);
        const isOl = currentLine.match(/^(\s*)(\d+)\. (.+)$/);
        if (isUl || isOl) {
          listLines.push(currentLine);
          i++;
        } else if (currentLine.trim() === '') {
          break;
        } else {
          break;
        }
      }
      result.push(buildNestedList(listLines));
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}

// チェックボックスを処理
function processCheckbox(content) {
  if (content.startsWith('[x] ') || content.startsWith('[X] ')) {
    return {
      hasCheckbox: true,
      checked: true,
      content: content.slice(4)
    };
  }
  if (content.startsWith('[ ] ')) {
    return {
      hasCheckbox: true,
      checked: false,
      content: content.slice(4)
    };
  }
  return { hasCheckbox: false, checked: false, content: content };
}

// リスト行からネストされたHTMLを構築
function buildNestedList(lines) {
  if (lines.length === 0) return '';

  function getIndentLevel(line) {
    const match = line.match(/^(\s*)/);
    if (!match) return 0;
    const spaces = match[1].replace(/\t/g, '  ').length;
    return Math.floor(spaces / 2);
  }

  function parseLine(line) {
    const ulMatch = line.match(/^\s*- (.+)$/);
    const olMatch = line.match(/^\s*(\d+)\. (.+)$/);
    if (ulMatch) {
      return { type: 'ul', content: ulMatch[1], number: null };
    } else if (olMatch) {
      return { type: 'ol', content: olMatch[2], number: parseInt(olMatch[1], 10) };
    }
    return null;
  }

  let html = '';
  const stack = [];
  let hasCheckboxList = false;

  for (const line of lines) {
    const indent = getIndentLevel(line);
    const parsed = parseLine(line);
    if (!parsed) continue;

    const checkbox = processCheckbox(parsed.content);
    let displayContent = checkbox.content;

    if (checkbox.hasCheckbox) {
      hasCheckboxList = true;
      const checkedAttr = checkbox.checked ? ' checked disabled' : ' disabled';
      displayContent = `<input type="checkbox"${checkedAttr}> <span class="${checkbox.checked ? 'checkbox-checked' : ''}">${checkbox.content}</span>`;
    }

    while (stack.length > 0 && stack[stack.length - 1].indent > indent) {
      const popped = stack.pop();
      html += `</li></${popped.type}>`;
    }

    if (stack.length === 0) {
      const startAttr = (parsed.type === 'ol' && parsed.number !== 1) ? ` start="${parsed.number}"` : '';
      html += `<${parsed.type}${startAttr}><li>${displayContent}`;
      stack.push({ type: parsed.type, indent: indent });
    } else if (stack[stack.length - 1].indent === indent) {
      html += `</li><li>${displayContent}`;
    } else if (stack[stack.length - 1].indent < indent) {
      const startAttr = (parsed.type === 'ol' && parsed.number !== 1) ? ` start="${parsed.number}"` : '';
      html += `<${parsed.type}${startAttr}><li>${displayContent}`;
      stack.push({ type: parsed.type, indent: indent });
    }
  }

  while (stack.length > 0) {
    const popped = stack.pop();
    html += `</li></${popped.type}>`;
  }

  if (hasCheckboxList && html.startsWith('<ul>')) {
    html = html.replace(/^<ul>/, '<ul class="checkbox-list">');
  }

  return html;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = { parseMarkdown };
