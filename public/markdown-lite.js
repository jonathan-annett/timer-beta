/*!
 * markdown-lite.js
 * Small Markdown → HTML renderer for showing the README inside the app.
 * Covers what the README uses: headings (with GitHub-style ids), paragraphs, nested
 * lists, tables, fenced code, blockquotes, rules, `code`, **bold**, *italic*, links
 * and bare URLs. Everything is HTML-escaped first, so input text can't inject markup.
 * MIT Licensed
 */

var MarkdownLite = (function () {
  'use strict';

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // GitHub's heading anchors: lowercase, punctuation dropped, spaces → hyphens
  const slug = text => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/ /g, '-');

  function render(md, opts) {
    opts = opts || {};
    // Relative links (e.g. CLAUDE.md) point at this base URL
    const linkBase = opts.linkBase || '';

    function safeUrl(u) {
      if (/^https?:\/\//i.test(u) || u.startsWith('#')) return u;
      if (/^[a-z]+:/i.test(u)) return '#';                     // javascript:, data:, etc.
      return linkBase + u;
    }

    function inline(s) {
      const codes = [];
      s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
      s = esc(s);
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
        const href = safeUrl(u.replace(/&amp;/g, '&'));
        const ext = /^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : '';
        return `<a href="${esc(href)}"${ext}>${t}</a>`;
      });
      s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      s = s.replace(/(^|[^*\w])\*([^*\s](?:[^*]*?[^*\s])?)\*(?![*\w])/g, '$1<i>$2</i>');
      s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + esc(codes[+i]) + '</code>');
      return s;
    }

    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    const n = lines.length;
    const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
    const isBlockStart = l => /^(#{1,6}\s|```|>|\|)/.test(l) || LIST.test(l) || /^-{3,}\s*$/.test(l);
    const out = [];
    let i = 0;

    function splitRow(l) {
      return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    }

    function parseList(start, indent) {
      const ordered = /^\s*\d+\./.test(lines[start]);
      let html = '';
      let j = start;
      while (j < n) {
        const m = lines[j].match(LIST);
        if (!m || m[1].length < indent) break;
        if (m[1].length > indent) {                              // nested list → inside the previous item
          const r = parseList(j, m[1].length);
          html = html.replace(/<\/li>$/, r.html + '</li>');
          j = r.i;
          continue;
        }
        let text = m[3];
        j++;
        while (j < n && lines[j].trim() && !LIST.test(lines[j]) && /^\s+/.test(lines[j])) {
          text += ' ' + lines[j].trim();
          j++;
        }
        html += '<li>' + inline(text) + '</li>';
        // a single blank line between items of the same list
        if (j + 1 < n && !lines[j].trim() && LIST.test(lines[j + 1]) && lines[j + 1].match(LIST)[1].length >= indent) j++;
      }
      const tag = ordered ? 'ol' : 'ul';
      return { html: `<${tag}>${html}</${tag}>`, i: j };
    }

    while (i < n) {
      const line = lines[i];
      let m;
      if (/^```/.test(line)) {
        const code = [];
        i++;
        while (i < n && !/^```/.test(lines[i])) code.push(lines[i++]);
        i++;
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
      } else if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*$/))) {
        const level = m[1].length, html = inline(m[2]);
        out.push(`<h${level} id="${slug(html)}">${html}</h${level}>`);
        i++;
      } else if (!line.trim()) {
        i++;
      } else if (/^\|/.test(line) && i + 1 < n && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const head = splitRow(line);
        i += 2;
        let html = '<table>';
        if (head.some(Boolean)) html += '<thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead>';
        html += '<tbody>';
        while (i < n && /^\|/.test(lines[i])) {
          html += '<tr>' + splitRow(lines[i]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>';
          i++;
        }
        out.push(html + '</tbody></table>');
      } else if (/^>/.test(line)) {
        const q = [];
        while (i < n && /^>/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
        out.push('<blockquote>' + render(q.join('\n'), opts) + '</blockquote>');
      } else if (/^-{3,}\s*$/.test(line)) {
        out.push('<hr>');
        i++;
      } else if (LIST.test(line)) {
        const r = parseList(i, line.match(LIST)[1].length);
        out.push(r.html);
        i = r.i;
      } else {
        const p = [line.trim()];
        i++;
        while (i < n && lines[i].trim() && !isBlockStart(lines[i])) p.push(lines[i++].trim());
        out.push('<p>' + inline(p.join(' ')) + '</p>');
      }
    }
    return out.join('\n');
  }

  return { render, slug };
})();

if (typeof module !== 'undefined') module.exports = MarkdownLite;
