#!/usr/bin/env node
// goods-mall 에러 카탈로그 정적 사이트 생성기.
// catalog.json을 읽어 errors/<CODE>.html 과 index.html 을 만든다.
//   실행: node docs/specs/errors/build.mjs
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const { baseUrl, errors } = JSON.parse(readFileSync(join(DIR, 'catalog.json'), 'utf8'));
const byCode = new Map(errors.map((e) => [e.code, e]));

const STATUS_TEXT = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  409: 'Conflict', 422: 'Unprocessable Entity', 500: 'Internal Server Error',
};
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// 상태별 배지 색 (auth/authz는 보라, conflict는 주황, 그 외 4xx 호박, 5xx 빨강)
function hue(status) {
  if (status === 401 || status === 403) return ['#bc8cff', '#211a2e', '#3b2f57'];
  if (status === 409) return ['#db6d28', '#2a1a0e', '#54341a'];
  if (status >= 500) return ['#f85149', '#2a1414', '#5a2526'];
  return ['#d29922', '#2b2410', '#4d3c10'];
}

const CSS = `
  :root { --bg:#0d1117; --card:#161b22; --border:#30363d; --fg:#e6edf3; --muted:#9198a1; --accent:#6ea8fe;
          --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", sans-serif; }
  .wrap { max-width:820px; margin:0 auto; padding:48px 24px 96px; }
  .crumb { color:var(--muted); font-size:13px; margin-bottom:28px; }
  .crumb a { color:var(--muted); text-decoration:none; } .crumb a:hover { color:var(--accent); }
  .head { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  h1 { font-family:var(--mono); font-size:28px; margin:0; letter-spacing:-0.5px; }
  .badge { font-family:var(--mono); font-size:13px; font-weight:600; padding:4px 10px; border-radius:999px; }
  .lede { font-size:18px; margin:18px 0 4px; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:0.6px; color:var(--muted); margin:40px 0 12px; }
  p { margin:0 0 12px; } ul { margin:0 0 12px; padding-left:20px; } li { margin:4px 0; }
  code { font-family:var(--mono); background:#21262d; padding:1px 6px; border-radius:5px; font-size:0.9em; }
  pre { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:18px 20px;
        overflow-x:auto; font-family:var(--mono); font-size:13.5px; line-height:1.6; }
  pre .k { color:#7ee787; } pre .s { color:#a5d6ff; } pre .n { color:#ff9e64; } pre .c { color:var(--muted); }
  table { width:100%; border-collapse:collapse; margin:8px 0; font-size:14px; }
  th, td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--border); vertical-align:top; }
  th { color:var(--muted); font-weight:600; }
  .rel a, .grid a.card { text-decoration:none; }
  .rel a { display:inline-block; font-family:var(--mono); font-size:13px; color:var(--accent);
           border:1px solid var(--border); border-radius:8px; padding:6px 11px; margin:4px 6px 0 0; background:var(--card); }
  .rel a:hover { border-color:var(--accent); }
  footer { margin-top:56px; padding-top:20px; border-top:1px solid var(--border); color:var(--muted); font-size:13px; }
  footer a { color:var(--accent); }
  .grid { display:grid; grid-template-columns:1fr; gap:10px; }
  .grid a.card { display:flex; align-items:center; gap:12px; padding:12px 16px; background:var(--card);
                 border:1px solid var(--border); border-radius:10px; color:var(--fg); }
  .grid a.card:hover { border-color:var(--accent); }
  .grid .ccode { font-family:var(--mono); font-weight:600; }
  .grid .ctitle { color:var(--muted); font-size:13px; margin-left:auto; }
`;

function badge(status) {
  const [fg, bg, bd] = hue(status);
  return `<span class="badge" style="color:${fg};background:${bg};border:1px solid ${bd}">HTTP ${status} · ${esc(STATUS_TEXT[status] || '')}</span>`;
}

function examplePre(e) {
  return `<pre><span class="c">HTTP/1.1 ${e.status} ${esc(STATUS_TEXT[e.status] || '')}</span>
<span class="c">Content-Type: application/problem+json</span>
{
  <span class="k">"type"</span>: <span class="s">"${baseUrl}/${e.code}"</span>,
  <span class="k">"title"</span>: <span class="s">"${esc(e.title)}"</span>,
  <span class="k">"status"</span>: <span class="n">${e.status}</span>,
  <span class="k">"code"</span>: <span class="s">"${e.code}"</span>,
  <span class="k">"detail"</span>: <span class="s">"${esc(e.detail)}"</span>,
  <span class="k">"instance"</span>: <span class="s">"${esc(e.instance)}"</span>
}</pre>`;
}

function relatedHtml(e) {
  if (!e.related || e.related.length === 0) return '<p class="muted">없음</p>';
  return `<div class="rel">${e.related
    .map((c) => (byCode.has(c) ? `<a href="./${c}.html">${c}</a>` : `<span class="rel">${esc(c)}</span>`))
    .join('')}</div>`;
}

function page(e) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${e.code} · goods-mall 에러 카탈로그</title>
    <style>${CSS}</style>
  </head>
  <body>
    <div class="wrap">
      <div class="crumb"><a href="../swagger.html">goods-mall API</a> / <a href="./index.html">errors</a> / ${e.code}</div>
      <div class="head"><h1>${e.code}</h1>${badge(e.status)}</div>
      <p class="lede">${esc(e.detail)}</p>

      <h2>의미</h2>
      <p>${esc(e.meaning)} <a href="https://www.rfc-editor.org/rfc/rfc9457.html">RFC 9457</a>
         <code>application/problem+json</code> 형식으로 전달됩니다.</p>

      <h2>발생 조건</h2>
      <ul>${e.occurs.map((o) => `<li><code>${esc(o)}</code></li>`).join('')}</ul>

      <h2>응답 예시</h2>
      ${examplePre(e)}

      <h2>필드</h2>
      <table>
        <tr><th>필드</th><th>의미</th></tr>
        <tr><td><code>type</code></td><td>이 페이지의 URI — 에러 종류의 안정적 식별자이자 문서 링크.</td></tr>
        <tr><td><code>title</code></td><td>종류별 고정 요약(영어·불변, 로그·관측 그룹핑용).</td></tr>
        <tr><td><code>status</code></td><td>HTTP 상태 코드(${e.status}).</td></tr>
        <tr><td><code>code</code></td><td><strong>클라이언트가 분기에 사용하는 안정 키.</strong> 메시지 대신 이 값으로 처리.</td></tr>
        <tr><td><code>detail</code></td><td>이번 발생 건의 사람용 메시지(한국어·가변).</td></tr>
        <tr><td><code>instance</code></td><td>에러가 난 요청 경로.</td></tr>
      </table>

      <h2>클라이언트 처리</h2>
      <p><code>detail</code>을 파싱하지 말고 <code>code</code>로 분기하세요.</p>
<pre><span class="k">if</span> (problem.code === <span class="s">'${e.code}'</span>) {
  <span class="c">// ${esc(e.group)} 에러 처리</span>
}</pre>

      <h2>관련 에러</h2>
      ${relatedHtml(e)}

      <footer>goods-mall 에러 카탈로그 · 형식은
        <a href="https://www.rfc-editor.org/rfc/rfc9457.html">RFC 9457</a> ·
        전체 계약은 <a href="../swagger.html">Swagger UI</a> / <a href="../openapi.yaml">openapi.yaml</a></footer>
    </div>
  </body>
</html>
`;
}

function indexPage() {
  const groups = [...new Set(errors.map((e) => e.group))];
  const sections = groups
    .map((g) => {
      const cards = errors
        .filter((e) => e.group === g)
        .map(
          (e) =>
            `<a class="card" href="./${e.code}.html">${badge(e.status)}<span class="ccode">${e.code}</span><span class="ctitle">${esc(e.detail)}</span></a>`,
        )
        .join('');
      return `<h2>${esc(g)}</h2><div class="grid">${cards}</div>`;
    })
    .join('');
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>goods-mall 에러 카탈로그</title>
    <style>${CSS}</style>
  </head>
  <body>
    <div class="wrap">
      <div class="crumb"><a href="../swagger.html">goods-mall API</a> / errors</div>
      <div class="head"><h1>에러 카탈로그</h1></div>
      <p class="lede">RFC 9457 Problem Details의 <code>code</code>별 문서. 에러 응답의 <code>type</code> URI가 각 페이지를 가리킵니다.</p>
      ${sections}
      <footer>총 ${errors.length}개 · 형식은
        <a href="https://www.rfc-editor.org/rfc/rfc9457.html">RFC 9457</a> ·
        <a href="../swagger.html">Swagger UI</a> / <a href="../openapi.yaml">openapi.yaml</a></footer>
    </div>
  </body>
</html>
`;
}

// 이전 생성물 정리(코드 .html 만; index/sample 제외 대상 아님 — 전부 재생성)
for (const f of readdirSync(DIR)) {
  if (f.endsWith('.html')) unlinkSync(join(DIR, f));
}
for (const e of errors) writeFileSync(join(DIR, `${e.code}.html`), page(e));
writeFileSync(join(DIR, 'index.html'), indexPage());
console.log(`generated ${errors.length} error pages + index.html in ${DIR}`);
