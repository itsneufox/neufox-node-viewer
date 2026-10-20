// neufox's Node Viewer: interface languages. English strings are the keys; `{0}`, `{1}`… are filled in by t().
'use strict';

const I18N_LANGS = { en: 'EN', pt: 'PT' };

const I18N = {
  pt: {
    "neufox's Node Viewer": "neufox's Node Viewer",
    'Filters': 'Filtros',
    'Visibility': 'Visibilidade',
    'Vehicle nodes': 'Nós de veículo',
    'Ped nodes': 'Nós de pedestre',
    'Grid': 'Grade',
    'Interiors (z ≥ 900)': 'Interiores (z ≥ 900)',
    'Area': 'Área',
    'all': 'todas',
    'Z Range': 'Faixa de Z',
    'min': 'mín',
    'max': 'máx',
    'to': 'até',
    'min ({0})': 'mín ({0})',
    'max ({0})': 'máx ({0})',
    'Links': 'Conexões',
    'Vehicle Flags': 'Flags de veículo',
    'match any selected': 'qualquer uma das marcadas',
    'match all selected': 'todas as marcadas',
    'Highway': 'Rodovia',
    'Not highway': 'Não é rodovia',
    'Emergency': 'Emergência',
    'Boat': 'Barco',
    'Parking': 'Estacionamento',
    'Road block': 'Bloqueio',
    'Reset filters': 'Limpar filtros',
    'Veh': 'Veíc',
    'Ped': 'Ped',
    'node #': 'nó #',
    'Go': 'Ir',
    'Reset view': 'Ver mapa todo',
    'Language': 'Idioma',
    'Open GitHub repository': 'Abrir o repositório no GitHub',
    'Node Info': 'Info do nó',
    'Close': 'Fechar',
    'Index': 'Índice',
    'Type': 'Tipo',
    'Sector': 'Setor',
    'Connections': 'Conexões',
    'Flags': 'Flags',
    'Connected nodes': 'Nós conectados',
    'following the damn train...': 'seguindo o maldito trem...',
    'Vehicle': 'Veículo',
    'Pedestrian': 'Pedestre',
    'No connections': 'Sem conexões',
    'Traffic {0}': 'Tráfego {0}',
    'Links: {0}': 'Conexões: {0}',
    'Node types': 'Tipos de nó',
    'Regular road': 'Via comum',
    'Emergency only': 'Só emergência',
    'Boat / water': 'Barco / água',
    'Ped path': 'Caminho de pedestre',
    'Error: {0}': 'Erro: {0}',
    'HERE': 'AQUI',
    'N': 'N', 'NE': 'NE', 'E': 'L', 'SE': 'SE', 'S': 'S', 'SW': 'SO', 'W': 'O', 'NW': 'NO',
  },
};

// Messages that carry a value.
const I18N_PATTERNS = {
  pt: [
    [/^HTTP (\d+)$/, 'HTTP $1'],
  ],
};

let i18nLang = 'en';

function t(text, ...args) {
  let out = text;
  const dict = I18N[i18nLang];
  if (dict) {
    if (Object.prototype.hasOwnProperty.call(dict, text)) out = dict[text];
    else for (const [re, rep] of I18N_PATTERNS[i18nLang] || []) if (re.test(text)) { out = text.replace(re, rep); break; }
  }
  return args.length ? out.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? args[i] : m)) : out;
}

// Static page text: remember each node's English once, translate from that on every switch.
const i18nOriginal = new WeakMap();
const I18N_ATTRS = ['title', 'placeholder', 'aria-label'];

function translatePage(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement && !n.parentElement.closest('script, style, svg, #map, [data-no-i18n]') && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (!i18nOriginal.has(node)) i18nOriginal.set(node, node.nodeValue);
    const en = i18nOriginal.get(node);
    const key = en.trim();
    const lead = en.match(/^\s*/)[0], trail = en.match(/\s*$/)[0];
    node.nodeValue = lead + t(key) + trail;
  }
  for (const el of root.querySelectorAll(I18N_ATTRS.map(a => `[${a}]`).join(','))) {
    if (el.closest('#map, [data-no-i18n]')) continue;
    let saved = i18nOriginal.get(el);
    if (!saved) { saved = {}; for (const a of I18N_ATTRS) if (el.hasAttribute(a)) saved[a] = el.getAttribute(a); i18nOriginal.set(el, saved); }
    for (const [a, en] of Object.entries(saved)) el.setAttribute(a, t(en));
  }
}

function detectLanguage() {
  try {
    const saved = localStorage.getItem('node-viewer-lang');
    if (saved && I18N_LANGS[saved]) return saved;
  } catch { /* storage unavailable */ }
  return (navigator.languages || [navigator.language || 'en']).some(l => /^pt\b/i.test(l)) ? 'pt' : 'en';
}

function setLanguage(lang, onChange) {
  i18nLang = I18N_LANGS[lang] ? lang : 'en';
  document.documentElement.lang = i18nLang === 'pt' ? 'pt-BR' : 'en';
  try { localStorage.setItem('node-viewer-lang', i18nLang); } catch { /* storage unavailable */ }
  translatePage();
  if (onChange) onChange();
}
