/* === 朝霞晚霞预测 · 摄影助手 - v2 === */

const AMAP_KEY = '9a559408bacf3862588c08ad3a273edc';
const AMAP_SEARCH_URL = 'https://restapi.amap.com/v3/place/text';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// DOM
let $loading, $predictions;
let $locName, $weatherCard, $tabBar, $tabDate;
let $weatherIcon, $weatherTemp, $weatherDesc;
let $wdHumidity, $wdCloud, $wdVisibility, $wdPrecip;
let $sunriseTime, $sunsetTime, $sunriseCountdown, $sunsetCountdown, $countdownBar;
let $mapPickBtn, $mapModal, $mapContainer, $mapCoords, $mapCancelBtn, $mapConfirmBtn;
let $mapLocateBtn, $mapSearchInput, $mapSearchBtn, $mapSearchResults;

// State
const state = {
  lat: null, lon: null, name: '', country: '',
  forecastData: null,
  activeTab: 0,   // 0=今天, 1=明天, 2=后天
  countdownTimer: null,
};

// === 初始化 ===
function init() {
  bindDOM();
  $tabBar.addEventListener('click', handleTabClick);
  // $locateBtn.addEventListener('click', autoLocate);
  document.getElementById('locateBtn').addEventListener('click', autoLocate);
  $mapPickBtn.addEventListener('click', openMapPicker);

  const saved = localStorage.getItem('glow_predictor_location');
  if (saved) {
    try {
      const loc = JSON.parse(saved);
      state.lat = loc.lat; state.lon = loc.lon;
      state.name = loc.name; state.country = loc.country;
      $locName.textContent = state.name;
      fetchForecast();
      tryGeoUpdate();
      return;
    } catch(e) {}
  }
  selectLocation(39.9042, 116.4074, '北京', '中国', '北京市');
  tryGeoUpdate();
}

function bindDOM() {
  
  $loading = document.getElementById('loading');
  $predictions = document.getElementById('predictions');
  $locName = document.getElementById('locName');
  $weatherCard = document.getElementById('weatherCard');
  $tabBar = document.getElementById('tabBar');
  $tabDate = document.getElementById('tabDate');
  $weatherIcon = document.getElementById('weatherIcon');
  $weatherTemp = document.getElementById('weatherTemp');
  $weatherDesc = document.getElementById('weatherDesc');
  $wdHumidity = document.getElementById('wdHumidity');
  $wdCloud = document.getElementById('wdCloud');
  $wdVisibility = document.getElementById('wdVisibility');
  $wdPrecip = document.getElementById('wdPrecip');
  $sunriseTime = document.getElementById('sunriseTime');
  $sunsetTime = document.getElementById('sunsetTime');
  $sunriseCountdown = document.getElementById('sunriseCountdown');
  $sunsetCountdown = document.getElementById('sunsetCountdown');
  $countdownBar = document.getElementById('countdownBar');
  $mapPickBtn = document.getElementById('mapPickBtn');
  $mapModal = document.getElementById('mapModal');
  $mapContainer = document.getElementById('mapContainer');
  $mapCoords = document.getElementById('mapCoords');
  $mapCancelBtn = document.getElementById('mapCancelBtn');
  $mapConfirmBtn = document.getElementById('mapConfirmBtn');
  $mapLocateBtn = document.getElementById('mapLocateBtn');
  $mapSearchInput = document.getElementById('mapSearchInput');
  $mapSearchBtn = document.getElementById('mapSearchBtn');
  $mapSearchResults = document.getElementById('mapSearchResults');
  // 地图弹窗事件
  $mapCancelBtn.addEventListener('click', closeMapPicker);
  $mapConfirmBtn.addEventListener('click', confirmMapPick);
  $mapLocateBtn.addEventListener('click', locateOnMap);
  $mapSearchBtn.addEventListener('click', mapSearch);
  $mapSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') mapSearch(); });
}

function tryGeoUpdate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => onGeoSuccess(pos.coords.latitude, pos.coords.longitude, true),
    () => {},
    { timeout: 5000, maximumAge: 300000 }
  );
}

function autoLocate() {
  if (!navigator.geolocation) { alert('浏览器不支持定位'); return; }
  const btn = document.getElementById('locateBtn');
  btn.textContent = '⏳ 定位中…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      onGeoSuccess(pos.coords.latitude, pos.coords.longitude, false);
      btn.textContent = '📍 获取当前位置';
    },
    (err) => {
      console.warn('定位失败', err);
      btn.textContent = '📍 获取当前位置';
      if (!state.lat) selectLocation(39.9042, 116.4074, '北京', '中国');
    },
    { timeout: 3000, maximumAge: 300000 }
  );
}

async function onGeoSuccess(lat, lon, silent) {
  // 逆地理编码需要 GCJ-02（高德坐标），但天气预报用原始 WGS-84 坐标
  const gcj02 = await convertWGS84toGCJ02(lat, lon);
  let displayName = '', country = '';
  const result = await getAmapRegeo(gcj02.lat, gcj02.lon);
  if (result) {
    displayName = result.displayName;
    country = result.country;
  } else {
    displayName = `${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E`;
  }
  if (silent && state.name && !state.name.includes('°') && state.name !== '北京') return;
  // 预报使用原始 WGS-84 坐标（GPS 原生），逆地理只用 GCJ-02 给高德 API
  selectLocation(lat, lon, displayName, country);
}

function selectLocation(lat, lon, name, country) {
  state.lat = lat; state.lon = lon;
  state.name = name || `${lat.toFixed(2)},${lon.toFixed(2)}`;
  state.country = country;
  $locName.textContent = state.name;
  localStorage.setItem('glow_predictor_location', JSON.stringify({ lat, lon, name: state.name, country }));
  state.activeTab = 0;
  updateTabUI();
  fetchForecast();
}

// === 地图选择器（高德地图） ===
let _mapInstance = null;
let _mapMarker = null;
let _mapLat = null;
let _mapLon = null;
let _mapLocating = false;

// 内嵌 SVG 红色大头针（避免高德默认图标因网络/cache 加载失败）
const MARKER_SVG = 'data:image/svg+xml;base64,' + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 34">' +
  '<path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.2 11.3 20.5 12.1 21.3.2.2.4.3.7.3.2 0 .4-.1.6-.2.8-.8 12.1-12.1 12.1-21.3C25.5 5.6 19.9 0 12.5 0zm0 19c-3.6 0-6.5-2.9-6.5-6.5S8.9 6 12.5 6s6.5 2.9 6.5 6.5-2.9 6.5-6.5 6.5z" fill="#FF3B30"/></svg>'
);

// === 坐标转换（WGS-84 ? GCJ-02）===
// 火星坐标系偏移量算法
function _transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}
function _transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}

// WGS-84 ? GCJ-02（高德地图专用）
function convertWGS84toGCJ02(lat, lon) {
  return new Promise((resolve) => {
    AMap.convertFrom([lon, lat], 'gps', (status, result) => {
      if (status === 'complete' && result.info === 'ok') {
        const l = result.locations[0];
        resolve({ lat: l.getLat(), lon: l.getLng() });
      } else {
        // API 失效时使用本地算法
        const dlat = _transformLat(lon - 105.0, lat - 35.0);
        const dlon = _transformLon(lon - 105.0, lat - 35.0);
        const radLat = lat / 180.0 * Math.PI;
        let magic = Math.sin(radLat);
        magic = 1 - 0.00669342162296594323 * magic * magic;
        const sqrtMagic = Math.sqrt(magic);
        resolve({ lat: lat + (dlat * 180.0) / ((6378245.0 * (1 - 0.00669342162296594323)) / (magic * sqrtMagic) * Math.PI), lon: lon + (dlon * 180.0) / ((6378245.0 / sqrtMagic) * Math.cos(radLat) * Math.PI) });
      }
    });
  });
}

// GCJ-02 ? WGS-84（迭代逼近，用于地图点选的坐标修正）
function convertGCJ02toWGS84(lat, lon) {
  const dlat = _transformLat(lon - 105.0, lat - 35.0);
  const dlon = _transformLon(lon - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - 0.00669342162296594323 * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const mgLat = lat + (dlat * 180.0) / ((6378245.0 * (1 - 0.00669342162296594323)) / (magic * sqrtMagic) * Math.PI);
  const mgLon = lon + (dlon * 180.0) / ((6378245.0 / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: lat * 2 - mgLat, lon: lon * 2 - mgLon };
}

function openMapPicker() {
  $mapModal.style.display = 'flex';
  $mapCoords.textContent = '定位中…';
  $mapConfirmBtn.textContent = '确定';
  $mapConfirmBtn.disabled = true;
  setTimeout(initMapInstance, 150);
}

function initMapInstance() {
  let initLat = state.lat || 39.9, initLon = state.lon || 116.4;
  let initZoom = (state.lat) ? 14 : 11;

  if (!_mapInstance) {
    _mapInstance = new AMap.Map('mapContainer', {
      center: [initLon, initLat],
      zoom: initZoom,
      mapStyle: 'amap://styles/light',
      zoomEnable: true,
      dragEnable: true,
      resizeEnable: true,
      features: ['bg', 'road', 'building', 'point'],
      showIndoorMap: false
    });

    _mapInstance.on('click', (e) => {
      _mapLat = e.lnglat.getLat();
      _mapLon = e.lnglat.getLng();
      placeMarker(_mapLat, _mapLon);
      updateMapCoordsLabel();
    });

    // GPS ? GCJ-02 转换后定位
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const wgs84 = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          const gcj02 = await convertWGS84toGCJ02(wgs84.lat, wgs84.lon);
          _mapLat = gcj02.lat; _mapLon = gcj02.lon;
          _mapInstance.setCenter([_mapLon, _mapLat]);
          _mapInstance.setZoom(15);
          placeMarker(_mapLat, _mapLon);
          updateMapCoordsLabel();
        },
        () => {
          // GPS 失败 ? 回退到 state 位置
          if (state.lat) {
            _mapLat = state.lat; _mapLon = state.lon;
            _mapInstance.setCenter([_mapLon, _mapLat]);
            _mapInstance.setZoom(14);
            placeMarker(_mapLat, _mapLon);
            updateMapCoordsLabel();
          }
        },
        { timeout: 5000, maximumAge: 60000, enableHighAccuracy: true }
      );
    } else if (state.lat) {
      _mapLat = state.lat; _mapLon = state.lon;
      _mapInstance.setCenter([_mapLon, _mapLat]);
      _mapInstance.setZoom(14);
      placeMarker(_mapLat, _mapLon);
      updateMapCoordsLabel();
    }
  } else {
    // 复用已有实例
    _mapInstance.setCenter([initLon, initLat]);
    _mapInstance.setZoom(initZoom);
    if (_mapMarker) { _mapInstance.remove(_mapMarker); _mapMarker = null; }
    // 尝试 GPS 定位
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const wgs84 = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          const gcj02 = await convertWGS84toGCJ02(wgs84.lat, wgs84.lon);
          _mapLat = gcj02.lat; _mapLon = gcj02.lon;
          _mapInstance.setCenter([_mapLon, _mapLat]);
          _mapInstance.setZoom(15);
          placeMarker(_mapLat, _mapLon);
          updateMapCoordsLabel();
        },
        () => {},
        { timeout: 5000, maximumAge: 60000, enableHighAccuracy: true }
      );
    }
  }
}

function locateOnMap() {
  if (_mapLocating) return;
  if (!_mapInstance) { alert('地图尚未初始化'); return; }
  _mapLocating = true;
  const btn = document.getElementById('mapLocateBtn');
  if (btn) btn.innerHTML = '⏳ 获取当前位置';
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        _mapLocating = false;
        if (btn) btn.innerHTML = '📍 获取当前位置';
        const wgs84 = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const gcj02 = await convertWGS84toGCJ02(wgs84.lat, wgs84.lon);
        _mapLat = gcj02.lat; _mapLon = gcj02.lon;
        _mapInstance.setCenter([_mapLon, _mapLat]);
        _mapInstance.setZoom(16);
        placeMarker(_mapLat, _mapLon);
        updateMapCoordsLabel();
      },
      () => {
        _mapLocating = false;
        if (btn) btn.innerHTML = '📍 获取当前位置';
        alert('定位失败，请检查定位权限');
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  }
}

function placeMarker(lat, lon) {
  if (!_mapInstance) return;
  if (_mapMarker) _mapInstance.remove(_mapMarker);
  // 使用内嵌 SVG 图标（避免高德默认图标资源加载失败的问题）
  _mapMarker = new AMap.Marker({
    position: [lon, lat],
    draggable: true,
    zIndex: 999,
    icon: new AMap.Icon({
      size: new AMap.Size(25, 34),
      imageSize: new AMap.Size(25, 34),
      image: MARKER_SVG,
      imageOffset: new AMap.Pixel(0, 0)
    })
  });
  _mapMarker.on('dragend', (e) => {
    const pos = e.target.getPosition();
    _mapLat = pos.getLat();
    _mapLon = pos.getLng();
    updateMapCoordsLabel();
  });
  _mapMarker.setMap(_mapInstance);
}

function updateMapCoordsLabel() {
  if (_mapLat != null) {
    $mapCoords.textContent = `已选: ${_mapLat.toFixed(4)}, ${_mapLon.toFixed(4)}`;
    $mapConfirmBtn.disabled = false;
  }
}

async function confirmMapPick() {
  if (_mapLat == null) return;
  $mapConfirmBtn.textContent = '…';
  $mapConfirmBtn.disabled = true;

  const latGCJ = _mapLat, lonGCJ = _mapLon;
  // 转换为 WGS-84 用于预报
  const wgs84 = convertGCJ02toWGS84(latGCJ, lonGCJ);

  // 高德逆地理编码
  let cityName = '', country = '';
  const result = await getAmapRegeo(latGCJ, lonGCJ);
  if (result) {
    cityName = result.displayName;
    country = result.country;
  }

  closeMapPicker();
  selectLocation(wgs84.lat, wgs84.lon, cityName || `${latGCJ.toFixed(2)}°N, ${lonGCJ.toFixed(2)}°E`, country);
}

function closeMapPicker() {
  $mapModal.style.display = 'none';
  $mapSearchResults.classList.remove('show');
  $mapSearchInput.value = '';
  if (_mapMarker && _mapInstance) { _mapInstance.remove(_mapMarker); _mapMarker = null; }
  _mapLat = null; _mapLon = null;
}

// === 地图内搜索（高德 REST API — 比 JS API 插件更可靠）===
async function mapSearch() {
  const keyword = $mapSearchInput.value.trim();
  if (!keyword) return;
  $mapSearchResults.innerHTML = '<div class="result-item" style="color:var(--text-dim)">搜索中…</div>';
  $mapSearchResults.classList.add('show');
  try {
    const res = await fetch(`${AMAP_SEARCH_URL}?key=${AMAP_KEY}&keywords=${encodeURIComponent(keyword)}&offset=10`);
    const data = await res.json();
    if (data.status !== '1' || !data.pois || data.pois.length === 0) {
      $mapSearchResults.innerHTML = '<div class="result-item" style="color:var(--text-dim)">未找到地点</div>';
      return;
    }
    $mapSearchResults.innerHTML = data.pois.map((p, i) => {
      const [lng, lat] = p.location.split(',').map(Number);
      const addr = p.address || '';
      return `<div class="result-item" data-idx="${i}">
        <div class="result-name">${p.name}</div>
        <div class="result-detail">${addr} · ${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
      </div>`;
    }).join('');
    $mapSearchResults.querySelectorAll('.result-item').forEach(el => {
      el.addEventListener('click', () => {
        const p = data.pois[+el.dataset.idx];
        const [lng, lat] = p.location.split(',').map(Number);
        // 高德搜索结果已经是 GCJ-02
        _mapLat = lat; _mapLon = lng;
        if (_mapInstance) {
          _mapInstance.setCenter([lng, lat]);
          _mapInstance.setZoom(16);
          placeMarker(lat, lng);
          updateMapCoordsLabel();
        }
        $mapSearchResults.classList.remove('show');
        $mapSearchInput.value = '';
      });
    });
  } catch(e) {
    $mapSearchResults.innerHTML = '<div class="result-item" style="color:var(--bad)">搜索失败，请重试</div>';
  }
}

// === 高德逆地理编码（返回城市名+国家）===
async function getAmapRegeo(lat, lon) {
  try {
    const res = await fetch(
      `https://restapi.amap.com/v3/geocode/regeo?key=${AMAP_KEY}&location=${lon},${lat}&radius=1000&extensions=all`
    );
    const data = await res.json();
    if (data.status === '1' && data.regeocode) {
      const a = data.regeocode.addressComponent;
      const city = a.city || a.province || '';
      const district = a.district || '';
      const displayName = district ? `${city}${district}` : city;
      return { displayName: displayName || a.province || '', country: a.country || '' };
    }
  } catch(e) {
    console.warn('高德逆地理编码失败', e.message);
  }
  return null;
}

// === 获取数据 ===
async function fetchForecast() {
  if (!state.lat || !state.lon) return;
  $loading.style.display = 'block';
  $predictions.innerHTML = '';
  $weatherCard.style.display = 'none';

  const params = new URLSearchParams({
    latitude: state.lat,
    longitude: state.lon,
    hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,precipitation_probability,visibility,temperature_2m,weather_code',
    daily: 'sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: 3
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${FORECAST_URL}?${params}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.forecastData = data;
    renderAll(data);
  } catch(e) {
    console.warn('API获取失败，使用演示数据', e.name, e.message);
    renderDemo();
  } finally {
    $loading.style.display = 'none';
  }
}

// === 渲染全部 ===
function renderAll(data) {
  renderWeather(data);
  renderTabPredictions(data);
  startCountdown(data);
}

function renderWeather(data) {
  $weatherCard.style.display = 'block';
  const di = state.activeTab;
  const daily = data.daily;

  // 取选中日期的一个接近中午的逐时数据
  const dailyTime = daily.time[di];
  const todayHourly = data.hourly.time
    .map((t, i) => i)
    .filter(i => data.hourly.time[i].startsWith(dailyTime));
  const noonIdx = todayHourly[Math.min(11, todayHourly.length - 1)] || todayHourly[0];

  // 天气图标与描述
  const wc = data.hourly.weather_code ? data.hourly.weather_code[noonIdx] : 0;
  $weatherIcon.textContent = getWeatherIcon(wc);

  // 温度
  const tmax = daily.temperature_2m_max ? daily.temperature_2m_max[di] : null;
  const tmin = daily.temperature_2m_min ? daily.temperature_2m_min[di] : null;
  const tnow = data.hourly.temperature_2m[noonIdx];
  $weatherTemp.textContent = tnow != null ? `${Math.round(tnow)}°` : '--°';
  $weatherDesc.textContent = tmax != null ? `${getWeatherDesc(wc)} · 最高 ${Math.round(tmax)}° / 最低 ${Math.round(tmin)}°` : getWeatherDesc(wc);

  // 综合当前时段数据
  $wdHumidity.textContent = data.hourly.relative_humidity_2m[noonIdx] + '%';
  $wdCloud.textContent = data.hourly.cloud_cover[noonIdx] + '%';
  $wdVisibility.textContent = (data.hourly.visibility[noonIdx] / 1000).toFixed(1) + 'km';
  $wdPrecip.textContent = (daily.precipitation_probability_max ? daily.precipitation_probability_max[di] : data.hourly.precipitation_probability[noonIdx]) + '%';
}

function getWeatherIcon(code) {
  if (code <= 1) return '☀️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code <= 49) return '🌫️';
  if (code <= 59) return '🌧️';
  if (code <= 69) return '🌨️';
  if (code <= 79) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 86) return '🌨️';
  if (code <= 99) return '⛈️';
  return '🌤️';
}

function getWeatherDesc(code) {
  if (code <= 1) return '晴朗';
  if (code === 2) return '多云';
  if (code === 3) return '阴天';
  if (code <= 49) return '雾/霾';
  if (code <= 59) return '小雨';
  if (code <= 69) return '雨夹雪';
  if (code <= 79) return '雪';
  if (code <= 82) return '阵雨';
  if (code <= 86) return '阵雪';
  if (code <= 99) return '雷暴';
  return '局部多云';
}

// === 选项卡 ===
function handleTabClick(e) {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  state.activeTab = +btn.dataset.tab;
  updateTabUI();
  if (state.forecastData) {
    renderWeather(state.forecastData);
    renderTabPredictions(state.forecastData);
  }
}

function updateTabUI() {
  $tabBar.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', +b.dataset.tab === state.activeTab);
  });
  // 更新日期标签
  if (state.forecastData && state.forecastData.daily.time[state.activeTab]) {
    const dateStr = state.forecastData.daily.time[state.activeTab];
    $tabDate.textContent = formatTabDate(dateStr);
  }
}

function formatTabDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target - today) / 86400000);
  const weekday = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
  const mm = d.getMonth() + 1, dd = d.getDate();
  const datePart = `${mm}月${dd}日 ${weekday}`;
  if (diff === 0) return `📍 今天 · ${datePart}`;
  if (diff === 1) return `📍 明天 · ${datePart}`;
  return `📍 ${datePart}`;
}

// === 渲染选项卡预测 ===
function renderTabPredictions(data) {
  updateTabUI();
  const di = state.activeTab;
  const daily = data.daily;
  if (!daily || !daily.time[di]) { $predictions.innerHTML = ''; return; }

  const dateStr = daily.time[di];
  const hourlyIndices = data.hourly.time
    .map((t, i) => i)
    .filter(i => data.hourly.time[i].startsWith(dateStr));

  const sunriseISO = daily.sunrise[di];
  const sunsetISO = daily.sunset[di];

  // 朝霞：日落前1小时左右的逐时数据
  const sr = new Date(sunriseISO);
  const srHour = sr.getHours();
  const morningIdx = hourlyIndices.find(i => {
    const h = new Date(data.hourly.time[i]).getHours();
    return h >= srHour - 1 && h <= srHour + 1;
  }) || hourlyIndices[0];

  // 晚霞：日落前1小时左右的逐时数据
  const ss = new Date(sunsetISO);
  const ssHour = ss.getHours();
  const eveningIdx = hourlyIndices.find(i => {
    const h = new Date(data.hourly.time[i]).getHours();
    return h >= ssHour - 1 && h <= ssHour + 1;
  }) || hourlyIndices[Math.min(hourlyIndices.length - 1, 17)];

  const morningData = extractHourlyData(data, morningIdx);
  const eveningData = extractHourlyData(data, eveningIdx);

  const morningScore = calcScore(morningData, 'morning');
  const eveningScore = calcScore(eveningData, 'evening');

  const morningTips = buildTips(morningData, 'morning');
  const eveningTips = buildTips(eveningData, 'evening');

  const dateLabel = formatTabDate(dateStr);

  $predictions.innerHTML =
    buildPredictionCard('🌄 朝霞预测', 'morning', morningScore, morningData, morningTips, sunriseISO, dateLabel) +
    buildPredictionCard('🌇 晚霞预测', 'evening', eveningScore, eveningData, eveningTips, sunsetISO, dateLabel);
}

function extractHourlyData(data, idx) {
  return {
    cloudCover: data.hourly.cloud_cover[idx],
    cloudLow: data.hourly.cloud_cover_low[idx],
    cloudMid: data.hourly.cloud_cover_mid[idx],
    cloudHigh: data.hourly.cloud_cover_high[idx],
    humidity: data.hourly.relative_humidity_2m[idx],
    precipProb: data.hourly.precipitation_probability[idx],
    visibility: data.hourly.visibility[idx],
    temp: data.hourly.temperature_2m[idx],
  };
}

// === 评分算法 ===
function calcScore(d, type) {
  let score = 100;

  // 中高层云：载体，25-65%最佳
  const cloudMH = Math.max(d.cloudMid, d.cloudHigh);
  if (cloudMH < 5) score -= 30;
  else if (cloudMH < 15) score -= 20;
  else if (cloudMH < 25) score -= 10;
  else if (cloudMH <= 65) score -= 0;
  else if (cloudMH <= 80) score -= 10;
  else score -= 25;

  // 低云：越低越好
  if (d.cloudLow > 60) score -= 30;
  else if (d.cloudLow > 35) score -= 18;
  else if (d.cloudLow > 15) score -= 6;

  // 总云量
  if (d.cloudCover > 95) score -= 20;
  else if (d.cloudCover > 80) score -= 10;
  else if (d.cloudCover < 5) score -= 8;

  // 湿度：40-70%最佳
  if (d.humidity > 90) score -= 15;
  else if (d.humidity > 80) score -= 8;
  else if (d.humidity < 25) score -= 10;

  // 降水
  if (d.precipProb > 50) score -= 25;
  else if (d.precipProb > 25) score -= 12;
  else if (d.precipProb > 10) score -= 4;

  // 能见度
  if (d.visibility < 2000) score -= 20;
  else if (d.visibility < 5000) score -= 10;
  else if (d.visibility < 8000) score -= 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// === 摄影建议 ===
function buildTips(d, type) {
  const tips = [];
  const cloudMH = Math.max(d.cloudMid, d.cloudHigh);

  if (cloudMH >= 15 && cloudMH <= 65) {
    tips.push('✨ <strong>最佳云层条件</strong>——中高层云量适中，霞光色彩层次丰富。');
  } else if (cloudMH > 65) {
    tips.push('☁️ 中高层云偏多，霞光可能被遮挡，<strong>适合拍摄厚重氛围感</strong>。');
  } else {
    tips.push('🌤️ 云量偏少，霞光可能较为清淡，<strong>适合拍摄剪影</strong>风格。');
  }

  if (d.cloudLow > 35) {
    tips.push('⚠️ 低云较多，地平线附近可能被遮挡，<strong>建议找高地或制高点</strong>拍摄。');
  }

  if (d.humidity > 80) {
    tips.push('💧 湿度偏高，注意<strong>镜头防雾</strong>，可备暖宝宝贴在镜筒上。');
  }

  if (d.visibility < 4000) {
    tips.push('🌫️ 能见度偏低，后期需加强<strong>去雾处理</strong>。');
  }

  if (d.precipProb > 30) {
    tips.push('🌧️ 降水概率较高，带上<strong>防水装备</strong>，雨后初晴反而可能出大片。');
  }

  if (d.visibility > 8000 && cloudMH >= 20 && cloudMH <= 55 && d.humidity >= 30 && d.humidity <= 65) {
    tips.unshift('🎯 <strong>完美条件</strong>——各项指标都在理想范围，大概率出片！');
  }

  if (type === 'morning' && d.temp < 10) {
    tips.push('🥶 清晨气温低，注意<strong>保暖和电池续航</strong>。');
  }

  return tips.join('<br>');
}

// === 构建预测卡片 ===
function buildPredictionCard(label, type, score, data, tips, timeISO, dateLabel) {
  const typeCls = type === 'morning' ? 'morning' : 'evening';
  const timeStr = new Date(timeISO).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  let scoreColor = '#ff4444';
  if (score >= 90) scoreColor = '#e040fb';
  else if (score >= 70) scoreColor = '#4caf50';
  else if (score >= 50) scoreColor = '#ffeb3b';
  else if (score >= 30) scoreColor = '#ff9800';

  const verdictMap = [
    { min: 90, text: '🔥 必出大片', emoji: '🔥' },
    { min: 70, text: '✨ 强烈推荐出动', emoji: '✨' },
    { min: 50, text: '👀 值得期待', emoji: '👀' },
    { min: 30, text: '🤔 有一定可能', emoji: '🤔' },
    { min: 0,  text: '😴 不太理想', emoji: '😴' },
  ];
  const verdict = verdictMap.find(v => score >= v.min);

  const factors = [
    { name: '中高层云', val: Math.max(data.cloudMid, data.cloudHigh) + '%',
      cls: Math.max(data.cloudMid, data.cloudHigh) >= 15 && Math.max(data.cloudMid, data.cloudHigh) <= 65 ? 'good' : Math.max(data.cloudMid, data.cloudHigh) > 80 ? 'bad' : 'warn' },
    { name: '低云', val: data.cloudLow + '%',
      cls: data.cloudLow > 35 ? 'bad' : data.cloudLow > 15 ? 'warn' : 'good' },
    { name: '总云量', val: data.cloudCover + '%',
      cls: data.cloudCover > 85 ? 'bad' : data.cloudCover < 5 ? 'warn' : 'good' },
    { name: '湿度', val: data.humidity + '%',
      cls: data.humidity > 85 ? 'bad' : data.humidity < 25 ? 'warn' : 'good' },
    { name: '降水概率', val: data.precipProb + '%',
      cls: data.precipProb > 30 ? 'bad' : data.precipProb > 10 ? 'warn' : 'good' },
    { name: '能见度', val: (data.visibility / 1000).toFixed(1) + 'km',
      cls: data.visibility < 3000 ? 'bad' : data.visibility < 6000 ? 'warn' : 'good' },
  ];

  const eventLabel = type === 'morning' ? '日出' : '日落';

  return `
  <div class="prediction-card">
    <div class="card-header">
      <span class="card-label">${label}</span>
      <span class="card-type ${typeCls}">${dateLabel}</span>
    </div>
    <div class="card-body">
      <div class="score-row">
        <div class="score-circle" style="border-color:${scoreColor}; color:${scoreColor}">
          ${score}<span class="score-label">分</span>
        </div>
        <div class="score-text">
          <div class="score-verdict">${verdict ? verdict.emoji + ' ' + verdict.text : '—'}</div>
          <div class="score-desc">${eventLabel}时间 ${timeStr}</div>
        </div>
      </div>
      <div class="factors">
        ${factors.map(f => `
          <div class="factor">
            <span class="factor-name">${f.name}</span>
            <span class="factor-val ${f.cls}">${f.val}</span>
          </div>
        `).join('')}
      </div>
      ${tips ? `<div class="card-tips">${tips}</div>` : ''}
    </div>
  </div>`;
}

// === 倒计时 ===
function startCountdown(data) {
  if (state.countdownTimer) clearInterval(state.countdownTimer);

  const tick = () => {
    const now = new Date();
    const daily = data.daily;

    // 找到当前选项卡对应日期的日出日落
    const di = state.activeTab;
    const dateStr = daily.time[di];
    if (!daily.sunrise[di] || !daily.sunset[di]) return;

    const sr = new Date(daily.sunrise[di]);
    const ss = new Date(daily.sunset[di]);

    $sunriseTime.textContent = sr.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    $sunsetTime.textContent = ss.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    // 倒计时：距离最近的日出或日落事件
    // 找所有日出日落时间，找到下一个
    const events = [];
    for (let d = 0; d < 3; d++) {
      if (daily.sunrise[d]) events.push({ time: new Date(daily.sunrise[d]), type: '🌄 日出', dayIdx: d });
      if (daily.sunset[d]) events.push({ time: new Date(daily.sunset[d]), type: '🌇 日落', dayIdx: d });
    }
    events.sort((a, b) => a.time - b.time);

    let nextEvent = events.find(e => e.time > now);
    if (!nextEvent && events.length > 0) nextEvent = events[0]; // should not happen with 3 days

    // 更新太阳块内的倒计时
    const srDiff = sr - now;
    const ssDiff = ss - now;
    $sunriseCountdown.textContent = srDiff > 0 ? formatDuration(srDiff) : '已过';
    $sunsetCountdown.textContent = ssDiff > 0 ? formatDuration(ssDiff) : '已过';
    $sunriseCountdown.classList.toggle('urgent', srDiff > 0 && srDiff < 3600000);
    $sunsetCountdown.classList.toggle('urgent', ssDiff > 0 && ssDiff < 3600000);

    // 倒计时大条：下一次日出/日落
    if (nextEvent) {
      const diff = nextEvent.time - now;
      const dayLabel = nextEvent.dayIdx === 0 ? '今天' : nextEvent.dayIdx === 1 ? '明天' : '后天';
      const timeStr = nextEvent.time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      if (diff < 3600000) {
        $countdownBar.innerHTML = `⏰ <strong>${nextEvent.type}</strong> 即将到来 · ${dayLabel} ${timeStr} · 还有 <strong>${formatDuration(diff)}</strong>`;
        $countdownBar.style.background = nextEvent.type.includes('日出') ? 'rgba(255,152,0,0.18)' : 'rgba(224,64,251,0.18)';
      } else if (diff < 7200000) {
        $countdownBar.innerHTML = `📷 <strong>${nextEvent.type}</strong> 临近 · ${dayLabel} ${timeStr} · 还有 ${formatDuration(diff)}`;
        $countdownBar.style.background = nextEvent.type.includes('日出') ? 'rgba(255,152,0,0.1)' : 'rgba(224,64,251,0.1)';
      } else {
        $countdownBar.innerHTML = `📷 距离 <strong>${nextEvent.type}</strong> · ${dayLabel} ${timeStr} · ${formatDuration(diff)}`;
        $countdownBar.style.background = 'rgba(255,152,0,0.05)';
      }
    }
  };

  tick();
  state.countdownTimer = setInterval(tick, 1000);
}

function formatDuration(ms) {
  if (ms <= 0) return '0秒';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}小时${String(m).padStart(2, '0')}分${String(s).padStart(2, '0')}秒`;
}

// === 演示模式 ===
function renderDemo() {
  const now = new Date();
  const daily = { time: [], sunrise: [], sunset: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [] };
  const hourly = { time: [], cloud_cover: [], cloud_cover_low: [], cloud_cover_mid: [],
    cloud_cover_high: [], relative_humidity_2m: [], precipitation_probability: [],
    visibility: [], temperature_2m: [], weather_code: [] };

  const scenarios = [
    { cc: 55, cl: 8,  cm: 40, ch: 45, hum: 52, pp: 3,  vis: 9000,  tmp: 23, wc: 2,  tmax: 27, tmin: 18, ppmax: 8 },
    { cc: 35, cl: 5,  cm: 20, ch: 25, hum: 42, pp: 0,  vis: 12000, tmp: 25, wc: 1,  tmax: 29, tmin: 19, ppmax: 0 },
    { cc: 78, cl: 50, cm: 65, ch: 55, hum: 78, pp: 40, vis: 3500,  tmp: 20, wc: 61, tmax: 24, tmin: 16, ppmax: 55 },
  ];

  for (let d = 0; d < 3; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().slice(0, 10);
    daily.time.push(dateStr);

    const sunriseD = new Date(date);
    sunriseD.setHours(4, 46 + Math.floor(Math.random() * 15), 0, 0);
    const sunsetD = new Date(date);
    sunsetD.setHours(19, 35 + Math.floor(Math.random() * 20), 0, 0);
    daily.sunrise.push(sunriseD.toISOString());
    daily.sunset.push(sunsetD.toISOString());

    const sc = scenarios[d % 3];
    daily.temperature_2m_max.push(sc.tmax);
    daily.temperature_2m_min.push(sc.tmin);
    daily.precipitation_probability_max.push(sc.ppmax);

    for (let h = 0; h < 24; h++) {
      const t = new Date(date);
      t.setHours(h, 0, 0, 0);
      hourly.time.push(t.toISOString());
      const jitter = Math.sin(h / 4) * 8;
      hourly.cloud_cover.push(Math.min(100, Math.max(0, Math.round(sc.cc + jitter))));
      hourly.cloud_cover_low.push(Math.min(100, Math.max(0, Math.round(sc.cl + jitter * 0.3))));
      hourly.cloud_cover_mid.push(Math.min(100, Math.max(0, Math.round(sc.cm + jitter * 0.7))));
      hourly.cloud_cover_high.push(Math.min(100, Math.max(0, Math.round(sc.ch + jitter * 0.5))));
      hourly.relative_humidity_2m.push(Math.min(100, Math.max(10, Math.round(sc.hum - jitter * 0.2))));
      hourly.precipitation_probability.push(Math.min(100, Math.max(0, Math.round(sc.pp + (h > 14 ? 3 : 0)))));
      hourly.visibility.push(Math.round(sc.vis + jitter * 180));
      hourly.temperature_2m.push(Math.round(sc.tmp + Math.sin(h / 6) * 4));
      hourly.weather_code.push(sc.wc);
    }
  }

  const data = { daily, hourly };
  state.forecastData = data;
  renderAll(data);

  const banner = document.createElement('div');
  banner.className = 'demo-banner';
  banner.textContent = '⚠️ 当前为演示模式，数据为模拟。联网后将展示真实预测。';
  $predictions.insertAdjacentElement('beforebegin', banner);
}

// === 启动 ===
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

console.log('🌅 朝霞晚霞预测 v2 · 摄影助手已就绪');
