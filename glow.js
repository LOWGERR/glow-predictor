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

  // 附近搜索弹窗
  const $nClose = document.getElementById('nearbyClose');
  if ($nClose) $nClose.addEventListener('click', closeNearbyModal);


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

// WGS-84 → GCJ-02（同步版，不依赖 AMap JS API，用于 REST API 调用）
function wgs84ToGcj02(lat, lon) {
  const dlat = _transformLat(lon - 105.0, lat - 35.0);
  const dlon = _transformLon(lon - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - 0.00669342162296594323 * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const gcjLat = lat + (dlat * 180.0) / ((6378245.0 * (1 - 0.00669342162296594323)) / (magic * sqrtMagic) * Math.PI);
  const gcjLon = lon + (dlon * 180.0) / ((6378245.0 / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: gcjLat, lon: gcjLon };
}

// WGS-84 ? GCJ-02（高德地图专用，使用 AMap JS API 或回退本地算法）
function convertWGS84toGCJ02(lat, lon) {
  return new Promise((resolve) => {
    AMap.convertFrom([lon, lat], 'gps', (status, result) => {
      if (status === 'complete' && result.info === 'ok') {
        const l = result.locations[0];
        resolve({ lat: l.getLat(), lon: l.getLng() });
      } else {
        // API 失效时使用本地算法
        resolve(wgs84ToGcj02(lat, lon));
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

// === 附近摄影点搜索（基于高德 POI 搜索）===
let _nearbyType = '';

// 不区分 morning/evening 时使用的默认偏移
const NEARBY_CATEGORIES = {
  // 每个分类只用单个关键词（避免高德API分号OR的不可靠行为）
  '景点': { keywords: '景点', label: '📍 景点' },
  '公园': { keywords: '公园', label: '🌳 公园' },
  '广场': { keywords: '广场', label: '🏛️ 广场' },
  '观景台': { keywords: '观景台', label: '🏔️ 观景台' },
  '桥': { keywords: '桥', label: '🌉 桥' },
  '寺庙': { keywords: '寺庙', label: '⛩️ 寺庙' },
  '湖泊': { keywords: '水库', label: '💧 湖泊/水库' },
  '文创': { keywords: '文创', label: '🎨 文创' },
};

// 缓存每个分类是否有结果（避免反复请求）
let _nearbyCache = {};

function openNearbySearch(type) {
  _nearbyType = type || '';
  _nearbyCache = {};
  document.getElementById('nearbyModal').style.display = 'flex';
  document.body.classList.add('no-scroll');
  const resultsEl = document.getElementById('nearbyResults');
  resultsEl.innerHTML = '<div class="nearby-empty">🔍 搜索中…</div>';
  // 并行查询所有分类
  queryAllCategories();
}

function closeNearbyModal() {
  document.getElementById('nearbyModal').style.display = 'none';
  document.body.classList.remove('no-scroll');
}

async function queryAllCategories() {
  const catKeys = Object.keys(NEARBY_CATEGORIES);
  const hasResults = {};
  const allItems = {};

  // 串行查询每个分类，避免高德 API 并发限流
  for (const key of catKeys) {
    try {
      const items = await searchNearbyPOI(key);
      const cacheKey = `${_nearbyType}_${key}`;
      if (items && items.length > 0) {
        hasResults[key] = true;
        allItems[key] = items;
        _nearbyCache[cacheKey] = items;
      } else {
        hasResults[key] = false;
        allItems[key] = [];
      }
    } catch(e) {
      hasResults[key] = false;
      allItems[key] = [];
    }
  }

  // 有结果的分类才显示按钮
  const activeCats = catKeys.filter(k => hasResults[k]);
  if (activeCats.length === 0) {
    renderNearbyCategories([]);
    document.getElementById('nearbyResults').innerHTML = '<div class="nearby-empty">附近未找到摄影点，试试其他位置</div>';
    return;
  }

  renderNearbyCategories(activeCats);
  // 默认显示第一个有结果的分类
  const first = activeCats[0];
  renderNearbyResults(first, allItems[first]);
}

function renderNearbyCategories(activeCats) {
  const container = document.getElementById('nearbyCategories');
  if (activeCats.length === 0) {
    container.innerHTML = '<span style="font-size:0.78rem;color:var(--text-dim);padding:6px 0">无可用分类</span>';
    return;
  }
  container.innerHTML = activeCats.map((key, idx) =>
    `<button class="nearby-cat-btn${idx === 0 ? ' active' : ''}" data-cat="${key}">${NEARBY_CATEGORIES[key].label}</button>`
  ).join('');

  // 重新绑定点击事件
  container.querySelectorAll('.nearby-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.nearby-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.cat;
      const cacheKey = `${_nearbyType}_${cat}`;
      if (_nearbyCache[cacheKey]) {
        renderNearbyResults(cat, _nearbyCache[cacheKey]);
      } else {
        document.getElementById('nearbyResults').innerHTML = '<div class="nearby-empty">🔍 搜索中…</div>';
        searchNearbyPOI(cat).then(items => {
          if (items && items.length > 0) {
            _nearbyCache[cacheKey] = items;
            renderNearbyResults(cat, items);
          } else {
            document.getElementById('nearbyResults').innerHTML = '<div class="nearby-empty">该分类附近没有找到</div>';
          }
        });
      }
    });
  });
}

function renderNearbyResults(category, items) {
  if (!items || items.length === 0) {
    document.getElementById('nearbyResults').innerHTML = '<div class="nearby-empty">未找到附近摄影点，试试其他分类</div>';
    return;
  }

  document.getElementById('nearbyResults').innerHTML = items.map((p, i) => {
    const safeName = p.name.replace(/'/g, "\\'");
    return `
      <div class="nearby-item" onclick="selectNearbyPOI(${p.lat}, ${p.lng}, '${safeName}')">
        <span class="nearby-rank">${i+1}</span>
        <div class="nearby-info">
          <div class="nearby-name">${p.name} ${p.dirScore}</div>
          <div class="nearby-detail">${p.dist}m · ${p.type || (category || '景点')}</div>
        </div>
        <button class="nearby-nav-btn" onclick="event.stopPropagation();navigateToPOI(${p.lat}, ${p.lng}, '${safeName}')" title="导航前往">🗺️</button>
      </div>
    `;
  }).join('');
}

async function searchNearbyPOI(category) {
  if (!state.lat || !state.lon) return [];

  const catConfig = NEARBY_CATEGORIES[category];
  if (!catConfig) return [];

  const kw = catConfig.keywords || category;

  // 直接用当前位置坐标（偏移逻辑已移除，用户自己在地图选点更准确）
  const gcj = wgs84ToGcj02(state.lat, state.lon);
  const searchLon = gcj.lon;
  const searchLat = gcj.lat;

  try {
    const res = await fetch(
      `https://restapi.amap.com/v3/place/around?key=${AMAP_KEY}&location=${searchLon},${searchLat}&radius=10000&keywords=${encodeURIComponent(kw)}&offset=15&page=1&extensions=base`
    );
    const data = await res.json();
    if (data.status !== '1' || !data.pois || data.pois.length === 0) return [];

    const seen = new Set();
    const items = data.pois
      .filter(p => {
        const key = p.name + p.location;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(p => {
        const [lng, lat] = p.location.split(',').map(Number);
        const dist = Math.round(distance(state.lat, state.lon, lat, lng));
        const dir = bearing(state.lat, state.lon, lat, lng);
        const sunDir = _nearbyType === 'morning' ? 90 : 270;
        const dirScore = Math.abs(dir - sunDir) <= 45 ? '⭐' : '';
        return { ...p, lat, lng, dist, dir, dirScore };
      })
      .sort((a, b) => {
        if (a.dirScore && !b.dirScore) return -1;
        if (!a.dirScore && b.dirScore) return 1;
        return a.dist - b.dist;
      })
      .slice(0, 10);

    // 写入缓存（不再写入，由调用方负责）
    _nearbyCache[`${_nearbyType}_${category}`] = items;
    return items;
  } catch(e) {
    return [];
  }
}

function selectNearbyPOI(lat, lng, name) {
  selectLocation(lat, lng, name, '');
  closeNearbyModal();
  // 在地图选择器上标记该点
  showNearbyPOIOnMap(lat, lng, name);
}

// 附近摄影点 → 地图标记展示
function showNearbyPOIOnMap(lat, lng, name) {
  // 先打开地图选择器
  $mapModal.style.display = 'flex';
  $mapCoords.textContent = `📸 ${name}`;
  $mapConfirmBtn.textContent = '确定';
  $mapConfirmBtn.disabled = false;
  setTimeout(() => {
    if (typeof AMap === 'undefined') return;

    // 初始化地图实例（如果还没有）
    if (!_mapInstance) {
      _mapInstance = new AMap.Map('mapContainer', {
        center: [lng, lat],
        zoom: 16,
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
    } else {
      _mapInstance.setCenter([lng, lat]);
      _mapInstance.setZoom(16);
      if (_mapMarker) { _mapInstance.remove(_mapMarker); _mapMarker = null; }
    }

    _mapLat = lat; _mapLon = lng;
    placeMarker(lat, lng);
    // 加信息窗口
    const info = new AMap.InfoWindow({
      content: `<div style="font-size:14px;color:#333;padding:4px 8px">📸 ${name}<br><span onclick="navigateToPOI(${lat},${lng},'${name.replace(/'/g, "\\'")}')" style="font-size:12px;color:#1677ff;text-decoration:none;cursor:pointer">🗺️ 导航前往</span></div>`,
      offset: new AMap.Pixel(0, -30)
    });
    info.open(_mapInstance, [lng, lat]);
    updateMapCoordsLabel();
  }, 300);
}

// 一键导航到指定 POI（打开高德地图 app / 网页）
function navigateToPOI(lat, lng, name) {
  // 先转换 WGS-84 → GCJ-02（高德坐标）
  const gcj = wgs84ToGcj02(lat, lng);
  const url = `https://uri.amap.com/navigation?to=${gcj.lon},${gcj.lat},${encodeURIComponent(name)}&mode=car&coordinate=gaode`;
  window.location.href = url;
}

// 附近搜索：自定义关键词（用户输入）
function distance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
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
        const idx = +el.dataset.idx;
        const p = data.pois[idx];
        if (!p) return;
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
    forecast_days: 3,
    models: 'ecmwf_ifs'
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${FORECAST_URL}?${params}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // 标记数据来源
    data._source = data.meta && data.meta.models ? 'ECMWF' : 'Open-Meteo';
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

  // 朝霞：最接近日出时刻的逐时数据
  const sr = new Date(sunriseISO);
  const srHour = sr.getHours() + sr.getMinutes() / 60;
  let morningIdx = hourlyIndices[0];
  let minDiff = Infinity;
  hourlyIndices.forEach(i => {
    const h = new Date(data.hourly.time[i]).getHours() + new Date(data.hourly.time[i]).getMinutes() / 60;
    const diff = Math.abs(h - srHour);
    if (diff < minDiff) { minDiff = diff; morningIdx = i; }
  });

  // 晚霞：最接近日落时刻的逐时数据
  const ss = new Date(sunsetISO);
  const ssHour = ss.getHours() + ss.getMinutes() / 60;
  let eveningIdx = hourlyIndices[Math.min(hourlyIndices.length - 1, 18)];
  let minDiffE = Infinity;
  hourlyIndices.forEach(i => {
    const h = new Date(data.hourly.time[i]).getHours() + new Date(data.hourly.time[i]).getMinutes() / 60;
    const diff = Math.abs(h - ssHour);
    if (diff < minDiffE) { minDiffE = diff; eveningIdx = i; }
  });

  const morningData = extractHourlyData(data, morningIdx);
  const eveningData = extractHourlyData(data, eveningIdx);

  const morningProb = calcProbability(morningData, 'morning');
  const morningQuality = calcQuality(morningData, 'morning');
  const morningScore = calcScore(morningData, 'morning');
  const eveningProb = calcProbability(eveningData, 'evening');
  const eveningQuality = calcQuality(eveningData, 'evening');
  const eveningScore = calcScore(eveningData, 'evening');

  const morningTips = buildTips(morningData, 'morning');
  const eveningTips = buildTips(eveningData, 'evening');

  const morningChart = buildCloudTrendChart(data, di, 'morning');
  const eveningChart = buildCloudTrendChart(data, di, 'evening');

  const dateLabel = formatTabDate(dateStr);

  $predictions.innerHTML =
    buildPredictionCard('🌄 朝霞预测', 'morning', morningScore, morningProb, morningQuality, morningData, morningTips, sunriseISO, dateLabel, morningChart) +
    buildPredictionCard('🌇 晚霞预测', 'evening', eveningScore, eveningProb, eveningQuality, eveningData, eveningTips, sunsetISO, dateLabel, eveningChart);
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

// === 评分算法（拆分版：概率 × 质量）===
// 概率：霞光出现的可能性（%），主要看遮挡因素
// 质量：霞光色彩壮观度（%），主要看散射条件
function calcProbability(d, type) {
  let prob = 100;

  // 中高层云：需要有云才能显色，但又不能太多遮住
  const cloudMH = Math.max(d.cloudMid, d.cloudHigh);
  if (cloudMH < 5)  prob -= 35; // 没云就几乎没有霞
  else if (cloudMH < 15) prob -= 20;
  else if (cloudMH < 25) prob -= 10;
  else if (cloudMH <= 70) prob -= 0;
  else if (cloudMH <= 85) prob -= 15;
  else prob -= 30;

  // 低云：遮挡地平线
  if (d.cloudLow > 60) prob -= 25;
  else if (d.cloudLow > 35) prob -= 15;
  else if (d.cloudLow > 15) prob -= 5;

  // 降水：直接取消
  if (d.precipProb > 60) prob -= 30;
  else if (d.precipProb > 30) prob -= 15;
  else if (d.precipProb > 10) prob -= 5;

  // 总云量极端情况
  if (d.cloudCover > 95) prob -= 20;

  return Math.max(0, Math.min(100, Math.round(prob)));
}

function calcQuality(d, type) {
  let quality = 100;

  // 中高层云：色彩载体，30-60%最理想
  const cloudMH = Math.max(d.cloudMid, d.cloudHigh);
  if (cloudMH < 5)  quality -= 40;
  else if (cloudMH < 15) quality -= 25;
  else if (cloudMH < 25) quality -= 10;
  else if (cloudMH >= 20 && cloudMH <= 60) quality += 5; // 奖励
  else if (cloudMH <= 75) quality -= 5;
  else if (cloudMH <= 85) quality -= 15;
  else quality -= 30;

  // 低云：越少越好
  if (d.cloudLow > 60) quality -= 25;
  else if (d.cloudLow > 35) quality -= 15;
  else if (d.cloudLow > 15) quality -= 5;

  // 湿度：40-70%最佳色彩饱和度
  if (d.humidity < 25) quality -= 15; // 太干
  else if (d.humidity > 85) quality -= 12;
  else if (d.humidity > 75) quality -= 5;
  else if (d.humidity >= 35 && d.humidity <= 65) quality += 5; // 奖励

  // 能见度：影响色彩通透度
  if (d.visibility < 2000) quality -= 25;
  else if (d.visibility < 5000) quality -= 15;
  else if (d.visibility < 8000) quality -= 5;
  else quality += 5; // 通透奖励

  return Math.max(0, Math.min(100, Math.round(quality)));
}

// === 云层趋势图：SVG 折线图，显示日出/日落前后 ±2h 的云量趋势 ===
// data: 完整 forecast data object, di: day index, type: 'morning'|'evening'
function buildCloudTrendChart(data, di, type) {
  const daily = data.daily;
  const hourly = data.hourly;
  const dateStr = daily.time[di];
  if (!dateStr) return '';

  // 找到日出/日落时间的小时
  const eventISO = type === 'morning' ? daily.sunrise[di] : daily.sunset[di];
  if (!eventISO) return '';
  const eventDate = new Date(eventISO);
  const eventHour = eventDate.getHours();

  // 取该日期所有逐时索引
  const indices = hourly.time
    .map((t, i) => ({ i, h: new Date(t).getHours() }))
    .filter(x => hourly.time[x.i].startsWith(dateStr));

  // 找到 ±2h 窗口（共 5 个点）
  const windowStart = eventHour - 2;
  const windowEnd = eventHour + 2;
  const windowIndices = indices
    .filter(x => x.h >= windowStart && x.h <= windowEnd)
    .sort((a, b) => a.h - b.h);

  if (windowIndices.length < 2) return '';

  // 提取数据系列
  const series = [
    { key: 'cloud_cover', label: '总云量', color: '#8888cc' },
    { key: 'cloud_cover_mid', label: '中云', color: '#ff9800' },
    { key: 'cloud_cover_high', label: '高云', color: '#e040fb' },
  ];

  // 找到数据范围（留边距）
  let minVal = 0, maxVal = 100;

  const W = 240, H = 60, PAD = { top: 6, bottom: 14, left: 26, right: 10 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xScale = (idx) => PAD.left + (idx / (windowIndices.length - 1)) * plotW;
  const yScale = (v) => PAD.top + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

  // 构建 SVG path
  let paths = '';
  series.forEach(s => {
    const pts = windowIndices.map((wi, idx) => {
      const v = hourly[s.key][wi.i] ?? 50;
      return `${xScale(idx)},${yScale(v)}`;
    });
    const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p).join(' ');
    // 渐变填充
    const fillId = `fill_${s.key.replace(/_/g,'')}`;
    paths += `<defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${s.color}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${s.color}" stop-opacity="0.02"/>
    </linearGradient></defs>`;
    // 填充区域（从底部到 line）
    const bottomY = yScale(0);
    const fillD = `M${pts[0].split(',')[0]},${bottomY} L${pts.map(p => p).join(' L')} L${pts[pts.length-1].split(',')[0]},${bottomY} Z`;
    paths += `<path d="${fillD}" fill="url(#${fillId})" />`;
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`;
    // 数据点
    pts.forEach((p, i) => {
      const [px, py] = p.split(',').map(Number);
      paths += `<circle cx="${px}" cy="${py}" r="1.8" fill="${s.color}" opacity="0.9"/>`;
    });
  });

  // X 轴标签
  let xLabels = '';
  windowIndices.forEach((wi, idx) => {
    const label = `${wi.h}:00`;
    const x = xScale(idx);
    xLabels += `<text x="${x}" y="${H - 2}" text-anchor="middle" font-size="7" fill="#666">${label}</text>`;
  });

  // Y 轴标签
  const yTicks = [0, 25, 50, 75, 100];
  let yLabels = '';
  yTicks.forEach(v => {
    const y = yScale(v);
    yLabels += `<text x="${PAD.left - 3}" y="${y + 2.5}" text-anchor="end" font-size="6.5" fill="#555">${v}</text>`;
    yLabels += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#222" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.4"/>`;
  });

  // 事件垂直线（日出/日落时刻）
  const eventIdx = windowIndices.findIndex(wi => wi.h === eventHour);
  if (eventIdx >= 0) {
    const ex = xScale(eventIdx);
    paths += `<line x1="${ex}" y1="${PAD.top}" x2="${ex}" y2="${H - PAD.bottom}" stroke="#ff6" stroke-width="1" stroke-dasharray="3,2" opacity="0.8"/>`;
    paths += `<text x="${ex}" y="${PAD.top - 1}" text-anchor="middle" font-size="6.5" fill="#ff6" opacity="0.9">${type === 'morning' ? '🌅' : '🌇'}</text>`;
  }

  // 图例
  let legend = '';
  series.forEach((s, i) => {
    const lx = PAD.left + i * 58;
    legend += `<line x1="${lx}" y1="${H + 10}" x2="${lx + 10}" y2="${H + 10}" stroke="${s.color}" stroke-width="2"/>`;
    legend += `<text x="${lx + 13}" y="${H + 13.5}" font-size="6.5" fill="#999">${s.label}</text>`;
  });

  return `<div class="chart-container">
    <svg width="${W}" height="${H + 26}" viewBox="0 0 ${W} ${H + 26}" style="display:block;margin:0 auto;max-width:100%">
      ${yLabels}
      ${paths}
      ${xLabels}
      ${legend}
    </svg>
  </div>`;
}

// 综合评分（保留向后兼容）
function calcScore(d, type) {
  const prob = calcProbability(d, type);
  const quality = calcQuality(d, type);
  return Math.max(0, Math.min(100, Math.round((prob + quality) / 2)));
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

// === 构建预测卡片（莉景风格：概率 + 质量双指标 + 云层趋势图）===
function buildPredictionCard(label, type, score, prob, quality, data, tips, timeISO, dateLabel, chartSvg) {
  const typeCls = type === 'morning' ? 'morning' : 'evening';
  const timeStr = new Date(timeISO).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  // 时间区间：日出/日落 ±30 分钟
  const t = new Date(timeISO);
  const startTime = new Date(t.getTime() - 30 * 60000);
  const endTime = new Date(t.getTime() + 30 * 60000);
  const fmt = (d) => d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const timeRange = `${fmt(startTime)} - ${fmt(endTime)}`;

  function scoreColor(s) {
    if (s >= 85) return '#e040fb';
    if (s >= 65) return '#4caf50';
    if (s >= 45) return '#ffeb3b';
    if (s >= 25) return '#ff9800';
    return '#ff4444';
  }

  const scoreColorMain = scoreColor(score);

  const verdictMap = [
    { min: 85, text: '🔥 必出大片', emoji: '🔥' },
    { min: 65, text: '✨ 强烈推荐出动', emoji: '✨' },
    { min: 45, text: '👀 值得期待', emoji: '👀' },
    { min: 25, text: '🤔 有一定可能', emoji: '🤔' },
    { min: 0,  text: '😴 不太理想', emoji: '😴' },
  ];
  const verdict = verdictMap.find(v => score >= v.min);

  // 概率与质量的文字评级
  const probDesc = prob >= 65 ? '✨ 较高' : prob >= 35 ? '中等' : '偏低';
  const qualDesc = quality >= 65 ? '🎨 绚丽' : quality >= 35 ? '尚可' : '平淡';

  const probColor = scoreColor(prob);
  const qualColor = scoreColor(quality);

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
  const emoji = type === 'morning' ? '🌅' : '🌆';

  return `
  <div class="prediction-card">
    <div class="card-header">
      <span class="card-label">${label}</span>
      <span class="card-type ${typeCls}">${dateLabel}</span>
    </div>
    <div class="card-body">
      <div class="score-row">
        <div class="dual-score">
          <div class="dual-item">
            <div class="dual-circle" style="border-color:${probColor}; color:${probColor}">${prob}</div>
            <span class="dual-label">概率</span>
            <span class="dual-desc" style="color:${probColor}">${probDesc}</span>
          </div>
          <div class="dual-vs">×</div>
          <div class="dual-item">
            <div class="dual-circle" style="border-color:${qualColor}; color:${qualColor}">${quality}</div>
            <span class="dual-label">质量</span>
            <span class="dual-desc" style="color:${qualColor}">${qualDesc}</span>
          </div>
        </div>
        <div class="score-text">
          <div class="score-verdict" style="color:${scoreColorMain}">${verdict ? verdict.emoji + ' ' + verdict.text : '—'}</div>
          <div class="score-desc">${emoji} ${eventLabel}时段 ${timeRange}</div>
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
      ${chartSvg ? `<div class="card-section-label">📈 云层趋势</div>${chartSvg}` : ''}
      <button class="nearby-btn" onclick="openNearbySearch('${type}')">📷 附近摄影点</button>
      <div class="data-source">🌐 欧洲中期天气预报中心 (ECMWF IFS)</div>
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
