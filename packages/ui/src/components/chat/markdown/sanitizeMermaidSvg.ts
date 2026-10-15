import DOMPurify from 'dompurify';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SYSTEM_FONT = 'system-ui, sans-serif';
const MONO_FONT = "'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace";
const BASE_VARIABLES = ['--bg', '--fg', '--line', '--accent', '--muted', '--surface', '--border'];
// These are the installed beautiful-mermaid theme derivations. They do not load fonts.
const DERIVED_VARIABLES = new Map([
  ['--_text', 'var(--fg)'],
  ['--_text-sec', 'var(--muted, color-mix(in srgb, var(--fg) 60%, var(--bg)))'],
  ['--_text-muted', 'var(--muted, color-mix(in srgb, var(--fg) 40%, var(--bg)))'],
  ['--_text-faint', 'color-mix(in srgb, var(--fg) 25%, var(--bg))'],
  ['--_line', 'var(--line, color-mix(in srgb, var(--fg) 50%, var(--bg)))'],
  ['--_arrow', 'var(--accent, color-mix(in srgb, var(--fg) 85%, var(--bg)))'],
  ['--_node-fill', 'var(--surface, color-mix(in srgb, var(--fg) 3%, var(--bg)))'],
  ['--_node-stroke', 'var(--border, color-mix(in srgb, var(--fg) 20%, var(--bg)))'],
  ['--_group-fill', 'var(--bg)'],
  ['--_group-hdr', 'color-mix(in srgb, var(--fg) 5%, var(--bg))'],
  ['--_inner-stroke', 'color-mix(in srgb, var(--fg) 12%, var(--bg))'],
  ['--_key-badge', 'color-mix(in srgb, var(--fg) 10%, var(--bg))'],
]);
const SVG_TAGS = ['svg', 'g', 'defs', 'marker', 'path', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'line', 'text', 'tspan', 'title', 'desc'];
const GEOMETRY_ATTRIBUTES = [
  'id', 'class', 'xmlns', 'viewBox', 'preserveAspectRatio', 'd', 'points', 'transform',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy', 'width', 'height',
  'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY', 'orient',
  'text-anchor', 'dominant-baseline', 'alignment-baseline',
];
const PRESENTATION_ATTRIBUTES = [
  'fill', 'stroke', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'font-size', 'font-weight', 'font-style',
  'font-family', 'text-decoration', 'marker-start', 'marker-mid', 'marker-end',
];
const CANONICAL_ATTRIBUTES = new Map([...GEOMETRY_ATTRIBUTES, ...PRESENTATION_ATTRIBUTES, 'style'].map(name => [name.toLowerCase(), name]));
const SVG_CLASSES = new Set([
  'edge', 'edge-label', 'node', 'subgraph', 'class-node', 'class-relationship', 'mono',
  'activation', 'actor', 'block', 'lifeline', 'message', 'note', 'entity', 'er-relationship',
  'xychart-axis-title', 'xychart-bar', 'xychart-bar-group', 'xychart-dot', 'xychart-dot-group',
  'xychart-grid', 'xychart-hit', 'xychart-label', 'xychart-legend-line', 'xychart-line',
  'xychart-line-shadow', 'xychart-tip', 'xychart-tip-bg', 'xychart-tip-ptr', 'xychart-tip-text', 'xychart-title',
]);
const COLOR_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix']);
const XYCHART_VARIABLE = /^--xychart-(?:color|bar-fill)-\d+$/;
const FIXED_SELECTORS = new Set([
  'svg', 'text', '.mono', '.xychart-grid', '.xychart-bar', '.xychart-line', '.xychart-line-shadow',
  '.xychart-dot', '.xychart-label', '.xychart-axis-title', '.xychart-title',
]);

const hasUnparsedSyntax = (value: string) => value.includes('\\') || value.includes('/*') || value.includes('*/');

/** Replace only validated color variables, then let the platform validate real color syntax. */
function colorExpression(value: string, variables: ReadonlySet<string>, depth = 0): string | null {
  if (depth > 12 || hasUnparsedSyntax(value) || /[^a-z\d_#%.,/()\s+-]/i.test(value)) return null;
  let result = '';
  for (let index = 0; index < value.length;) {
    const start = index;
    if (!/[a-z_-]/i.test(value[index] ?? '')) { result += value[index]; index += 1; continue; }
    while (/[a-z\d_-]/i.test(value[index] ?? '')) index += 1;
    const identifier = value.slice(start, index);
    if (value[index] !== '(') { result += identifier; continue; }
    let level = 1;
    const argumentsStart = ++index;
    let comma = -1;
    while (index < value.length && level > 0) {
      if (value[index] === '(') level += 1;
      else if (value[index] === ')') level -= 1;
      else if (value[index] === ',' && level === 1 && comma < 0) comma = index;
      index += 1;
    }
    if (level !== 0) return null;
    const contents = value.slice(argumentsStart, index - 1);
    if (identifier.toLowerCase() === 'var') {
      const name = (comma < 0 ? contents : value.slice(argumentsStart, comma)).trim();
      if (!variables.has(name)) return null;
      if (comma >= 0 && !isColor(value.slice(comma + 1, index - 1), variables, depth + 1)) return null;
      result += '#000';
    } else {
      if (!COLOR_FUNCTIONS.has(identifier.toLowerCase())) return null;
      const inner = colorExpression(contents, variables, depth + 1);
      if (inner === null) return null;
      result += `${identifier}(${inner})`;
    }
  }
  return result;
}

function isColor(value: string, variables: ReadonlySet<string>, depth = 0): boolean {
  if (/^(?:inherit|initial|unset|revert|revert-layer)$/i.test(value.trim())) return false;
  const parsed = colorExpression(value, variables, depth);
  return parsed !== null && CSS.supports('color', parsed);
}

function rendererSelector(selector: string): boolean {
  return FIXED_SELECTORS.has(selector) || /^(?:\.xychart-bar|path|line|circle)\.xychart-color-\d+$/.test(selector);
}

function readStylesheet(text: string): CSSStyleRule[] {
  // The library's commented theme block is reconstructed from the constants above.
  // No escaped selector/value or comment-spliced value enters the bounded CSS language.
  if (hasUnparsedSyntax(text)) return [];
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  return Array.from(sheet.cssRules).filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
}

function inlineDeclarations(text: string): CSSStyleDeclaration {
  const style = document.createElement('span').style;
  if (!hasUnparsedSyntax(text)) style.cssText = text;
  return style;
}

function safeValue(property: string, value: string, variables: ReadonlySet<string>, ids: ReadonlyMap<string, string>): string | null {
  const trimmed = value.trim();
  if (!trimmed || hasUnparsedSyntax(trimmed)) return null;
  if (property === 'fill' || property === 'stroke') return trimmed === 'none' || isColor(trimmed, variables) ? trimmed : null;
  if (property === 'color' || property === 'background-color' || BASE_VARIABLES.includes(property) || XYCHART_VARIABLE.test(property)) {
    return isColor(trimmed, variables) ? trimmed : null;
  }
  if (property === 'marker-start' || property === 'marker-mid' || property === 'marker-end') {
    if (trimmed === 'none') return trimmed;
    const match = /^url\(\s*(['"]?)#([a-z_][a-z\d_.:-]*)\1\s*\)$/i.exec(trimmed);
    const target = match?.[2] ? ids.get(match[2]) : undefined;
    return target ? `url(#${target})` : null;
  }
  if (property === 'font-family') return SYSTEM_FONT;
  if (property === 'font-style') return /^(?:normal|italic|oblique)$/.test(trimmed) ? trimmed : null;
  if (property === 'font-weight') return /^(?:normal|bold|[1-9]00)$/.test(trimmed) ? trimmed : null;
  if (property === 'stroke-linecap') return /^(?:butt|round|square)$/.test(trimmed) ? trimmed : null;
  if (property === 'stroke-linejoin') return /^(?:miter|round|bevel)$/.test(trimmed) ? trimmed : null;
  if (property === 'pointer-events') return /^(?:none|auto)$/.test(trimmed) ? trimmed : null;
  if (property === 'text-decoration') return /^(?:none|underline|line-through)$/.test(trimmed) ? trimmed : null;
  if (property === 'opacity' || property === 'fill-opacity' || property === 'stroke-opacity') {
    if (!/^(?:\d*\.)?\d+%?$/.test(trimmed)) return null;
    return Number.parseFloat(trimmed) <= (trimmed.endsWith('%') ? 100 : 1) ? trimmed : null;
  }
  if (property === 'stroke-dasharray') return trimmed === 'none' || /^\d+(?:\.\d+)?(?:[ ,]+\d+(?:\.\d+)?)*$/.test(trimmed) ? trimmed : null;
  if (property === 'font-size' || property === 'stroke-width') return /^(?:\d*\.)?\d+(?:px)?$/.test(trimmed) ? trimmed : null;
  if (property === 'stroke-dashoffset') return /^-?(?:\d*\.)?\d+(?:px)?$/.test(trimmed) ? trimmed : null;
  return null;
}

/** Generated beautiful-mermaid SVG only. Parsing or CSSOM failure never returns raw markup. */
export function sanitizeMermaidSvg(svg: string): string | null {
  try {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = parsed.documentElement;
    if (parsed.doctype || parsed.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== SVG_NAMESPACE) return null;
    const rules: CSSStyleRule[] = [];
    const inline = new Map<Element, CSSStyleDeclaration>();
    for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
      if (element !== root && !root.contains(element)) continue;
      if (element.namespaceURI !== SVG_NAMESPACE || element !== root && element.localName === 'svg') { element.remove(); continue; }
      if (element.localName === 'style') { rules.push(...readStylesheet(element.textContent ?? '')); element.remove(); continue; }
      if (!SVG_TAGS.includes(element.localName)) { element.remove(); continue; }
      // XML names are case-sensitive; the later HTML SVG parser folds them.
      // Validate the canonical attribute that the display parser will consume.
      for (const attribute of Array.from(element.attributes)) {
        const canonical = CANONICAL_ATTRIBUTES.get(attribute.name.toLowerCase());
        if (canonical === attribute.name) continue;
        element.removeAttribute(attribute.name);
        if (canonical) element.setAttribute(canonical, attribute.value);
      }
      const style = element.getAttribute('style');
      if (style) inline.set(element, inlineDeclarations(style));
      element.removeAttribute('style');
      const classes = (element.getAttribute('class') ?? '').split(/\s+/).filter(name => SVG_CLASSES.has(name) || /^xychart-color-\d+$/.test(name));
      if (classes.length) element.setAttribute('class', classes.join(' '));
      else element.removeAttribute('class');
    }
    // Exercise the required CSSOM parser even for diagrams without a style block.
    const parser = new CSSStyleSheet();
    parser.replaceSync('');
    const markerIds = new Map<string, string>();
    const allIds = new Set<string>();
    const prefix = `oc-mermaid-${crypto.randomUUID()}-`;
    for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
      const id = element.getAttribute('id');
      if (!id) continue;
      if (!/^[a-z_][a-z\d_.:-]*$/i.test(id) || allIds.has(id)) return null;
      allIds.add(id);
      const rebased = `${prefix}${id}`;
      element.setAttribute('id', rebased);
      if (element.localName === 'marker') markerIds.set(id, rebased);
    }
    const purifier = DOMPurify(window);
    if (!purifier.isSupported) return null;
    purifier.sanitize(root, {
      IN_PLACE: true, ALLOWED_TAGS: SVG_TAGS, ALLOWED_ATTR: [...GEOMETRY_ATTRIBUTES, ...PRESENTATION_ATTRIBUTES],
      ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    });
    const elements = [root, ...Array.from(root.querySelectorAll('*'))];
    const survivingMarkers = new Set(elements.filter(element => element.localName === 'marker').map(element => element.getAttribute('id')));
    for (const [original, rebased] of markerIds) if (!survivingMarkers.has(rebased)) markerIds.delete(original);
    const variables = new Set([...BASE_VARIABLES, ...DERIVED_VARIABLES.keys()]);
    const rootDeclarations = [inline.get(root), ...rules.filter(rule => rule.selectorText.trim() === 'svg').map(rule => rule.style)];
    for (const style of rootDeclarations) {
      if (!style) continue;
      for (let index = 0; index < style.length; index += 1) {
        const property = style.item(index);
        if (XYCHART_VARIABLE.test(property)) variables.add(property);
      }
    }
    const styles = new Map<Element, CSSStyleDeclaration>();
    for (const element of elements) styles.set(element, document.createElement('span').style);
    const rootStyle = styles.get(root);
    if (!rootStyle) return null;
    for (const name of variables) rootStyle.setProperty(name, name === '--bg' ? '#fff' : name === '--fg' ? '#000' : 'initial');
    for (const [name, value] of DERIVED_VARIABLES) rootStyle.setProperty(name, value);
    const apply = (element: Element, declarations: CSSStyleDeclaration) => {
      const target = styles.get(element);
      if (!target) return;
      for (let index = 0; index < declarations.length; index += 1) {
        const originalProperty = declarations.item(index);
        const property = originalProperty === 'background' ? 'background-color' : originalProperty;
        if (DERIVED_VARIABLES.has(property) || property.startsWith('--') && (element !== root || !variables.has(property))) continue;
        const value = safeValue(property, declarations.getPropertyValue(originalProperty), variables, markerIds);
        if (value !== null) target.setProperty(property, value);
      }
    };
    for (const rule of rules) {
      for (const selector of rule.selectorText.split(',').map(part => part.trim()).filter(rendererSelector)) {
        const matches = selector === 'svg' ? [root] : Array.from(root.querySelectorAll(selector));
        for (const element of matches) apply(element, rule.style);
      }
    }
    for (const element of elements) {
      for (const attribute of PRESENTATION_ATTRIBUTES) {
        const value = element.getAttribute(attribute);
        if (value === null) continue;
        const clean = safeValue(attribute, value, variables, markerIds);
        if (clean === null) element.removeAttribute(attribute);
        else element.setAttribute(attribute, clean);
      }
      const declarations = inline.get(element);
      if (declarations) apply(element, declarations);
      const style = styles.get(element);
      if (!style) continue;
      if (element.localName === 'text') style.setProperty('font-family', element.classList.contains('mono') ? MONO_FONT : SYSTEM_FONT);
      if (style.length) element.setAttribute('style', style.cssText);
    }
    return new XMLSerializer().serializeToString(root);
  } catch {
    return null;
  }
}
