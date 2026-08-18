// Center the map on Boston
const bostonBounds = L.latLngBounds(
  [42.15, -71.25],
  [42.45, -70.85]
);

const bostonCoreBounds = L.latLngBounds(
  [42.23, -71.16],
  [42.40, -71.00]
);

const API_BASE = 'https://boston-311-pipeline.onrender.com'

const mapRenderer = L.canvas({ padding: 1 });

const map = L.map('map', {
  maxBounds: bostonBounds,
  maxBoundsViscosity: 1.0,
  minZoom: 11.5,
  renderer: mapRenderer
})

function fitMapToBoston() {
  const sidebarWidth = 300;
  map.fitBounds(bostonCoreBounds, {
    paddingTopLeft: [20, 20],
    paddingBottomRight: [sidebarWidth + 20, 20],
  });
  
  const size = map.getSize();
  const aspectRatio = size.x / size.y;
  if (aspectRatio > 1.6) {
    map.setZoom(map.getZoom() + .05, { animate: false });
  }

  map.options.zoomSnap = 0.25;
}

fitMapToBoston();
window.addEventListener('resize', fitMapToBoston);

// Base tile layer
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  keepBuffer: 2,
}).addTo(map);

const DRILLDOWN_ZOOM = 16;
let neighborhoodData = {};
let colorBreaks = [0, 0, 0, 0, 0];
let responseTimeBreaks = [0, 0, 0, 0, 0];
let neighborhoodLayer = null;
let selectedLayer = null;
let activeTab = 'cases'; // 'cases' | 'response-time'

// ---- Choropleth color scales ----
function getColorBreaks(values) {
  const sorted = [...values].filter(v => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 0, 0, 0, 0];
  const quantile = (p) => sorted[Math.floor(p * (sorted.length - 1))];
  return [quantile(0.2), quantile(0.4), quantile(0.6), quantile(0.8), quantile(0.95)];
}

function getColor(rate, breaks) {
  const [b20, b40, b60, b80, b95] = breaks;
  if (rate > b95) return '#4a1486';
  if (rate > b80) return '#6a51a3';
  if (rate > b60) return '#807dba';
  if (rate > b40) return '#9e9ac8';
  if (rate > b20) return '#bcbddc';
  if (rate > 0) return '#dadaeb';
  return '#fcfbfd';
}

function getResponseTimeColor(hours, breaks) {
  const [b20, b40, b60, b80, b95] = breaks;
  if (hours > b95) return '#7f0000';
  if (hours > b80) return '#b30000';
  if (hours > b60) return '#e34a33';
  if (hours > b40) return '#fc8d59';
  if (hours > b20) return '#fdcc8a';
  if (hours > 0) return '#fef0d9';
  return '#fcfbfd';
}

function tooltipTextFor(name, data) {
  if (activeTab === 'response-time') {
    return `${name}: ${data.medianResponseHours ?? 'N/A'} hrs median response`;
  }
  return `${name}: ${data.count} cases (${data.rate} per 1,000 residents)`;
}

// ---- Legend ----
function renderLegend() {
  const legend = document.getElementById('legend');
  const isRT = activeTab === 'response-time';
  const breaks = isRT ? responseTimeBreaks : colorBreaks;
  const colorFn = isRT ? getResponseTimeColor : getColor;
  const title = isRT ? 'Median response time' : 'Cases per 1,000 residents';
  const unit = isRT ? 'hrs' : '';

  const labels = [
    `0 - ${breaks[0].toFixed(1)}`,
    `${breaks[0].toFixed(1)} - ${breaks[1].toFixed(1)}`,
    `${breaks[1].toFixed(1)} - ${breaks[2].toFixed(1)}`,
    `${breaks[2].toFixed(1)} - ${breaks[3].toFixed(1)}`,
    `${breaks[3].toFixed(1)} - ${breaks[4].toFixed(1)}`,
    `${breaks[4].toFixed(1)}+`
  ];

  const midpoints = [
    breaks[0] * 0.5,
    breaks[0] + 1,
    breaks[1] + 1,
    breaks[2] + 1,
    breaks[3] + 1,
    breaks[4] + 1
  ];

  legend.innerHTML = `
    <div class="legend-title">${title}</div>
    ${labels.map((label, i) => `
      <div class="legend-row">
        <div class="legend-swatch" style="background:${colorFn(midpoints[i], breaks)}"></div>
        <span>${label} ${unit}</span>
      </div>
    `).join('')}
  `;
}

function styleFeature(feature) {
  const data = neighborhoodData[feature.properties.name] || { count: 0, rate: 0, medianResponseHours: 0 };

  if (activeTab === 'response-time') {
    return {
      color: '#555',
      weight: 1.5,
      fillColor: getResponseTimeColor(data.medianResponseHours, responseTimeBreaks),
      fillOpacity: 0.6
    };
  }

  return {
    color: '#555',
    weight: 1.5,
    fillColor: getColor(data.rate, colorBreaks),
    fillOpacity: 0.6
  };
}

let selectedName = null;

function onNeighborhoodClick(e) {
  const layer = e.target;
  const name = layer.feature.properties.name;

  if (selectedLayer && selectedLayer !== layer) {
    selectedLayer.setStyle(styleFeature(selectedLayer.feature));
  }

  layer.setStyle({
    color: '#000',
    weight: 3,
    fillOpacity: 0.4
  });

  if (layer._path) {
    layer._path.blur();
  }

  const sameNeighborhoodAlreadyZoomedIn =
    name === selectedName && map.getZoom() >= DRILLDOWN_ZOOM - 2;

  selectedLayer = layer;
  selectedName = name;

  if (!sameNeighborhoodAlreadyZoomedIn) {
    map.fitBounds(layer.getBounds());
  }
}

fetch(`${API_BASE}/api/cases/by-neighborhood`)
  .then(response => response.json())
  .then(data => {
    data.forEach(row => {
      neighborhoodData[row.neighborhood] = {
        count: row.case_count,
        rate: row.cases_per_1000,
        medianResponseHours: row.median_response_hours
      };
    });
    colorBreaks = getColorBreaks(Object.values(neighborhoodData).map(d => d.rate));
    responseTimeBreaks = getColorBreaks(Object.values(neighborhoodData).map(d => d.medianResponseHours || 0));
    renderLegend();

    fetch('boston_neighborhoods.json')
      .then(response => response.json())
      .then(geoData => {
        geoData.features = geoData.features.filter(
          feature => feature.properties.name !== 'Harbor Islands'
        );

        neighborhoodLayer = L.geoJSON(geoData, {
          style: styleFeature,
          onEachFeature: (feature, layer) => {
            const data = neighborhoodData[feature.properties.name] || { count: 0, rate: 0, medianResponseHours: 0 };
            layer.bindTooltip(tooltipTextFor(feature.properties.name, data));
            layer.on('click', onNeighborhoodClick);
          }
        }).addTo(map);

        document.getElementById('loading-overlay').style.display = 'none';
      });
  })
    .catch(() => {
    document.getElementById('loading-overlay').innerHTML =
      '<p>Taking longer than usual to wake up the server — thanks for your patience!</p>';
  });

// ---- Viewport-based drill-down ----
let individualPinsLayer = L.layerGroup().addTo(map);

function getMarkerColor(status) {
  return status === 'Closed' ? '#2ecc71' : '#e74c3c'; // green : red
}

function createCaseMarker(c) {
  return L.circleMarker([c.latitude, c.longitude], {
    radius: 9,
    fillColor: getMarkerColor(c.case_status),
    color: '#fff',
    weight: 2,
    fillOpacity: 0.95,
    className: 'case-pin'
  });
}

function buildPopupContent(c) {
  const openDate = new Date(c.open_date).toLocaleDateString();
  const targetDate = c.target_close_date ? new Date(c.target_close_date).toLocaleDateString() : 'N/A';

  let content = `
    <strong>${c.case_topic}</strong><br>
    ${c.full_address}<br>
    Status: ${c.case_status}<br>
    Category: ${c.umbrella_category}<br>
    Opened: ${openDate}<br>
    Target close: ${targetDate}<br>
    On time: ${c.on_time}<br>
    Department: ${c.assigned_department}
  `;

  if (c.case_status === 'Closed' && c.close_date) {
    const hours = (new Date(c.close_date) - new Date(c.open_date)) / (1000 * 60 * 60);
    content += `<br><strong>Response time: ${hours.toFixed(1)} hrs</strong>`;
  }

  if (c.closure_comments) {
    content += `<br>Notes: ${c.closure_comments}`;
  }

  return content;
}

let requestId = 0;

function loadCasesInView() {
  const thisRequestId = ++requestId;
  const bounds = map.getBounds();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startDate = thirtyDaysAgo.toISOString().split('T')[0];

  const params = getCurrentFilters();
  params.set('start_date', startDate);
  params.set('min_lat', bounds.getSouth());
  params.set('max_lat', bounds.getNorth());
  params.set('min_lng', bounds.getWest());
  params.set('max_lng', bounds.getEast());

  fetch(`${API_BASE}/api/cases?${params}`)
    .then(response => response.json())
    .then(cases => {
      if (thisRequestId !== requestId) return; // a newer request superseded this one, discard
      individualPinsLayer.clearLayers();
      cases.forEach(c => {
        if (c.latitude && c.longitude) {
          createCaseMarker(c)
            .bindPopup(buildPopupContent(c))
            .addTo(individualPinsLayer);
        }
      });
    });
}
function updateChoroplethOpacity() {
  if (!neighborhoodLayer) return;
  const opacity = map.getZoom() >= DRILLDOWN_ZOOM ? 0.15 : 0.6;
  neighborhoodLayer.setStyle({ fillOpacity: opacity });
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const debouncedCheckZoomAndLoad = debounce(checkZoomAndLoad, 250);

let wasAboveDrilldownZoom = false;

function checkZoomAndLoad() {
  const isAboveDrilldownZoom = map.getZoom() >= DRILLDOWN_ZOOM;

  if (isAboveDrilldownZoom) {
    loadCasesInView();
    if (!wasAboveDrilldownZoom && neighborhoodLayer) {
      neighborhoodLayer.eachLayer(layer => {
        layer.closeTooltip();
        layer.unbindTooltip();
      });
    }
  } else {
    if (wasAboveDrilldownZoom) {
      individualPinsLayer.clearLayers();
    }
    if (wasAboveDrilldownZoom && neighborhoodLayer) {
      neighborhoodLayer.eachLayer(layer => {
        const data = neighborhoodData[layer.feature.properties.name] || { count: 0, rate: 0, medianResponseHours: 0 };
        layer.bindTooltip(tooltipTextFor(layer.feature.properties.name, data));
      });
    }
  }

  updateChoroplethOpacity();
  wasAboveDrilldownZoom = isAboveDrilldownZoom;
}

map.on('zoomend', debouncedCheckZoomAndLoad);
map.on('moveend', debouncedCheckZoomAndLoad);

function getCurrentFilters() {
  const categoryClass = activeTab === 'response-time' ? '.rt-category-cb:checked' : '.category-cb:checked';
  const categories = Array.from(document.querySelectorAll(categoryClass)).map(cb => cb.value);

  const params = new URLSearchParams();
  categories.forEach(cat => params.append('category', cat));

  if (activeTab === 'cases') {
    const status = document.querySelector('input[name="status"]:checked').value;
    if (status) params.append('status', status);
  }

  return params;
}

function refreshChoropleth() {
  const params = getCurrentFilters();
  fetch(`${API_BASE}/api/cases/by-neighborhood?${params}`)
    .then(response => response.json())
    .then(data => {
      neighborhoodData = {};
      data.forEach(row => {
        neighborhoodData[row.neighborhood] = {
          count: row.case_count,
          rate: row.cases_per_1000,
          medianResponseHours: row.median_response_hours
        };
      });
      colorBreaks = getColorBreaks(Object.values(neighborhoodData).map(d => d.rate));
      responseTimeBreaks = getColorBreaks(Object.values(neighborhoodData).map(d => d.medianResponseHours || 0));
      renderLegend();
  
      if (neighborhoodLayer) {
        neighborhoodLayer.eachLayer(layer => {
          const data = neighborhoodData[layer.feature.properties.name] || { count: 0, rate: 0, medianResponseHours: 0 };
          layer.setStyle(styleFeature(layer.feature));
          layer.setTooltipContent(tooltipTextFor(layer.feature.properties.name, data));
        });
      }
    });
}

function onFilterChange() {
  refreshChoropleth();
  if (map.getZoom() >= DRILLDOWN_ZOOM) {
    loadCasesInView();
  }
}

document.querySelectorAll('.category-cb').forEach(cb => cb.addEventListener('change', onFilterChange));
document.querySelectorAll('.rt-category-cb').forEach(cb => cb.addEventListener('change', onFilterChange));
document.querySelectorAll('input[name="status"]').forEach(r => r.addEventListener('change', onFilterChange));

document.getElementById('info-btn').addEventListener('click', () => {
  document.getElementById('info-panel').style.display = 'block';
  document.getElementById('info-backdrop').style.display = 'block';
});
document.getElementById('info-close').addEventListener('click', () => {
  document.getElementById('info-panel').style.display = 'none';
  document.getElementById('info-backdrop').style.display = 'none';
});
document.getElementById('info-backdrop').addEventListener('click', () => {
  document.getElementById('info-panel').style.display = 'none';
  document.getElementById('info-backdrop').style.display = 'none';
});

// ---- Tab switching ----
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');

    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).style.display = 'block';

    activeTab = btn.dataset.tab === 'response-time-panel' ? 'response-time' : 'cases';
    refreshChoropleth();
    renderLegend();
    if (map.getZoom() >= DRILLDOWN_ZOOM) {
      loadCasesInView();
    }
  });
});