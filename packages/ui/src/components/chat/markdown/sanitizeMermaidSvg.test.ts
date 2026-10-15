import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { renderMermaidSVG } from 'beautiful-mermaid';

// ELK initializes its Node worker before a browser-like window exists.
renderMermaidSVG('flowchart LR\n A --> B');

const win = new Window({ url: 'https://diagram.test/' });
// Bun's Happy DOM window lacks these JavaScript intrinsics during XML event-attribute parsing.
Object.assign(win, { Error, SyntaxError });
Object.assign(globalThis, {
  window: win, document: win.document, Element: win.Element, HTMLElement: win.HTMLElement,
  HTMLAnchorElement: win.HTMLAnchorElement, SVGElement: win.SVGElement,
  DOMParser: win.DOMParser, XMLSerializer: win.XMLSerializer, CSS: win.CSS,
  CSSStyleSheet: win.CSSStyleSheet, CSSStyleRule: win.CSSStyleRule,
});
const { sanitizeMermaidSvg } = await import('./sanitizeMermaidSvg');
const { decorateMarkdown, attachMarkdownInteractions } = await import('./decorate');

const colors = { bg: '#1b1918', fg: '#dbd7cc', line: '#242323bf', accent: '#da7c47', muted: '#949187', surface: '#0e0c0b', border: '#242323bf', transparent: true, font: 'system-ui, sans-serif' };
const parse = (svg: string | null) => new DOMParser().parseFromString(svg ?? '', 'image/svg+xml');
const shell = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${content}</svg>`;
const hostile = `flowchart TD
  A["<img src=x onerror=artifactProbe()>"] --> B["<script>artifactProbe()</script>"]
  classDef hostile fill:url(https://artifact-external.invalid/paint.svg#paint),stroke:#f00
  class A hostile`;

describe('generated Mermaid SVG sanitizer', () => {
  test('removes the installed renderer external paint and font imports while preserving actual geometry and labels', () => {
    const raw = renderMermaidSVG(hostile, colors);
    expect(raw).toContain('https://artifact-external.invalid');
    expect(raw).toContain('fonts.googleapis.com');
    const clean = sanitizeMermaidSvg(raw);
    expect(clean).not.toBeNull();
    const doc = parse(clean);
    expect(doc.querySelectorAll('rect').length).toBeGreaterThan(1);
    expect(doc.querySelectorAll('polyline').length).toBeGreaterThan(0);
    expect(doc.querySelectorAll('marker').length).toBeGreaterThan(0);
    expect(doc.querySelector('text')?.textContent).toContain('<img');
    expect(clean).not.toContain('https://artifact-external.invalid');
    expect(clean).not.toContain('fonts.googleapis.com');
    expect(doc.querySelector('style,script,image,foreignObject')).toBeNull();
    for (const element of doc.querySelectorAll('*')) {
      expect(Array.from(element.attributes).some(attr => attr.name.startsWith('on'))).toBe(false);
    }
  });

  test('keeps classDef colors, theme derivations and locally rebased marker references', () => {
    const raw = renderMermaidSVG('flowchart LR\n A[One] --> B[Two]\n classDef red fill:#fee,stroke:rgb(200,0,0),stroke-width:2\n class A red', colors);
    const clean = sanitizeMermaidSvg(raw);
    const doc = parse(clean);
    expect(doc.documentElement.getAttribute('viewBox')).toBe(parse(raw).documentElement.getAttribute('viewBox'));
    expect(doc.documentElement.getAttribute('style')).toContain('--bg: #1b1918');
    expect(doc.documentElement.getAttribute('style')).toContain('--_node-fill: var(--surface, color-mix');
    expect(doc.querySelector('rect')?.getAttribute('fill')).toBe('#fee');
    const reference = doc.querySelector('[marker-end]')?.getAttribute('marker-end') ?? '';
    const marker = doc.querySelector('marker');
    expect(marker?.getAttribute('id')?.startsWith('oc-mermaid-')).toBe(true);
    expect(reference).toBe(`url(#${marker?.getAttribute('id')})`);
  });

  test('keeps sequence edges and class/ER mono font presentation with no remote font rule', () => {
    for (const source of [
      'sequenceDiagram\n Alice->>Bob: Hello\n Bob-->>Alice: Hi',
      'classDiagram\n class Animal {\n +int age\n +run()\n }\n Animal <|-- Dog',
      'erDiagram\n CUSTOMER {\n int id PK\n string name\n }\n CUSTOMER ||--o{ ORDER : places',
    ]) {
      const clean = sanitizeMermaidSvg(renderMermaidSVG(source, colors));
      expect(clean).not.toBeNull();
      const doc = parse(clean);
      expect(doc.querySelectorAll('text').length).toBeGreaterThan(2);
      expect(doc.querySelectorAll('path,polyline,line').length).toBeGreaterThan(0);
      for (const text of doc.querySelectorAll('text.mono')) expect(text.getAttribute('style')).toContain('ui-monospace');
      expect(clean).not.toContain('@import');
      expect(clean).not.toContain('<style');
    }
  });

  test('preserves xychart series colors, bar fills and chart geometry as local inline styles', () => {
    const raw = renderMermaidSVG('xychart-beta\n x-axis [Jan, Feb, Mar]\n y-axis "Revenue" 0 --> 100\n bar [30, 60, 45]\n line [40, 80, 55]', colors);
    const clean = sanitizeMermaidSvg(raw);
    expect(clean).not.toBeNull();
    const doc = parse(clean);
    expect(doc.querySelectorAll('path.xychart-bar').length).toBe(3);
    expect(doc.querySelector('.xychart-bar')?.getAttribute('style')).toContain('fill: var(--xychart-bar-fill-0)');
    expect(doc.querySelector('.xychart-line')?.getAttribute('style')).toContain('stroke: var(--xychart-color-1)');
    expect(doc.documentElement.getAttribute('style')).toContain('--xychart-color-1:');
    expect(doc.documentElement.getAttribute('style')).toContain('--xychart-bar-fill-0: color-mix');
    expect(doc.querySelector('.xychart-grid')?.getAttribute('style')).toContain('opacity: 0.65');
    expect(doc.querySelectorAll('style')).toHaveLength(0);
  });

  test('drops active elements, handlers, all hrefs, external references and arbitrary CSS properties', () => {
    const clean = sanitizeMermaidSvg(shell(`
      <script>alert(1)</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject>
      <image href="https://outside.invalid/image"/><animate attributeName="fill" values="red;blue"/>
      <rect id="box" class="node fixed arbitrary-app-class" width="20" height="10" onload="alert(1)" FILL="url(&#x68;ttps://outside.invalid/a)" STROKE="url(data:image/svg+xml,x)" style="cursor:url(https://outside.invalid/c),auto; background-image:url(https://outside.invalid/b); fill:var(--unknown); position:fixed"/>
      <use href="#box"/><a href="javascript:alert(1)"><text>link label</text></a>
    `));
    expect(clean).not.toBeNull();
    const doc = parse(clean);
    expect(doc.querySelector('script,foreignObject,image,animate,use,a') === null).toBe(true);
    expect(doc.querySelector('rect')?.hasAttribute('fill')).toBe(false);
    expect(doc.querySelector('rect')?.hasAttribute('stroke')).toBe(false);
    expect(doc.querySelector('rect')?.hasAttribute('onload')).toBe(false);
    expect(doc.querySelector('rect')?.getAttribute('class')).toBe('node');
    expect(clean).not.toContain('outside.invalid');
    expect(clean).not.toContain('position');
    expect(clean).not.toContain('--unknown');
    expect(doc.querySelector('rect')).not.toBeNull();
  });

  test('drops all at-rules, unsupported selectors and active CSS while retaining approved chart rules', () => {
    const clean = sanitizeMermaidSvg(shell(`<style>
      @import url('https://outside.invalid/font');
      @font-face { font-family: stolen; src:url('https://outside.invalid/font'); }
      @media all {text {fill:red}}
      @keyframes slide {to {fill:blue}}
      body, #app, text:hover, svg text {fill:red}
      .xychart-bar {fill:rgb(1 2 3 / 50%);stroke:var(--fg);stroke-width:2;cursor:url(https://outside.invalid/c),auto}
      svg {--xychart-color-0:url(https://outside.invalid/paint)}
    </style><rect class="xychart-bar" width="20" height="10"/><text>safe</text>`));
    const doc = parse(clean);
    expect(clean).not.toContain('outside.invalid');
    expect(clean).not.toContain('@');
    expect(clean).not.toContain('<style');
    expect(doc.querySelector('rect')?.getAttribute('style')).toContain('fill: rgb(1 2 3 / 50%)');
    expect(doc.querySelector('text')?.getAttribute('style')).not.toContain('fill');
    expect(doc.documentElement.getAttribute('style')).toContain('--xychart-color-0: initial');
  });

  const rejectedValues = [
    'url(https://outside.invalid/x)', 'url(data:image/svg+xml,x)', 'url(#missing)',
    'var(--unknown)', 'var(--fg, url(https://outside.invalid/x))',
    'var(--fg, var(--unknown))', 'var(--fg, attr(data-color))', 'env(example)',
    'attr(data-color type(&lt;color&gt;))', 'u\\72l(https://outside.invalid/x)',
    'r/**/ed', 'inherit',
  ];
  for (const value of rejectedValues) test(`drops unapproved paint value ${value}`, () => {
    const clean = sanitizeMermaidSvg(shell(`<rect width="20" height="10" fill="${value}"/>`));
    expect(clean).not.toBeNull();
    expect(parse(clean).querySelector('rect')?.hasAttribute('fill')).toBe(false);
  });

  test('validates fallbacks and keeps safe color functions with alpha and derived variables', () => {
    const clean = sanitizeMermaidSvg(shell('<rect width="20" height="10" fill="var(--_text, color-mix(in srgb, rgb(1 2 3 / 50%) 50%, #fff))" stroke="hsl(120 20% 40% / 50%)"/>'));
    const rect = parse(clean).querySelector('rect');
    expect(rect?.getAttribute('fill')).toContain('var(--_text, color-mix');
    expect(rect?.getAttribute('stroke')).toBe('hsl(120 20% 40% / 50%)');
  });

  test('drops escaped/commented inline CSS, unknown custom properties and inherited variable indirection', () => {
    const clean = sanitizeMermaidSvg(shell('<style>svg{--outside:url(https://outside.invalid/x);--xychart-color-0:var(--outside)} .xychart-bar{fill:var(--xychart-color-0)}</style><rect class="xychart-bar" style="fill:r/**/ed;stroke:blue"/><text style="fill:var(--fg,attr(title));--fg:var(--outside)">x</text>'));
    expect(clean).not.toContain('outside.invalid');
    expect(clean).not.toContain('--outside');
    expect(parse(clean).querySelector('rect')?.getAttribute('style')).toBe('fill: var(--xychart-color-0);');
    expect(parse(clean).documentElement.getAttribute('style')).toContain('--xychart-color-0: initial');
  });

  test('accepts only existing marker targets and separates IDs across independently generated graphs', () => {
    const input = shell('<defs><marker id="head"><path d="M0 0L1 1"/></marker></defs><path id="line" d="M0 0L20 20" marker-end="url(&quot;#head&quot;)" marker-start="url(#line)" marker-mid="url(#missing)"/>');
    const first = parse(sanitizeMermaidSvg(input)); const second = parse(sanitizeMermaidSvg(input));
    const path = first.querySelector('svg > path');
    expect(path?.getAttribute('marker-end')).toBe(`url(#${first.querySelector('marker')?.getAttribute('id')})`);
    expect(path?.hasAttribute('marker-start')).toBe(false);
    expect(path?.hasAttribute('marker-mid')).toBe(false);
    expect(first.querySelector('marker')?.getAttribute('id')).not.toBe(second.querySelector('marker')?.getAttribute('id'));
  });

  test('rejects invalid roots, XML errors, duplicate IDs and external document definitions', () => {
    for (const input of ['<html/>', '<svg xmlns="https://outside.invalid"/>', shell('<rect>'), `${shell('')}${shell('')}`, '<!DOCTYPE svg [<!ENTITY x "bad">]><svg xmlns="http://www.w3.org/2000/svg"/>', shell('<marker id="x"/><rect id="x"/>')]) {
      expect(sanitizeMermaidSvg(input)).toBeNull();
    }
  });

  test('stores and downloads the same clean SVG used for actual decoration', async () => {
    const clean = sanitizeMermaidSvg(renderMermaidSVG(hostile, colors));
    expect(clean).not.toBeNull();
    const host = document.createElement('div');
    host.innerHTML = '<pre><code class="language-mermaid"></code></pre>';
    const code = host.querySelector('code'); if (code) code.textContent = hostile;
    const context = {
      labels: { copy:'Copy', copied:'Copied', enableCodeWrap:'Wrap', disableCodeWrap:'Unwrap', enableTableWrap:'Wrap', disableTableWrap:'Unwrap', copyTable:'Copy', downloadTable:'Download', copyDiagram:'Copy', downloadDiagram:'Download', zoomInDiagram:'In', zoomOutDiagram:'Out', resetDiagramView:'Reset', previewLabel:'Preview', previewTitle:'Preview' },
      mermaidControls: { copy:true, download:true, showPanZoomControls:true }, codeBlockLineWrap:false, tableCellWrap:false,
      renderMermaid: () => clean ? { svg: clean } : {},
    };
    decorateMarkdown(host, context);
    expect(host.querySelector('[data-md-original-svg]')?.getAttribute('data-md-original-svg')).toBe(clean);
    expect(host.querySelector('svg rect')).not.toBeNull();
    expect(host.querySelector('[data-md-action="mermaid-fit"]')).not.toBeNull();
    const detach = attachMarkdownInteractions(host, context);
    const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
    const downloads: Blob[] = [];
    URL.createObjectURL = blob => { if (blob instanceof Blob) downloads.push(blob); return 'blob:download'; };
    URL.revokeObjectURL = () => {};
    try {
      host.querySelector<HTMLElement>('[data-md-action="mermaid-download"]')?.click();
      const bytes = downloads[0];
      expect(downloads).toHaveLength(1);
      expect(await bytes?.text()).toBe(clean);
    } finally { detach(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
  });
});
