// Center the map on Boston
const bostonBounds = L.latLngBounds(
  [42.15, -71.25],
  [42.45, -70.85]
);

const API_BASE = 'http://localhost:8000'
const map = L.map('map', {
  maxBounds: bostonBounds,
  maxBoundsViscosity: 1.0,
  minZoom: 11.5
}).setView([42.300, -70.940], 12.4);

// Base tile layer
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
}).addTo(map);

const DRILLDOWN_ZOOM = 18;
let neighborhoodData = {};
let colorBreaks = [0, 0, 0, 0, 0];
let neighborhoodLayer = null;
let selectedLayer = null;

// ---- Choropleth color scale ----
function getColorBreaks(rates) {
  const sorted = [...rates].filter(r => r > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 0, 0, 0, 0];
  const quantile = (p) => sorted[Math.floor(p * (sorted.length - 1))];
  return [
    quantile(0.2),
    quantile(0.4),
    quantile(0.6),
    quantile(0.8),
    quantile(0.95),
  ];
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

function styleFeature(feature) {
  const data = neighborhoodData[feature.properties.name] || { count: 0, rate: 0 };
  return {
    color: '#555',
    weight: 1.5,
    fillColor: getColor(data.rate, colorBreaks),
    fillOpacity: 0.6
  };
}

function onNeighborhoodClick(e) {
  const layer = e.target;

  if (selectedLayer) {
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

  selectedLayer = layer;
  map.fitBounds(layer.getBounds());
}

fetch(`${API_BASE}/api/cases/by-neighborhood`)
  .then(response => response.json())
  .then(data => {
    data.forEach(row => {
      neighborhoodData[row.neighborhood] = {
        count: row.case_count,
        rate: row.cases_per_1000
      };
    });
    colorBreaks = getColorBreaks(Object.values(neighborhoodData).map(d => d.rate));

    fetch('boston_neighborhoods.json')
      .then(response => response.json())
      .then(geoData => {
        geoData.features = geoData.features.filter(
          feature => feature.properties.name !== 'Harbor Islands'
        );

        neighborhoodLayer = L.geoJSON(geoData, {
          style: styleFeature,
          onEachFeature: (feature, layer) => {
            const data = neighborhoodData[feature.properties.name] || { count: 0, rate: 0 };
            layer.bindTooltip(`${feature.properties.name}: ${data.count} cases (${data.rate} per 1,000 residents)`);
            layer.on('click', onNeighborhoodClick);
          }
        }).addTo(map);
      });
  });

// ---- Viewport-based drill-down ----
let individualPinsLayer = L.layerGroup().addTo(map);

function loadCasesInView() {
  const bounds = map.getBounds();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startDate = thirtyDaysAgo.toISOString().split('T')[0];

  const params = new URLSearchParams({
    start_date: startDate,
    min_lat: bounds.getSouth(),
    max_lat: bounds.getNorth(),
    min_lng: bounds.getWest(),
    max_lng: bounds.getEast(),
  });

  fetch(`${API_BASE}/api/cases?${params}`)
    .then(response => response.json())
    .then(cases => {
      individualPinsLayer.clearLayers();
      cases.forEach(c => {
        if (c.latitude && c.longitude) {
          L.marker([c.latitude, c.longitude])
            .bindPopup(`${c.case_topic}<br>${c.full_address}<br>Status: ${c.case_status}`)
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

function checkZoomAndLoad() {
  if (map.getZoom() >= DRILLDOWN_ZOOM) {
    loadCasesInView();
  } else {
    individualPinsLayer.clearLayers();
  }
  updateChoroplethOpacity();
}

map.on('zoomend', checkZoomAndLoad);
map.on('moveend', checkZoomAndLoad);

function getCurrentFilters() {
  const categories = Array.from(document.querySelectorAll('.category-cb:checked'))
    .map(cb => cb.value);
  const status = document.querySelector('input[name="status"]:checked').value;
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;

  const params = new URLSearchParams();
  categories.forEach(cat => params.append('category', cat));
  if (status) params.append('status', status);
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);

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
          rate: row.cases_per_1000
        };
      });
      colorBreaks = getColorBreaks(Object.values(neighborhoodData).map(d => d.rate));

      if (neighborhoodLayer) {
        neighborhoodLayer.eachLayer(layer => {
          const data = neighborhoodData[layer.feature.properties.name] || { count: 0, rate: 0 };
          layer.setStyle(styleFeature(layer.feature));
          layer.setTooltipContent(`${layer.feature.properties.name}: ${data.count} cases (${data.rate} per 1,000 residents)`);
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
document.querySelectorAll('input[name="status"]').forEach(r => r.addEventListener('change', onFilterChange));
document.getElementById('start-date').addEventListener('change', onFilterChange);
document.getElementById('end-date').addEventListener('change', onFilterChange);