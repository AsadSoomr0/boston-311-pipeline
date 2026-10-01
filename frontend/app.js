// ---- Settings ----
const DATA_DIR = 'data';
const DRILLDOWN_ZOOM = 16;
const NEW_CASE_HOURS = 24;
const MAX_PINS = 3000;

const CASE_COLORS = ['#fcfbfd', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#4a1486'];
const RT_COLORS = ['#fcfbfd', '#fef0d9', '#fdcc8a', '#fc8d59', '#e34a33', '#b30000', '#7f0000'];
const NO_DATA_COLOR = '#e5e5e5';
const OPEN_COLOR = '#e74c3c';
const CLOSED_COLOR = '#2ecc71';
const NEW_COLOR = '#f59e0b';

const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;

// ---- Map setup ----
const bostonBounds = L.latLngBounds([42.15, -71.25], [42.45, -70.85]);
const bostonCoreBounds = L.latLngBounds([42.23, -71.16], [42.40, -71.00]);

const mapRenderer = L.canvas({ padding: 1, tolerance: L.Browser.mobile ? 6 : 0 });

const map = L.map('map', {
  maxBounds: bostonBounds,
  maxBoundsViscosity: 1.0,
  minZoom: isNarrow() ? 10.5 : 11.5,
  maxZoom: 18,
  renderer: mapRenderer,
});

function mapPadding() {
  if (isNarrow()) {
    const sidebar = document.getElementById('sidebar').offsetHeight;
    return { paddingTopLeft: [12, 90], paddingBottomRight: [12, sidebar + 12] };
  }
  const sidebar = document.getElementById('sidebar').offsetWidth;
  return { paddingTopLeft: [20, 20], paddingBottomRight: [sidebar + 20, 20] };
}

function fitMapToBoston() {
  map.options.zoomSnap = 1;
  map.fitBounds(bostonCoreBounds, { ...mapPadding(), animate: false });
  map.options.zoomSnap = 0.25;
}

fitMapToBoston();

// Only re-fit on resize until the person starts exploring the map themselves.
let userMovedMap = false;
['wheel', 'mousedown', 'touchstart', 'keydown'].forEach(evt =>
  map.getContainer().addEventListener(evt, () => { userMovedMap = true; }, { passive: true })
);
window.addEventListener('resize', () => {
  if (!userMovedMap) fitMapToBoston();
});

// ---- Basemap ----
// CARTO needs an API key now (set it in config.js). Without one, use Esri's keyless gray canvas.
function addBasemap() {
  const cartoKey = (window.MAP_CONFIG || {}).cartoKey;
  if (cartoKey) {
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoKey)}`, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
      keepBuffer: 2,
    }).addTo(map);
    return;
  }

  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  L.tileLayer(`${esri}World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
    attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    maxNativeZoom: 16,
    maxZoom: 18,
    keepBuffer: 2,
  }).addTo(map);

  // Street and place labels sit just under the neighborhood fill, like the old CARTO tiles.
  map.createPane('labels');
  map.getPane('labels').style.zIndex = 390;
  map.getPane('labels').style.pointerEvents = 'none';
  L.tileLayer(`${esri}World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, {
    pane: 'labels',
    maxNativeZoom: 16,
    maxZoom: 18,
    keepBuffer: 2,
  }).addTo(map);
}

addBasemap();

// ---- State ----
let meta = null;            // data/meta.json
let stats = null;           // data/neighborhood_stats.json
let recentCases = null;     // decoded data/recent_cases.json (loaded in the background)
let neighborhoodLayer = null;
let values = {};            // neighborhood name -> { count, rate, responseHours, sharedWith }
let caseBreaks = [0, 0, 0, 0, 0];
let rtBreaks = [0, 0, 0, 0, 0];
let selectedName = null;
let activeTab = 'cases';    // 'cases' | 'response-time'
let newCaseCutoff = Infinity;

const pinsLayer = L.layerGroup().addTo(map);

// ---- Small helpers ----
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function formatHours(hours) {
  if (hours == null) return 'N/A';
  return hours < 48 ? `${hours.toFixed(1)} hrs` : `${(hours / 24).toFixed(1)} days`;
}

function formatDate(ms, withTime = false) {
  const opts = { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
  return new Date(ms).toLocaleString('en-US', opts);
}

function fetchJSON(path, version) {
  const url = version ? `${path}?v=${encodeURIComponent(version)}` : path;
  return fetch(url, { cache: version ? 'default' : 'no-cache' }).then(response => {
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.json();
  });
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ---- Filters ----
function buildCategoryFilters() {
  const make = (containerId, cls) => {
    document.getElementById(containerId).innerHTML = meta.categories.map((name, i) =>
      `<label><input type="checkbox" class="${cls}" value="${i}"> ${escapeHtml(name)}</label>`
    ).join('');
  };
  make('category-filters', 'category-cb');
  make('rt-category-filters', 'rt-category-cb');
}

function selectedCategories() {
  const selector = activeTab === 'response-time' ? '.rt-category-cb:checked' : '.category-cb:checked';
  const picked = Array.from(document.querySelectorAll(selector)).map(cb => Number(cb.value));
  return picked.length ? picked : meta.categories.map((_, i) => i); // nothing checked = everything
}

function selectedStatus() {
  if (activeTab !== 'cases') return '';
  return document.querySelector('input[name="status"]:checked').value;
}

function highlightNew() {
  return document.getElementById('highlight-new').checked;
}

// ---- Choropleth values, computed in the browser from pre-aggregated counts ----
function computeValues() {
  const cats = selectedCategories();
  const status = selectedStatus();
  const mask = cats.reduce((m, i) => m | (1 << i), 0);
  const parentOf = name => meta.rateGroups[name] || name;

  const counts = {};
  const groupTotals = {};
  for (const [name, table] of Object.entries(stats.counts)) {
    let n = 0;
    for (const i of cats) {
      const [open, closed] = table[i];
      n += status === 'open' ? open : status === 'closed' ? closed : open + closed;
    }
    counts[name] = n;
    groupTotals[parentOf(name)] = (groupTotals[parentOf(name)] || 0) + n;
  }

  const groupMembers = {};
  Object.entries(meta.rateGroups).forEach(([child, parent]) => {
    (groupMembers[parent] = groupMembers[parent] || []).push(child);
  });

  values = {};
  neighborhoodLayer.eachLayer(layer => {
    const name = layer.feature.properties.name;
    const group = parentOf(name);
    const population = meta.populations[group];
    const members = [group, ...(groupMembers[group] || [])];
    values[name] = {
      count: counts[name] || 0,
      rate: population ? ((groupTotals[group] || 0) / population) * 1000 : null,
      responseHours: stats.responseHours[name]?.[mask] ?? null,
      sharedWith: members.length > 1 ? members.filter(m => m !== name) : [],
    };
  });

  caseBreaks = getColorBreaks(Object.values(values).map(v => v.rate));
  rtBreaks = getColorBreaks(Object.values(values).map(v => v.responseHours));
}

function getColorBreaks(list) {
  const sorted = list.filter(v => v != null && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 0, 0, 0, 0];
  const quantile = p => sorted[Math.floor(p * (sorted.length - 1))];
  return [quantile(0.2), quantile(0.4), quantile(0.6), quantile(0.8), quantile(0.95)];
}

function bucketFor(value, breaks) {
  if (value == null) return -1;
  if (value <= 0) return 0;
  return 1 + breaks.filter(b => value > b).length; // 1..6
}

function colorFor(value, breaks, palette) {
  const bucket = bucketFor(value, breaks);
  return bucket < 0 ? NO_DATA_COLOR : palette[bucket];
}

function tooltipTextFor(name) {
  const v = values[name];
  if (!v) return escapeHtml(name);
  if (activeTab === 'response-time') {
    const rt = v.responseHours == null ? 'not enough closed cases' : `${formatHours(v.responseHours)} median response`;
    return `<strong>${escapeHtml(name)}</strong><br>${rt}`;
  }
  const rate = v.rate == null ? 'no population data' : `${v.rate.toFixed(1)} per 1,000 residents`;
  const shared = v.sharedWith.length ? `<br><em>Rate combined with ${escapeHtml(v.sharedWith.join(', '))}</em>` : '';
  return `<strong>${escapeHtml(name)}</strong><br>${v.count.toLocaleString()} cases (${rate})${shared}`;
}

function styleFeature(feature) {
  const name = feature.properties.name;
  const v = values[name] || {};
  const zoomedIn = map.getZoom() >= DRILLDOWN_ZOOM;
  const fillColor = activeTab === 'response-time'
    ? colorFor(v.responseHours, rtBreaks, RT_COLORS)
    : colorFor(v.rate, caseBreaks, CASE_COLORS);

  if (name === selectedName) {
    return { color: '#000', weight: 3, fillColor, fillOpacity: zoomedIn ? 0.15 : 0.4 };
  }
  return { color: '#555', weight: 1.5, fillColor, fillOpacity: zoomedIn ? 0.15 : 0.6 };
}

let tooltipsEnabled = true;

function restyleNeighborhoods() {
  if (!neighborhoodLayer) return;
  neighborhoodLayer.eachLayer(layer => {
    layer.setStyle(styleFeature(layer.feature));
    if (tooltipsEnabled) layer.setTooltipContent(tooltipTextFor(layer.feature.properties.name));
  });
}

function setTooltipsEnabled(enabled) {
  if (enabled === tooltipsEnabled || !neighborhoodLayer) return;
  tooltipsEnabled = enabled;
  neighborhoodLayer.eachLayer(layer => {
    if (enabled) {
      layer.bindTooltip(tooltipTextFor(layer.feature.properties.name));
    } else {
      layer.closeTooltip();
      layer.unbindTooltip();
    }
  });
}

// ---- Legend ----
function renderLegend() {
  const isRT = activeTab === 'response-time';
  const breaks = isRT ? rtBreaks : caseBreaks;
  const palette = isRT ? RT_COLORS : CASE_COLORS;
  const fmt = isRT ? formatHours : v => v.toFixed(1);
  const title = isRT ? 'Median response time' : 'Cases per 1,000 residents';

  const rows = [
    [palette[1], `0 - ${fmt(breaks[0])}`],
    [palette[2], `${fmt(breaks[0])} - ${fmt(breaks[1])}`],
    [palette[3], `${fmt(breaks[1])} - ${fmt(breaks[2])}`],
    [palette[4], `${fmt(breaks[2])} - ${fmt(breaks[3])}`],
    [palette[5], `${fmt(breaks[3])} - ${fmt(breaks[4])}`],
    [palette[6], `${fmt(breaks[4])}+`],
  ];
  const vals = Object.values(values);
  if (vals.some(v => (isRT ? v.responseHours : v.rate) == null)) {
    rows.push([NO_DATA_COLOR, isRT ? 'Too few closed cases' : 'No data']);
  }

  const swatch = (color, label, round = false) => `
    <div class="legend-row">
      <div class="legend-swatch" style="background:${color};${round ? 'border-radius:50%;' : ''}"></div>
      <span>${label}</span>
    </div>`;

  let html = `<div class="legend-title">${title}</div>${rows.map(([c, l]) => swatch(c, l)).join('')}`;
  if (map.getZoom() >= DRILLDOWN_ZOOM) {
    html += '<div class="legend-divider"></div>' +
      swatch(OPEN_COLOR, 'Open case', true) + swatch(CLOSED_COLOR, 'Closed case', true);
  }
  if (recentCases && (highlightNew() || map.getZoom() >= DRILLDOWN_ZOOM)) {
    html += (map.getZoom() >= DRILLDOWN_ZOOM ? '' : '<div class="legend-divider"></div>') +
      swatch(NEW_COLOR, `New in last ${NEW_CASE_HOURS} hrs`, true);
  }
  document.getElementById('legend').innerHTML = html;
}

// ---- Neighborhood click ----
function onNeighborhoodClick(e) {
  const layer = e.target;
  const name = layer.feature.properties.name;
  const alreadyZoomedIn = name === selectedName && map.getZoom() >= DRILLDOWN_ZOOM - 2;

  selectedName = name;
  userMovedMap = true;
  restyleNeighborhoods();

  if (!alreadyZoomedIn) {
    map.fitBounds(layer.getBounds(), mapPadding());
  }
}

// ---- Case pins ----
function decodeRecentCases(payload) {
  const f = Object.fromEntries(payload.fields.map((name, i) => [name, i]));
  return payload.rows.map(r => ({
    id: r[f.id],
    lat: r[f.lat],
    lng: r[f.lng],
    topic: payload.topics[r[f.topic]],
    category: r[f.category],
    closed: r[f.closed] === 1,
    opened: r[f.opened] * 1000,
    closedAt: r[f.closedAt] != null ? r[f.closedAt] * 1000 : null,
    target: r[f.target] != null ? r[f.target] * 1000 : null,
    onTime: r[f.onTime],
    department: payload.departments[r[f.department]],
    address: r[f.address],
    notes: r[f.notes],
  }));
}

function isNewCase(c) {
  return c.opened >= newCaseCutoff;
}

function matchesFilters(c, cats, status) {
  if (!cats.has(c.category)) return false;
  if (status === 'open') return !c.closed;
  if (status === 'closed') return c.closed;
  return true;
}

function buildPopupContent(c) {
  const title = `<div class="popup-topic">${escapeHtml(c.topic)}${isNewCase(c) ? '<span class="popup-new">New</span>' : ''}</div>`;
  const lines = [];
  if (c.address) lines.push(escapeHtml(c.address));
  lines.push(`Status: ${c.closed ? 'Closed' : 'Open'}`);
  lines.push(`Category: ${escapeHtml(meta.categories[c.category])}`);
  lines.push(`Opened: ${formatDate(c.opened, true)}`);
  if (c.target) lines.push(`Target close: ${formatDate(c.target)}`);
  if (c.onTime != null) lines.push(`On time: ${c.onTime === 1 ? 'Yes' : 'No'}`);
  if (c.department) lines.push(`Department: ${escapeHtml(c.department)}`);
  if (c.closed && c.closedAt) {
    lines.push(`<strong>Response time: ${formatHours((c.closedAt - c.opened) / 3600000)}</strong>`);
  }
  let html = title + lines.join('<br>');
  if (c.notes) html += `<div class="popup-notes">Notes: ${escapeHtml(c.notes)}</div>`;
  return html;
}

// Keep popups clear of the header and sidebar when Leaflet pans to show them.
function popupOptions() {
  const pad = mapPadding();
  return {
    autoPanPaddingTopLeft: L.point(pad.paddingTopLeft[0], isNarrow() ? 90 : 150),
    autoPanPaddingBottomRight: L.point(...pad.paddingBottomRight),
  };
}

function addPin(c, zoomedIn, highlight) {
  const showAsNew = highlight && isNewCase(c);
  const style = zoomedIn
    ? {
        radius: 9,
        fillColor: c.closed ? CLOSED_COLOR : OPEN_COLOR,
        color: showAsNew ? NEW_COLOR : '#fff',
        weight: showAsNew ? 4 : 2,
        fillOpacity: 0.95,
      }
    : { radius: 3.5, fillColor: NEW_COLOR, color: '#fff', weight: 1, fillOpacity: 0.9 };

  L.circleMarker([c.lat, c.lng], { ...style, renderer: mapRenderer })
    .bindPopup(() => buildPopupContent(c), popupOptions())
    .addTo(pinsLayer);
}

function renderPins() {
  pinsLayer.clearLayers();
  updateNewCount();
  if (!recentCases) return;

  const zoomedIn = map.getZoom() >= DRILLDOWN_ZOOM;
  const highlight = highlightNew();
  const cats = new Set(selectedCategories());
  const status = selectedStatus();

  if (zoomedIn) {
    const bounds = map.getBounds().pad(0.2);
    let shown = 0;
    // recentCases is sorted oldest -> newest, so new cases draw on top.
    for (const c of recentCases) {
      if (shown >= MAX_PINS) break;
      if (!bounds.contains([c.lat, c.lng]) || !matchesFilters(c, cats, status)) continue;
      addPin(c, true, true); // zoomed in, new cases always get the gold ring
      shown++;
    }
  } else if (highlight) {
    for (const c of recentCases) {
      if (isNewCase(c) && matchesFilters(c, cats, status)) addPin(c, false, true);
    }
  }
}

function updateNewCount() {
  const el = document.getElementById('new-count');
  if (!recentCases) { el.textContent = ''; return; }
  const cats = new Set(selectedCategories());
  const status = selectedStatus();
  const n = recentCases.filter(c => isNewCase(c) && matchesFilters(c, cats, status)).length;
  el.textContent = `${n.toLocaleString()} matching case${n === 1 ? '' : 's'} reported in the ${NEW_CASE_HOURS} hours before the latest update.`;
}

let recentCasesRequest = null;
function loadRecentCases() {
  if (!recentCasesRequest) {
    recentCasesRequest = fetchJSON(`${DATA_DIR}/recent_cases.json`, meta.generatedAt)
      .then(payload => {
        recentCases = decodeRecentCases(payload);
        renderPins();
        renderLegend();
      })
      .catch(err => {
        console.error('Could not load recent cases', err);
        recentCasesRequest = null; // allow a retry on the next zoom
      });
  }
  return recentCasesRequest;
}

// ---- Zoom handling ----
function onViewChange() {
  const zoomedIn = map.getZoom() >= DRILLDOWN_ZOOM;
  setTooltipsEnabled(!zoomedIn);
  restyleNeighborhoods();
  renderPins();
  renderLegend();
}

map.on('zoomend moveend', debounce(onViewChange, 150));

// ---- Refresh everything after a filter or tab change ----
function refresh() {
  if (!neighborhoodLayer) return;
  computeValues();
  restyleNeighborhoods();
  renderLegend();
  renderPins();
}

function onFiltersBuilt() {
  document.querySelectorAll('.category-cb, .rt-category-cb, input[name="status"], #highlight-new')
    .forEach(input => input.addEventListener('change', refresh));
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    activeTab = btn.dataset.tab;
    document.getElementById('cases-panel').style.display = activeTab === 'cases' ? 'block' : 'none';
    document.getElementById('response-time-panel').style.display = activeTab === 'response-time' ? 'block' : 'none';
    refresh();
  });
});

// ---- Info panel ----
function setInfoOpen(open) {
  document.getElementById('info-panel').style.display = open ? 'block' : 'none';
  document.getElementById('info-backdrop').style.display = open ? 'block' : 'none';
}
document.getElementById('info-btn').addEventListener('click', () => setInfoOpen(true));
document.getElementById('info-close').addEventListener('click', () => setInfoOpen(false));
document.getElementById('info-backdrop').addEventListener('click', () => setInfoOpen(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape') setInfoOpen(false); });

function describeData() {
  const start = formatDate(Date.parse(`${meta.dataStart}T12:00:00Z`));
  const through = meta.dataThrough ? formatDate(Date.parse(meta.dataThrough)) : null;
  document.getElementById('data-updated').textContent = through ? `Cases through ${through}` : '';
  document.getElementById('info-coverage').textContent =
    `Covers ${meta.totalCases.toLocaleString()} requests opened since ${start}` +
    `${through ? ` through ${through}` : ''}, updated automatically once per day.`;
}

// ---- Initial load ----
Promise.all([
  fetchJSON(`${DATA_DIR}/meta.json`).then(m => {
    meta = m;
    return fetchJSON(`${DATA_DIR}/neighborhood_stats.json`, meta.generatedAt);
  }),
  fetchJSON('boston_neighborhoods.json'),
])
  .then(([neighborhoodStats, geoData]) => {
    stats = neighborhoodStats;
    newCaseCutoff = meta.dataThrough
      ? Date.parse(meta.dataThrough) - NEW_CASE_HOURS * 3600 * 1000
      : Infinity;

    buildCategoryFilters();
    onFiltersBuilt();
    describeData();

    geoData.features = geoData.features.filter(f => f.properties.name !== 'Harbor Islands');
    neighborhoodLayer = L.geoJSON(geoData, {
      style: styleFeature,
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(feature.properties.name);
        layer.on('click', onNeighborhoodClick);
      },
    }).addTo(map);

    refresh();
    document.getElementById('loading-overlay').style.display = 'none';

    // Pins are added after the neighborhoods so they draw on top on the shared canvas.
    loadRecentCases();
  })
  .catch(err => {
    console.error(err);
    document.getElementById('loading-overlay').innerHTML =
      '<p>Couldn\'t load the map data. Please try refreshing the page.</p>';
  });
