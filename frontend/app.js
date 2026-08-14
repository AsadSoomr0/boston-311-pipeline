// Center the map on Boston
const bostonBounds = L.latLngBounds(
  [42.15, -71.25],
  [42.45, -70.85]
);

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
let neighborhoodCounts = {};
let neighborhoodLayer = null;
let selectedLayer = null;

// ---- Choropleth color scale ----
function getColor(count) {
  return count > 4000 ? '#4a1486' :
         count > 2500 ? '#6a51a3' :
         count > 1500 ? '#807dba' :
         count > 800  ? '#9e9ac8' :
         count > 300  ? '#bcbddc' :
         count > 0    ? '#dadaeb' :
                          '#fcfbfd';
}

function styleFeature(feature) {
  const count = neighborhoodCounts[feature.properties.name] || 0;
  return {
    color: '#555',
    weight: 1.5,
    fillColor: getColor(count),
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

fetch('http://localhost:8000/api/cases/by-neighborhood')
  .then(response => response.json())
  .then(data => {
    data.forEach(row => {
      neighborhoodCounts[row.neighborhood] = row.case_count;
    });

    fetch('boston_neighborhoods.json')
      .then(response => response.json())
      .then(geoData => {
        geoData.features = geoData.features.filter(
          feature => feature.properties.name !== 'Harbor Islands'
        );

        neighborhoodLayer = L.geoJSON(geoData, {
          style: styleFeature,
          onEachFeature: (feature, layer) => {
            const count = neighborhoodCounts[feature.properties.name] || 0;
            layer.bindTooltip(`${feature.properties.name}: ${count} cases`);
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

  fetch(`http://localhost:8000/api/cases?${params}`)
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