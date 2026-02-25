const SA_BOUNDS = [[-3000, -3000], [3000, 3000]];

const FLAG_ROADBLOCK    = 1 << 6;
const FLAG_BOAT         = 1 << 7;
const FLAG_EMERGENCY    = 1 << 8;
const FLAG_NOT_HIGHWAY  = 1 << 12;
const FLAG_HIGHWAY      = 1 << 13;
const FLAG_PARKING      = 1 << 21;
const VEH_FLAG_FILTERS = [
  ['flag-highway', FLAG_HIGHWAY],
  ['flag-not-highway', FLAG_NOT_HIGHWAY],
  ['flag-emergency', FLAG_EMERGENCY],
  ['flag-boat', FLAG_BOAT],
  ['flag-parking', FLAG_PARKING],
  ['flag-roadblock', FLAG_ROADBLOCK],
];
const IDX_X = 0;
const IDX_Y = 1;
const IDX_Z = 2;
const IDX_AREA = 3;
const IDX_V_FLAGS = 4;
const IDX_V_ADJ = 5;
const IDX_P_ADJ = 4;
const INTERIOR_Z_MIN = 900;
const HOVER_TOOLTIP_MIN_ZOOM = 1;

function getVehColor(flags, alpha = 1) {
  if (flags & FLAG_BOAT)      return `rgba(34,211,238,${alpha})`;
  if (flags & FLAG_EMERGENCY) return `rgba(248,113,113,${alpha})`;
  if (flags & FLAG_HIGHWAY)   return `rgba(96,165,250,${alpha})`;
  if (flags & FLAG_PARKING)   return `rgba(251,191,36,${alpha})`;
  return `rgba(74,222,128,${alpha})`;
}

const SELECTED_LINK_COLORS = [

  '#d32f2f', // red
  '#1e88e5', // blue
  '#fbc02d', // yellow
  '#2e7d32', // green
  '#f57c00', // orange
  '#8e24aa', // purple
  '#00838f', // cyan
  '#c2185b', // magenta
  '#5e35b1', // indigo
  '#00695c', // deep teal-green
  '#6d4c41', // brown
  '#ffffff', // white fallback/high contrast
];

function hexToRgba(hex, alpha) {
  const s = String(hex || '').trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
  if (!m) return `rgba(249,115,22,${alpha})`;
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

let map, nodeLayer, gridLayer;
let nodesV = [], nodesP = [];
let nodesVByArea = [];
let nodesPByArea = [];
let showVeh = true, showPed = true;
let filterArea  = -1;
let filterZMin = null;
let filterZMax = null;
let filterLinksMin = null;
let filterLinksMax = null;
let filterVehFlagMask = 0;
let filterVehFlagMode = 'any';
let showInteriors = false;
let showGrid    = true;
let selectedType = null, selectedIdx = -1;
let hoverRafId = null;
let hoverPendingPoint = null;

function initMap() {
  map = L.map('map', {
    crs: L.CRS.Simple,
    center: [0, 0],
    zoom: 1,
    minZoom: -3,
    maxZoom: 6,
    zoomControl: true,
    attributionControl: false,
  });

  L.imageOverlay('samap.png', SA_BOUNDS).addTo(map);
  map.fitBounds(SA_BOUNDS);

  map.on('mousemove', e => {
    const { lat, lng } = e.latlng;
    document.getElementById('coords-display').textContent =
      `x: ${lng.toFixed(1)}  y: ${lat.toFixed(1)}`;
    scheduleHoverTooltip(e);
  });
  map.on('mouseout', hideHoverTooltip);
  map.on('zoomstart', hideHoverTooltip);
  map.on('movestart', hideHoverTooltip);

  map.on('click', onMapClick);

  return map;
}

function buildAreaIndex(nodes) {
  const buckets = Array.from({ length: 64 }, () => []);
  for (let i = 0; i < nodes.length; i++) {
    const area = nodes[i][IDX_AREA];
    if (area >= 0 && area < 64) buckets[area].push(i);
  }
  return buckets;
}

function getVisibleAreas(bounds, pad = 0) {
  if (filterArea !== -1) return [filterArea];

  const south = bounds.getSouth() - pad;
  const north = bounds.getNorth() + pad;
  const west = bounds.getWest() - pad;
  const east = bounds.getEast() + pad;

  if (east < -3000 || west > 3000 || north < -3000 || south > 3000) return [];

  const minCol = Math.max(0, Math.min(7, Math.floor((west + 3000) / 750)));
  const maxCol = Math.max(0, Math.min(7, Math.floor((east + 3000) / 750)));
  const minRow = Math.max(0, Math.min(7, Math.floor((south + 3000) / 750)));
  const maxRow = Math.max(0, Math.min(7, Math.floor((north + 3000) / 750)));

  const areas = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      areas.push(row * 8 + col);
    }
  }
  return areas;
}

function getNodeLinkCount(node, isVeh) {
  const adj = isVeh ? node[IDX_V_ADJ] : node[IDX_P_ADJ];
  return adj ? adj.length : 0;
}

function findNearestVisibleNode(containerPoint, snapPx) {
  if (!map) return null;
  const bounds = map.getBounds();
  const pad = 100;
  const south = bounds.getSouth() - pad, north = bounds.getNorth() + pad;
  const west  = bounds.getWest()  - pad, east  = bounds.getEast()  + pad;
  const snapSq = snapPx * snapPx;
  const visibleAreas = getVisibleAreas(bounds, pad);

  let bestSq = Infinity;
  let bestType = null;
  let bestIdx = -1;

  const search = (nodes, type) => {
    const areaBuckets = type === 'v' ? nodesVByArea : nodesPByArea;
    for (const area of visibleAreas) {
      const bucket = areaBuckets[area];
      if (!bucket || !bucket.length) continue;
      for (const i of bucket) {
        const n = nodes[i];
        if (n[IDX_Y] < south || n[IDX_Y] > north || n[IDX_X] < west || n[IDX_X] > east) continue;
        if (!passesNodeFilters(n, type === 'v')) continue;
        const pt = map.latLngToContainerPoint([n[IDX_Y], n[IDX_X]]);
        const dx = pt.x - containerPoint.x;
        const dy = pt.y - containerPoint.y;
        const d = dx * dx + dy * dy;
        if (d < bestSq) { bestSq = d; bestType = type; bestIdx = i; }
      }
    }
  };

  if (showVeh) search(nodesV, 'v');
  if (showPed) search(nodesP, 'p');

  if (bestIdx < 0 || bestSq > snapSq) return null;
  return { type: bestType, idx: bestIdx, distSq: bestSq };
}

function passesNodeFilters(node, isVeh) {
  const z = node[IDX_Z];
  if (!showInteriors && z >= INTERIOR_Z_MIN) return false;
  if (filterZMin !== null && z < filterZMin) return false;
  if (filterZMax !== null && z > filterZMax) return false;
  const links = getNodeLinkCount(node, isVeh);
  if (filterLinksMin !== null && links < filterLinksMin) return false;
  if (filterLinksMax !== null && links > filterLinksMax) return false;
  if (isVeh && filterVehFlagMask) {
    const flags = node[IDX_V_FLAGS];
    if (filterVehFlagMode === 'all') {
      if ((flags & filterVehFlagMask) !== filterVehFlagMask) return false;
    } else if ((flags & filterVehFlagMask) === 0) {
      return false;
    }
  }
  return true;
}

function getZRange(nodes) {
  if (!nodes.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const node of nodes) {
    const z = node[IDX_Z];
    if (z < min) min = z;
    if (z > max) max = z;
  }
  return Number.isFinite(min) ? { min, max } : null;
}

function getLinkRange(nodes, isVeh) {
  if (!nodes.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const node of nodes) {
    const links = getNodeLinkCount(node, isVeh);
    if (links < min) min = links;
    if (links > max) max = links;
  }
  return Number.isFinite(min) ? { min, max } : null;
}

function updateFiltersBadge() {
  const badge = document.getElementById('filters-active');
  if (!badge) return;
  let count = 0;
  if (filterArea !== -1) count++;
  if (showInteriors) count++;
  if (filterZMin !== null || filterZMax !== null) count++;
  if (filterLinksMin !== null || filterLinksMax !== null) count++;
  if (filterVehFlagMask !== 0) count++;
  badge.textContent = `${count}`;
  badge.classList.toggle('hidden', count === 0);
}

const NodeLayer = L.Layer.extend({
  onAdd(map) {
    this._map    = map;
    this._rafId  = null;
    this._drawTimer = null;
    this._drawZoom = map.getZoom();
    this._drawTopLeftLatLng = null;
    this._canvas = document.createElement('canvas');
    this._ctx = this._canvas.getContext('2d');
    this._canvas.className = 'node-canvas leaflet-zoom-animated';
    map.getPanes().overlayPane.appendChild(this._canvas);
    map.on('resize', this._schedule, this);
    map.on('move', this._scheduleMove, this);
    map.on('moveend', this._schedule, this);
    map.on('zoomstart', this._onZoomStart, this);
    map.on('zoomanim', this._onZoomAnim, this);
    map.on('zoomend', this._onZoomEnd, this);
    this.draw();
  },

  onRemove(map) {
    map.off('resize', this._schedule, this);
    map.off('move', this._scheduleMove, this);
    map.off('moveend', this._schedule, this);
    map.off('zoomstart', this._onZoomStart, this);
    map.off('zoomanim', this._onZoomAnim, this);
    map.off('zoomend', this._onZoomEnd, this);
    if (this._drawTimer) {
      clearTimeout(this._drawTimer);
      this._drawTimer = null;
    }
    this._canvas.remove();
  },

  _schedule(delay = 0) {
    if (typeof delay !== 'number') delay = 0;
    if (this._map._animatingZoom) return;
    if (this._drawTimer) {
      clearTimeout(this._drawTimer);
      this._drawTimer = null;
    }
    if (delay > 0) {
      this._drawTimer = setTimeout(() => {
        this._drawTimer = null;
        this._schedule(0);
      }, delay);
      return;
    }
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this.draw();
    });
  },

  _scheduleMove() {
    this._schedule(24);
  },

  _onZoomStart() {
    if (this._drawTimer) {
      clearTimeout(this._drawTimer);
      this._drawTimer = null;
    }
  },

  _onZoomEnd() {
    this._schedule(0);
  },

  _onZoomAnim(e) {
    if (!this._drawTopLeftLatLng) return;
    const scale = this._map.getZoomScale(e.zoom, this._drawZoom);
    const topLeft = this._map._latLngToNewLayerPoint(this._drawTopLeftLatLng, e.zoom, e.center);
    L.DomUtil.setTransform(this._canvas, topLeft, scale);
  },

  draw() {
    if (this._map._animatingZoom) return;

    const map    = this._map;
    const size   = map.getSize();
    const canvas = this._canvas;

    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, topLeft);
    if (canvas.width !== size.x) canvas.width = size.x;
    if (canvas.height !== size.y) canvas.height = size.y;

    const ctx  = this._ctx;
    ctx.clearRect(0, 0, size.x, size.y);

    const zoom   = map.getZoom();
    this._drawZoom = zoom;
    this._drawTopLeftLatLng = map.layerPointToLatLng(topLeft);
    const r      = Math.max(1.5, Math.min(5, zoom + 3));
    const bounds = map.getBounds();
    const south  = bounds.getSouth(), north = bounds.getNorth();
    const west   = bounds.getWest(),  east  = bounds.getEast();
    const PAD    = 50;
    const visibleAreas = getVisibleAreas(bounds, PAD);
    const scale  = map.options.crs.scale(zoom);
    const origin = map.getPixelOrigin();
    const pane   = map._getMapPanePos();
    const offX   = -origin.x + pane.x;
    const offY   = -origin.y + pane.y;
    const toX    = (sa_x) =>  scale * sa_x + offX;
    const toY    = (sa_y) => -scale * sa_y + offY;

    const collectGroups = (nodes, areaBuckets, isVeh) => {
      const groups = new Map();

      for (const area of visibleAreas) {
        const bucket = areaBuckets[area];
        if (!bucket || !bucket.length) continue;
        for (const i of bucket) {
          const node = nodes[i];
          const nx = node[IDX_X], ny = node[IDX_Y];
          if (ny < south - PAD || ny > north + PAD) continue;
          if (nx < west  - PAD || nx > east  + PAD) continue;
          if (!passesNodeFilters(node, isVeh)) continue;
          const color = isVeh ? getVehColor(node[IDX_V_FLAGS]) : 'rgba(167,139,250,1)';
          if (!groups.has(color)) groups.set(color, []);
          groups.get(color).push(i);
        }
      }
      return groups;
    };

    const drawConnections = (nodes, isVeh, groups) => {
      if (zoom < -1 || !groups) return;
      ctx.lineWidth = Math.max(0.5, r * 0.4);
      for (const [color, indices] of groups) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (const i of indices) {
          const node = nodes[i];
          const px = toX(node[IDX_X]), py = toY(node[IDX_Y]);
          const adj = isVeh ? node[IDX_V_ADJ] : node[IDX_P_ADJ];
          if (!adj || !adj.length) continue;
          for (const nidx of adj) {
            const nb = nodes[nidx];
            if (!nb) continue;
            ctx.moveTo(px, py);
            ctx.lineTo(toX(nb[IDX_X]), toY(nb[IDX_Y]));
          }
        }
        ctx.stroke();
      }
    };

    const drawNodes = (nodes, groups) => {
      if (!groups) return;
      for (const [color, indices] of groups) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (const i of indices) {
          const node = nodes[i];
          const px = toX(node[IDX_X]), py = toY(node[IDX_Y]);
          ctx.moveTo(px + r, py);
          ctx.arc(px, py, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      if (r >= 3) {
        const ir = r * 0.42;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        for (const indices of groups.values()) {
          for (const i of indices) {
            const node = nodes[i];
            const px = toX(node[IDX_X]), py = toY(node[IDX_Y]);
            ctx.moveTo(px + ir, py);
            ctx.arc(px, py, ir, 0, Math.PI * 2);
          }
        }
        ctx.fill();
      }
    };

    const pedGroups = (showPed && nodesP.length) ? collectGroups(nodesP, nodesPByArea, false) : null;
    const vehGroups = (showVeh && nodesV.length) ? collectGroups(nodesV, nodesVByArea, true) : null;

    drawConnections(nodesP, false, pedGroups);
    drawConnections(nodesV, true, vehGroups);
    drawNodes(nodesP, pedGroups);
    drawNodes(nodesV, vehGroups);

    if (selectedIdx >= 0) {
      const nodes = selectedType === 'v' ? nodesV : nodesP;
      const sel   = nodes[selectedIdx];
      if (!sel || !passesNodeFilters(sel, selectedType === 'v')) return;
      const selPx = toX(sel[IDX_X]), selPy = toY(sel[IDX_Y]);
      const selectedNeighbors = getSortedNeighborEntries(selectedType, selectedIdx);

      ctx.lineWidth   = Math.max(1, r * 0.8);
      ctx.lineCap     = 'round';

      for (const { nb, color } of selectedNeighbors) {
        const nbPx = toX(nb[IDX_X]), nbPy = toY(nb[IDX_Y]);

        ctx.strokeStyle = 'rgba(0,0,0,0.82)';
        ctx.lineWidth = Math.max(2.8, r * 1.55);
        ctx.beginPath();
        ctx.moveTo(selPx, selPy);
        ctx.lineTo(nbPx, nbPy);
        ctx.stroke();

        ctx.strokeStyle = hexToRgba(color, 0.9);
        ctx.lineWidth = Math.max(1.4, r * 0.82);
        ctx.beginPath();
        ctx.moveTo(selPx, selPy);
        ctx.lineTo(nbPx, nbPy);
        ctx.stroke();

        const dx = nbPx - selPx, dy = nbPy - selPy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 1) {
          const ux = dx / len, uy = dy / len;
          const ax = nbPx - ux * (r + 4), ay = nbPy - uy * (r + 4);
          const perp = Math.min(4, len * 0.2);
          ctx.fillStyle = hexToRgba(color, 0.95);
          ctx.beginPath();
          ctx.moveTo(nbPx - ux * (r * 2 + 3), nbPy - uy * (r * 2 + 3));
          ctx.lineTo(ax - uy * perp, ay + ux * perp);
          ctx.lineTo(ax + uy * perp, ay - ux * perp);
          ctx.closePath();
          ctx.fill();
        }

        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.beginPath();
        ctx.arc(nbPx, nbPy, r + 3.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = hexToRgba(color, 0.82);
        ctx.beginPath();
        ctx.arc(nbPx, nbPy, r + 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#f97316';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(selPx, selPy, r + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
});

function hideHoverTooltip() {
  const el = document.getElementById('hover-tooltip');
  if (!el) return;
  el.classList.add('hidden');
}

function updateHoverTooltip(containerPoint, hit) {
  const el = document.getElementById('hover-tooltip');
  const wrap = document.getElementById('map-wrap');
  if (!el || !wrap || !hit) return;

  const nodes = hit.type === 'v' ? nodesV : nodesP;
  const node = nodes[hit.idx];
  if (!node) return;
  const [x, y, z, area] = node;

  el.textContent = `${hit.type === 'v' ? 'V' : 'P'} #${hit.idx} (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}) A${area}`;
  el.classList.remove('hidden');

  const wrapRect = wrap.getBoundingClientRect();
  const tipRect = el.getBoundingClientRect();
  const margin = 10;
  let left = containerPoint.x + 14;
  let top = containerPoint.y + 14;
  if (left + tipRect.width > wrapRect.width - margin) left = containerPoint.x - tipRect.width - 14;
  if (top + tipRect.height > wrapRect.height - margin) top = containerPoint.y - tipRect.height - 14;
  left = Math.max(margin, Math.min(wrapRect.width - tipRect.width - margin, left));
  top = Math.max(margin, Math.min(wrapRect.height - tipRect.height - margin, top));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function scheduleHoverTooltip(e) {
  if (!nodeLayer || !map) return;
  hoverPendingPoint = { x: e.containerPoint.x, y: e.containerPoint.y };
  if (hoverRafId) return;

  hoverRafId = requestAnimationFrame(() => {
    hoverRafId = null;
    const pt = hoverPendingPoint;
    if (!pt || map._animatingZoom || map.getZoom() < HOVER_TOOLTIP_MIN_ZOOM) {
      hideHoverTooltip();
      return;
    }
    const snapPx = Math.max(10, 22 - map.getZoom() * 1.5);
    const hit = findNearestVisibleNode(pt, snapPx);
    if (!hit) {
      hideHoverTooltip();
      return;
    }
    updateHoverTooltip(pt, hit);
  });
}

function onMapClick(e) {
  const SNAP_PX  = Math.max(14, 28 - map.getZoom() * 2);
  const hit = findNearestVisibleNode(e.containerPoint, SNAP_PX);
  if (!hit) {
    clearSelection();
    return;
  }

  selectNode(hit.type, hit.idx);
}

function selectNode(type, idx, panTo = false) {
  selectedType = type;
  selectedIdx  = idx;
  if (panTo) {
    const node = type === 'v' ? nodesV[idx] : nodesP[idx];
    map.setView([node[IDX_Y], node[IDX_X]], Math.max(map.getZoom(), 2), { animate: true });
  }
  nodeLayer.draw();
  showPanel(type, idx);
}

function clearSelection(redraw = true) {
  selectedType = null;
  selectedIdx  = -1;
  if (redraw && nodeLayer) nodeLayer.draw();
  hidePanel();
}

function fitPanelHeightToContent() {
  const panel = document.getElementById('panel');
  if (!panel || panel.classList.contains('hidden')) return;

  const header = panel.querySelector('.panel-header');
  const body = panel.querySelector('.panel-body');
  const root = document.getElementById('ui');
  if (!header || !body || !root) return;

  const panelRect = panel.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const topInRoot = panelRect.top - rootRect.top;
  const maxHeight = Math.max(120, rootRect.height - topInRoot - 8);
  const bodyStyles = getComputedStyle(body);
  const bodyPadY =
    (parseFloat(bodyStyles.paddingTop) || 0) +
    (parseFloat(bodyStyles.paddingBottom) || 0);
  let bodyContentHeight = 0;
  for (const child of body.children) {
    const cs = getComputedStyle(child);
    bodyContentHeight += child.offsetHeight;
    bodyContentHeight += (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
  }
  const desired = Math.ceil(header.offsetHeight + bodyPadY + bodyContentHeight + 2);
  const baseMin = 220;
  const requiredHeight = Math.min(maxHeight, Math.max(baseMin, desired));

  panel.style.maxHeight = `${Math.floor(maxHeight)}px`;
  panel.style.minHeight = `${Math.floor(requiredHeight)}px`;

  if (panelRect.height < requiredHeight - 1) {
    panel.style.height = `${Math.floor(requiredHeight)}px`;
  }
}

function getNeighborDirection(dx, dy) {
  if (Math.hypot(dx, dy) < 0.001) return { arrow: '•', cardinal: 'HERE', bearing: 0, bucket: -1 };

  const angleFromEast = Math.atan2(dy, dx) * (180 / Math.PI);
  const bearing = (90 - angleFromEast + 360) % 360; // clockwise from North
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  const idx = Math.round(bearing / 45) % 8;
  return { arrow: arrows[idx], cardinal: dirs[idx], bearing, bucket: idx };
}

function getSortedNeighborEntries(type, idx) {
  const nodes = type === 'v' ? nodesV : nodesP;
  const node = nodes[idx];
  if (!node) return [];
  const [x, y] = node;
  const adj = type === 'v' ? node[IDX_V_ADJ] : node[IDX_P_ADJ];
  if (!adj || !adj.length) return [];

  const neighbors = [];
  for (const nidx of adj) {
    const nb = nodes[nidx];
    if (!nb) continue;
    const dx = nb[IDX_X] - x;
    const dy = nb[IDX_Y] - y;
    const dir = getNeighborDirection(dx, dy);
    neighbors.push({ nidx, nb, dir });
  }

  neighbors.sort((a, b) => {
    const bucketDiff = a.dir.bucket - b.dir.bucket;
    if (bucketDiff !== 0) return bucketDiff;
    const d = a.dir.bearing - b.dir.bearing;
    if (Math.abs(d) > 0.0001) return d;
    return a.nidx - b.nidx;
  });

  for (let i = 0; i < neighbors.length; i++) {
    neighbors[i].color = SELECTED_LINK_COLORS[i % SELECTED_LINK_COLORS.length];
  }
  return neighbors;
}

function showPanel(type, idx) {
  const node    = type === 'v' ? nodesV[idx] : nodesP[idx];
  const [x, y, z, area] = node;
  const flags   = type === 'v' ? node[IDX_V_FLAGS] : null;
  const adj     = type === 'v' ? node[IDX_V_ADJ] : node[IDX_P_ADJ];

  const sectorCol = area % 8;
  const sectorRow = Math.floor(area / 8);
  const sectorX   = -3000 + sectorCol * 750;
  const sectorY   = -3000 + sectorRow * 750;

  document.getElementById('info-idx').textContent    = idx;
  document.getElementById('info-type').textContent   = type === 'v' ? 'Vehicle' : 'Pedestrian';
  document.getElementById('info-area').textContent   = `${area}`;
  document.getElementById('info-x').textContent      = x.toFixed(1);
  document.getElementById('info-y').textContent      = y.toFixed(1);
  document.getElementById('info-z').textContent      = z.toFixed(1);
  document.getElementById('info-sector').textContent =
    `(${sectorX} → ${sectorX+750}, ${sectorY} → ${sectorY+750})`;
  document.getElementById('info-links').textContent  = adj ? adj.length : 0;

  if (flags !== null) {
    document.getElementById('info-flags').textContent = `0x${flags.toString(16).toUpperCase().padStart(8,'0')}`;
    document.getElementById('info-flags').parentElement.style.display = '';
    renderFlagTags(flags);
  } else {
    document.getElementById('info-flags').parentElement.style.display = 'none';
    document.getElementById('flag-tags').innerHTML = '';
  }

  const nl = document.getElementById('neighbor-list');
  nl.innerHTML = '';
  if (adj && adj.length) {
    for (const { nidx, nb, dir, color } of getSortedNeighborEntries(type, idx)) {
      const dirStyle =
        `--nb-dir-color:${color};` +
        `--nb-dir-bg:${hexToRgba(color, 0.14)};` +
        `--nb-dir-border:${hexToRgba(color, 0.34)};`;
      const btn = document.createElement('button');
      btn.className = 'neighbor-btn';
      btn.style.setProperty('--nb-link-color', color);
      btn.innerHTML =
        `<span class="nb-idx">#${nidx}</span>` +
        `<span class="nb-coords">(${nb[IDX_X].toFixed(0)}, ${nb[IDX_Y].toFixed(0)}, ${nb[IDX_Z].toFixed(0)})</span>` +
        `<span class="nb-area">A${nb[IDX_AREA]}</span>` +
        `<span class="nb-dir" style="${dirStyle}">${dir.arrow} ${dir.cardinal}</span>`;
      btn.addEventListener('click', () => selectNode(type, nidx, true));
      nl.appendChild(btn);
    }
  } else {
    nl.innerHTML = '<div style="color:var(--muted);font-size:12px">No connections</div>';
  }

  document.getElementById('panel').classList.remove('hidden');
  fitPanelHeightToContent();
}

function renderFlagTags(flags) {
  const defs = [
    { label: 'Highway',       bit: FLAG_HIGHWAY,    active: !!(flags & FLAG_HIGHWAY) },
    { label: 'Not highway',   bit: FLAG_NOT_HIGHWAY,active: !!(flags & FLAG_NOT_HIGHWAY) },
    { label: 'Emergency',     bit: FLAG_EMERGENCY,  active: !!(flags & FLAG_EMERGENCY) },
    { label: 'Boat',          bit: FLAG_BOAT,       active: !!(flags & FLAG_BOAT) },
    { label: 'Parking',       bit: FLAG_PARKING,    active: !!(flags & FLAG_PARKING) },
    { label: 'Road block',    bit: FLAG_ROADBLOCK,  active: !!(flags & FLAG_ROADBLOCK) },
    { label: `Traffic ${(flags >> 4) & 0x3}`,  bit: -1, active: true },
    { label: `Links: ${flags & 0xF}`, bit: -1, active: true },
  ];

  const el = document.getElementById('flag-tags');
  el.innerHTML = defs.map(d =>
    `<span class="flag-tag${d.active && d.bit !== -1 ? ' active' : ''}">${d.label}</span>`
  ).join('');
}

function hidePanel() {
  document.getElementById('panel').classList.add('hidden');
}

function initPanelDrag() {
  const panel = document.getElementById('panel');
  const header = panel.querySelector('.panel-header');
  const root = document.getElementById('ui');

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  let pointerId = null;

  const clampToRoot = () => {
    if (panel.classList.contains('hidden')) return;
    const rootRect = root.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(0, rootRect.width - rect.width);
    const maxTop = Math.max(0, rootRect.height - rect.height);
    const left = rect.left - rootRect.left;
    const top = rect.top - rootRect.top;
    const clampedLeft = Math.max(0, Math.min(maxLeft, left));
    const clampedTop = Math.max(0, Math.min(maxTop, top));
    panel.style.left = `${clampedLeft}px`;
    panel.style.top = `${clampedTop}px`;
    panel.style.right = 'auto';
    fitPanelHeightToContent();
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    if (pointerId !== null && e.pointerId !== pointerId) return;
    const rootRect = root.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const maxLeft = Math.max(0, rootRect.width - panelRect.width);
    const maxTop = Math.max(0, rootRect.height - panelRect.height);
    const left = e.clientX - rootRect.left - offsetX;
    const top = e.clientY - rootRect.top - offsetY;
    panel.style.left = `${Math.max(0, Math.min(maxLeft, left))}px`;
    panel.style.top = `${Math.max(0, Math.min(maxTop, top))}px`;
    panel.style.right = 'auto';
  };

  const stopDrag = (e) => {
    if (!dragging) return;
    if (e && pointerId !== null && e.pointerId !== pointerId) return;
    dragging = false;
    if (pointerId !== null) {
      try { header.releasePointerCapture(pointerId); } catch {}
    }
    pointerId = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
    fitPanelHeightToContent();
  };

  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('#panel-close')) return;
    const rootRect = root.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${rect.left - rootRect.left}px`;
    panel.style.top = `${rect.top - rootRect.top}px`;
    panel.style.right = 'auto';
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    dragging = true;
    pointerId = e.pointerId;
    try { header.setPointerCapture(pointerId); } catch {}
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    e.preventDefault();
  });

  window.addEventListener('resize', clampToRoot);

  const updatePanelFontScale = () => {
    const w = panel.getBoundingClientRect().width || 280;
    const scale = Math.max(1, Math.min(1.3, 1 + ((w - 280) / 800)));
    panel.style.setProperty('--panel-font-scale', scale.toFixed(3));
  };

  updatePanelFontScale();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      updatePanelFontScale();
      fitPanelHeightToContent();
    });
    ro.observe(panel);
  }
}

function buildGridLayer() {
  const lines = [];
  for (let col = 0; col <= 8; col++) {
    const x = -3000 + col * 750;
    lines.push(L.polyline([[-3000, x], [3000, x]], {
      color: 'rgba(255,255,255,0.25)', weight: 1, interactive: false
    }));
  }
  for (let row = 0; row <= 8; row++) {
    const y = -3000 + row * 750;
    lines.push(L.polyline([[y, -3000], [y, 3000]], {
      color: 'rgba(255,255,255,0.25)', weight: 1, interactive: false
    }));
  }
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const area = row * 8 + col;
      const cy = -3000 + row * 750 + 375;
      const cx = -3000 + col * 750 + 375;
      lines.push(L.marker([cy, cx], {
        interactive: false,
        icon: L.divIcon({
          className: 'sector-label',
          html: `<span>${area}</span>`,
          iconSize: [40, 20],
          iconAnchor: [20, 10],
        })
      }));
    }
  }
  return L.layerGroup(lines);
}

function initControls() {
  const redrawFiltered = () => {
    clearSelection(false);
    if (nodeLayer) nodeLayer.draw();
    updateFiltersBadge();
  };

  const parseNullableFloat = (value) => {
    const s = value.trim();
    if (s === '') return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };

  const parseNullableInt = (value) => {
    const s = value.trim();
    if (s === '') return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  };

  const zMinEl = document.getElementById('filter-z-min');
  const zMaxEl = document.getElementById('filter-z-max');
  const linksMinEl = document.getElementById('filter-links-min');
  const linksMaxEl = document.getElementById('filter-links-max');
  const flagModeEl = document.getElementById('filter-flag-mode');
  const flagInputs = VEH_FLAG_FILTERS.map(([id, bit]) => ({ el: document.getElementById(id), bit }));
  const areaEl = document.getElementById('filter-area');
  const interiorOnlyEl = document.querySelector('#toggle-interiors input');

  const applyAdvancedFilters = () => {
    const nextZMin = parseNullableFloat(zMinEl.value);
    const nextZMax = parseNullableFloat(zMaxEl.value);
    const nextLinksMin = parseNullableInt(linksMinEl.value);
    const nextLinksMax = parseNullableInt(linksMaxEl.value);

    const zInvalid = nextZMin !== null && nextZMax !== null && nextZMin > nextZMax;
    const linksInvalid =
      (nextLinksMin !== null && nextLinksMin < 0) ||
      (nextLinksMax !== null && nextLinksMax < 0) ||
      (nextLinksMin !== null && nextLinksMax !== null && nextLinksMin > nextLinksMax);

    zMinEl.style.borderColor = zInvalid ? '#f87171' : '';
    zMaxEl.style.borderColor = zInvalid ? '#f87171' : '';
    linksMinEl.style.borderColor = linksInvalid ? '#f87171' : '';
    linksMaxEl.style.borderColor = linksInvalid ? '#f87171' : '';
    if (zInvalid || linksInvalid) return;

    filterZMin = nextZMin;
    filterZMax = nextZMax;
    filterLinksMin = nextLinksMin;
    filterLinksMax = nextLinksMax;
    filterVehFlagMode = flagModeEl.value === 'all' ? 'all' : 'any';
    let mask = 0;
    for (const { el, bit } of flagInputs) {
      if (el.checked) mask |= bit;
    }
    filterVehFlagMask = mask;

    redrawFiltered();
  };

  document.querySelector('#toggle-veh input').addEventListener('change', e => {
    showVeh = e.target.checked;
    nodeLayer.draw();
    updateLegend();
  });

  document.querySelector('#toggle-ped input').addEventListener('change', e => {
    showPed = e.target.checked;
    nodeLayer.draw();
    updateLegend();
  });

  interiorOnlyEl.addEventListener('change', e => {
    showInteriors = e.target.checked;
    redrawFiltered();
  });

  areaEl.addEventListener('change', e => {
    filterArea = parseInt(e.target.value, 10);
    if (filterArea >= 0) {
      const col = filterArea % 8;
      const row = Math.floor(filterArea / 8);
      const cx  = -3000 + col * 750 + 375;
      const cy  = -3000 + row * 750 + 375;
      map.setView([cy, cx], 2, { animate: true });
    }
    redrawFiltered();
  });
  zMinEl.addEventListener('input', applyAdvancedFilters);
  zMaxEl.addEventListener('input', applyAdvancedFilters);
  linksMinEl.addEventListener('input', applyAdvancedFilters);
  linksMaxEl.addEventListener('input', applyAdvancedFilters);
  flagModeEl.addEventListener('change', applyAdvancedFilters);
  for (const { el } of flagInputs) el.addEventListener('change', applyAdvancedFilters);

  document.getElementById('btn-reset-filters').addEventListener('click', () => {
    areaEl.value = '-1';
    zMinEl.value = '';
    zMaxEl.value = '';
    linksMinEl.value = '';
    linksMaxEl.value = '';
    flagModeEl.value = 'any';
    for (const { el } of flagInputs) el.checked = false;
    interiorOnlyEl.checked = false;

    filterArea = -1;
    showInteriors = false;
    filterZMin = null;
    filterZMax = null;
    filterLinksMin = null;
    filterLinksMax = null;
    filterVehFlagMask = 0;
    filterVehFlagMode = 'any';

    zMinEl.style.borderColor = '';
    zMaxEl.style.borderColor = '';
    linksMinEl.style.borderColor = '';
    linksMaxEl.style.borderColor = '';

    redrawFiltered();
  });

  document.querySelector('#toggle-grid input').addEventListener('change', e => {
    showGrid = e.target.checked;
    if (showGrid) {
      gridLayer = buildGridLayer();
      gridLayer.addTo(map);
    } else if (gridLayer) {
      gridLayer.remove();
      gridLayer = null;
    }
  });
  if (showGrid && !gridLayer) {
    gridLayer = buildGridLayer();
    gridLayer.addTo(map);
  }

  document.getElementById('btn-reset').addEventListener('click', () => {
    map.fitBounds(SA_BOUNDS);
    clearSelection();
  });

  function goToNode() {
    const type  = document.getElementById('search-type').value;
    const idx   = parseInt(document.getElementById('search-input').value, 10);
    const nodes = type === 'v' ? nodesV : nodesP;
    if (isNaN(idx) || idx < 0 || idx >= nodes.length) {
      document.getElementById('search-input').style.borderColor = '#f87171';
      setTimeout(() => document.getElementById('search-input').style.borderColor = '', 800);
      return;
    }
    if (type === 'v' && !showVeh) {
      document.querySelector('#toggle-veh input').checked = true;
      showVeh = true;
    }
    if (type === 'p' && !showPed) {
      document.querySelector('#toggle-ped input').checked = true;
      showPed = true;
    }
    selectNode(type, idx, true);
  }

  document.getElementById('btn-goto').addEventListener('click', goToNode);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') goToNode();
  });

  document.getElementById('panel-close').addEventListener('click', clearSelection);
  updateFiltersBadge();
}

function updateLegend() {
  const legend = document.getElementById('legend');
  if (!showVeh && !showPed) { legend.style.display = 'none'; return; }
  legend.style.display = '';

  const rows = [];
  if (showVeh) {
    rows.push(['#4ade80', 'Regular road']);
    rows.push(['#60a5fa', 'Highway']);
    rows.push(['#f87171', 'Emergency only']);
    rows.push(['#22d3ee', 'Boat / water']);
    rows.push(['#fbbf24', 'Parking']);
  }
  if (showPed) rows.push(['#a78bfa', 'Ped path']);

  legend.innerHTML =
    `<div class="legend-title">Node types</div>` +
    rows.map(([c, l]) => `<div class="legend-row"><span class="dot" style="background:${c}"></span>${l}</div>`).join('');
}

async function boot() {
  initMap();
  initControls();
  initPanelDrag();

  const loadingEl = document.getElementById('loading');
  const loadingTxt = document.getElementById('loading-text');

  try {
    loadingTxt.textContent = 'following the damn train...';
    const resp = await fetch('data/nodes.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();

    nodesV = data.v || [];
    nodesP = data.p || [];
    nodesVByArea = buildAreaIndex(nodesV);
    nodesPByArea = buildAreaIndex(nodesP);

    const zRangeV = getZRange(nodesV);
    const zRangeP = getZRange(nodesP);
    if (zRangeV || zRangeP) {
      const minZ = Math.min(zRangeV ? zRangeV.min : Infinity, zRangeP ? zRangeP.min : Infinity);
      const maxZ = Math.max(zRangeV ? zRangeV.max : -Infinity, zRangeP ? zRangeP.max : -Infinity);
      document.getElementById('filter-z-min').placeholder = `min (${minZ.toFixed(0)})`;
      document.getElementById('filter-z-max').placeholder = `max (${maxZ.toFixed(0)})`;
    }

    const linkRangeV = getLinkRange(nodesV, true);
    const linkRangeP = getLinkRange(nodesP, false);
    if (linkRangeV || linkRangeP) {
      const minLinks = Math.min(linkRangeV ? linkRangeV.min : Infinity, linkRangeP ? linkRangeP.min : Infinity);
      const maxLinks = Math.max(linkRangeV ? linkRangeV.max : -Infinity, linkRangeP ? linkRangeP.max : -Infinity);
      document.getElementById('filter-links-min').placeholder = `min (${minLinks})`;
      document.getElementById('filter-links-max').placeholder = `max (${maxLinks})`;
    }

    const sel = document.getElementById('filter-area');
    for (let a = 0; a < 64; a++) {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = `NODES${a}`;
      sel.appendChild(opt);
    }

    nodeLayer = new NodeLayer();
    nodeLayer.addTo(map);
    updateLegend();

    setTimeout(() => loadingEl.classList.add('hidden'), 600);
  } catch (err) {
    loadingTxt.textContent = `Error: ${err.message}`;
    console.error(err);
  }
}

boot();
