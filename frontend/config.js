// CARTO basemap keys: https://carto.com/basemaps/apikey/
// Each key is restricted to where it's used, so both are safe to commit.
const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

window.MAP_CONFIG = {
  cartoKey: isLocal ? 'cb1_46or_2_e3b58cd205b2da01c3bd5396' : 'cb1_46or_1_39b0d257062c2f810ff7d435',
};