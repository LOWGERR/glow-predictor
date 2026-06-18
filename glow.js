/* === 朝霞晚霞预测 · 摄影助手 - v2 === */

// ⚠️ 安全警告：API Key 硬编码在前端代码中，任何查看源码的人都能获取。
// 建议：监控用量、设置配额限制、定期轮换 Key。
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
let $blueMorning, $goldMorning, $goldEvening, $blueEvening;
let $srAzimuth, $ssAzimuth, $compassArrow;
let $mapPickBtn, $mapModal, $mapContainer, $mapCoords, $mapCancelBtn, $mapConfirmBtn;
let $mapLocateBtn, $mapSearchInput, $mapSearchBtn, $mapSearchResults;

// State
const state = {
  lat: null, lon: null, name: '', country: '',
  forecastData: null,
  activeTab: 0,   // 0=今天, 1=明天, 2=后天
  countdownTimer: null,
  // 多模型集成
  ensembleData: null,     // 合并后的数据
  modelSources: [],       // 成功请求的模型列表
};

// === 初始化 ===
function init() {
  bindDOM();
  // 自动读取并显示版本号（从 glow.js?v=N 中提取）
  try {
    const scriptEl = document.querySelector('script[src*="glow.js"]');
    if (scriptEl) {
      const match = scriptEl.src.match(/v=(\d+)/);
      if (match) {
        const badge = document.querySelector('.header-badge');
        if (badge) badge.textContent = '摄影助手 v' + match[1];
      }
    }
  } catch(e) {}

  $tabBar.addEventListener('click', handleTabClick);
  // $locateBtn.addEventListener('click', autoLocate);
  document.getElementById('locateBtn').addEventListener('click', autoLocate);
  $mapPickBtn.addEventListener('click', openMapPicker);

  const saved = localStorage.getItem('glow_predictor_location');
  if (saved) {
    try {
      const loc = JSON.parse(saved);
      // 检查缓存是否过期（24小时）
      const now = Date.now();
      const cacheAge = now - (loc.timestamp || 0);
      const CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时
      
      if (cacheAge < CACHE_TTL) {
        state.lat = loc.lat; state.lon = loc.lon;
        state.name = loc.name; state.country = loc.country;
        $locName.textContent = state.name;
        fetchForecast();
        tryGeoUpdate();
        return;
      } else {
        console.log('位置缓存已过期，重新定位');
        localStorage.removeItem('glow_predictor_location');
      }
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
  $blueMorning = document.getElementById('blueMorning');
  $goldMorning = document.getElementById('goldMorning');
  $goldEvening = document.getElementById('goldEvening');
  $blueEvening = document.getElementById('blueEvening');
  $srAzimuth = document.getElementById('srAzimuth');
  $ssAzimuth = document.getElementById('ssAzimuth');
  $compassArrow = document.getElementById('compassArrow');
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
  // keydown 事件由 initMapSearch() 统一处理，此处不重复绑定

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
  localStorage.setItem('glow_predictor_location', JSON.stringify({ 
    lat, lon, name: state.name, country, timestamp: Date.now() 
  }));
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
// ⚠️ 注意：此为近似算法，与高德官方转换可能有几十米偏差。
// 在高密度城区（如上海外滩）可能影响附近 POI 搜索精度，但 10km 范围内通常不明显。
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
  // 初始化地图搜索插件（AutoComplete + PlaceSearch）
  initMapSearch();
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

    // 点选模式：点击地图任意位置放置标记
    _mapInstance.on('click', (e) => {
      _mapLat = e.lnglat.getLat();
      _mapLon = e.lnglat.getLng();
      placeMarker(_mapLat, _mapLon);
      updateMapCoordsLabel();
    });

    // 先用 state 位置初始化标记，避免 GPS 超时时地图空白
    _mapLat = initLat; _mapLon = initLon;
    placeMarker(_mapLat, _mapLon);
    updateMapCoordsLabel();

    // GPS → GCJ-02 转换后定位（带超时强制回退）
    let gpsResolved = false;
    if (navigator.geolocation) {
      const gpsTimeout = setTimeout(() => {
        if (!gpsResolved && state.lat) {
          _mapLat = state.lat; _mapLon = state.lon;
          _mapInstance.setCenter([_mapLon, _mapLat]);
          _mapInstance.setZoom(14);
          placeMarker(_mapLat, _mapLon);
          updateMapCoordsLabel();
        }
      }, 4000);

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          clearTimeout(gpsTimeout);
          gpsResolved = true;
          const wgs84 = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          const gcj02 = await convertWGS84toGCJ02(wgs84.lat, wgs84.lon);
          _mapLat = gcj02.lat; _mapLon = gcj02.lon;
          _mapInstance.setCenter([_mapLon, _mapLat]);
          _mapInstance.setZoom(15);
          placeMarker(_mapLat, _mapLon);
          updateMapCoordsLabel();
        },
        () => {
          clearTimeout(gpsTimeout);
          gpsResolved = true;
          // GPS 失败 → 保持已初始化的 state 位置
        },
        { timeout: 5000, maximumAge: 60000, enableHighAccuracy: true }
      );
    }
  } else {
    // 复用已有实例
    _mapInstance.setCenter([initLon, initLat]);
    _mapInstance.setZoom(initZoom);
    if (_mapMarker) { _mapInstance.remove(_mapMarker); _mapMarker = null; }

    // 先用 state 位置初始化标记
    _mapLat = initLat; _mapLon = initLon;
    placeMarker(_mapLat, _mapLon);
    updateMapCoordsLabel();

    // 尝试 GPS 定位（带超时强制回退）
    let gpsResolved = false;
    if (navigator.geolocation) {
      const gpsTimeout = setTimeout(() => {
        if (!gpsResolved && state.lat) {
          _mapLat = state.lat; _mapLon = state.lon;
          _mapInstance.setCenter([_mapLon, _mapLat]);
          _mapInstance.setZoom(14);
          placeMarker(_mapLat, _mapLon);
          updateMapCoordsLabel();
        }
      }, 4000);

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          clearTimeout(gpsTimeout);
          gpsResolved = true;
          const wgs84 = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          const gcj02 = await convertWGS84toGCJ02(wgs84.lat, wgs84.lon);
          _mapLat = gcj02.lat; _mapLon = gcj02.lon;
          _mapInstance.setCenter([_mapLon, _mapLat]);
          _mapInstance.setZoom(15);
          placeMarker(_mapLat, _mapLon);
          updateMapCoordsLabel();
        },
        () => {
          clearTimeout(gpsTimeout);
          gpsResolved = true;
          // GPS 失败 → 保持已初始化的 state 位置
        },
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
    draggable: false,  // 禁用拖拽，仅支持点击地图选点
    zIndex: 999,
    icon: new AMap.Icon({
      size: new AMap.Size(25, 34),
      imageSize: new AMap.Size(25, 34),
      image: MARKER_SVG,
      imageOffset: new AMap.Pixel(0, 0)
    })
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
      <div class="nearby-item" onclick="selectNearbyPOI(${p.lat}, ${p.long}, '${safeName}')">
        <span class="nearby-rank">${i+1}</span>
        <div class="nearby-info">
          <div class="nearby-name">${p.name} ${p.dirScore}</div>
          <div class="nearby-detail">${p.dist}m · ${p.type || (category || '景点')}</div>
        </div>
        <button class="nearby-nav-btn" onclick="event.stopPropagation();navigateToPOI(${p.lat}, ${p.long}, '${safeName}')" title="导航前往">🗺️</button>
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
        const [long, lat] = p.location.split(',').map(Number);
        const dist = Math.round(distance(state.lat, state.lon, lat, long));
        const dir = bearing(state.lat, state.lon, lat, long);
        const sunDir = _nearbyType === 'morning' ? 90 : 270;
        const dirScore = Math.abs(dir - sunDir) <= 45 ? '⭐' : '';
        return { ...p, lat, long, dist, dir, dirScore };
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

function selectNearbyPOI(lat, long, name) {
  selectLocation(lat, long, name, '');
  closeNearbyModal();
  // 在地图选择器上标记该点
  showNearbyPOIOnMap(lat, long, name);
}

// 附近摄影点 → 地图标记展示
function showNearbyPOIOnMap(lat, long, name) {
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
        center: [long, lat],
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
      _mapInstance.setCenter([long, lat]);
      _mapInstance.setZoom(16);
      if (_mapMarker) { _mapInstance.remove(_mapMarker); _mapMarker = null; }
    }

    _mapLat = lat; _mapLon = long;
    placeMarker(lat, long);
    // 加信息窗口
    const info = new AMap.InfoWindow({
      content: `<div style="font-size:14px;color:#333;padding:4px 8px">📸 ${name}<br><span onclick="navigateToPOI(${lat},${long},'${name.replace(/'/g, "\\'")}')" style="font-size:12px;color:#1677ff;text-decoration:none;cursor:pointer">🗺️ 导航前往</span></div>`,
      offset: new AMap.Pixel(0, -30)
    });
    info.open(_mapInstance, [long, lat]);
    updateMapCoordsLabel();
  }, 300);
}

// 一键导航到指定 POI（打开高德地图 app / 网页）
function navigateToPOI(lat, long, name) {
  // 先转换 WGS-84 → GCJ-02（高德坐标）
  const gcj = wgs84ToGcj02(lat, long);
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

// === 地图内搜索（REST API + 自定义下拉面板）===
let _searchTimer = null;

function initMapSearch() {
  // 输入时防抖搜索
  $mapSearchInput.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    const keyword = $mapSearchInput.value.trim();
    if (keyword.length < 2) {
      $mapSearchResults.classList.remove('show');
      return;
    }
    _searchTimer = setTimeout(() => doAutoSearch(keyword), 300);
  });

  // 回车键触发精确 POI 搜索
  $mapSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doPlaceSearch($mapSearchInput.value.trim());
    }
  });
}

// 输入提示搜索（使用高德 REST API tips 接口）
async function doAutoSearch(keyword) {
  try {
    const res = await fetch(
      `https://restapi.amap.com/v3/assistant/inputtips?key=${AMAP_KEY}&keywords=${encodeURIComponent(keyword)}&datatype=all`
    );
    const data = await res.json();
    if (data.status !== '1' || !data.tips || data.tips.length === 0) {
      $mapSearchResults.classList.remove('show');
      return;
    }
    renderSearchResults(data.tips, true);
  } catch(e) {
    console.warn('输入提示搜索失败', e);
  }
}

// 精确 POI 搜索
async function doPlaceSearch(keyword) {
  if (!keyword) return;
  $mapSearchResults.innerHTML = '<div class="result-item" style="color:var(--text-dim)">搜索中…</div>';
  $mapSearchResults.classList.add('show');

  try {
    const res = await fetch(
      `${AMAP_SEARCH_URL}?key=${AMAP_KEY}&keywords=${encodeURIComponent(keyword)}&offset=10&extensions=all`
    );
    const data = await res.json();
    if (data.status !== '1' || !data.pois || data.pois.length === 0) {
      $mapSearchResults.innerHTML = '<div class="result-item" style="color:var(--bad)">未找到地点，请尝试其他关键词</div>';
      return;
    }
    renderSearchResults(data.pois, false);
  } catch(e) {
    $mapSearchResults.innerHTML = '<div class="result-item" style="color:var(--bad)">搜索失败，请重试</div>';
  }
}

// 渲染搜索结果（统一处理 inputtips 和 pois）
function renderSearchResults(items, isTips) {
  $mapSearchResults.innerHTML = items.map((p, i) => {
    const name = p.name || p.district || '';
    const district = p.district || p.address || '';
    const location = p.location || '';
    let lat = 0, lon = 0;
    if (location) {
      const parts = location.split(',').map(Number);
      lon = parts[0]; lat = parts[1];
    }
    return `<div class="result-item" data-idx="${i}">
      <div class="result-name">${name}</div>
      <div class="result-detail">${district}${lat ? ' · ' + lat.toFixed(4) + ', ' + lon.toFixed(4) : ''}</div>
    </div>`;
  }).join('');

  $mapSearchResults.classList.add('show');

  $mapSearchResults.querySelectorAll('.result-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = +el.dataset.idx;
      const p = items[idx];
      if (!p || !p.location) return;
      const [lon, lat] = p.location.split(',').map(Number);
      _mapLat = lat; _mapLon = lon;
      if (_mapInstance) {
        _mapInstance.setCenter([lon, lat]);
        _mapInstance.setZoom(16);
        placeMarker(lat, lon);
        updateMapCoordsLabel();
      }
      $mapSearchResults.classList.remove('show');
      $mapSearchInput.value = '';
    });
  });
}

// 兼容旧版 mapSearch 调用
async function mapSearch() {
  await doPlaceSearch($mapSearchInput.value.trim());
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

  // 多模型集成：同时请求 ECMWF IFS 和 GFS（美国全球预报系统）
  // 云量预报是气象中最不稳定的变量，取多模型均值可显著降低单一模型偏差
  const models = ['ecmwf_ifs', 'gfs_seamless'];
  state.modelSources = [];

  const baseParams = {
    latitude: state.lat,
    longitude: state.lon,
    hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,dew_point_2m,precipitation_probability,visibility,temperature_2m,weather_code',
    daily: 'sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: 3,
  };

  const results = await Promise.allSettled(models.map(model => {
    const params = new URLSearchParams({ ...baseParams, models: model });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    return fetch(`${FORECAST_URL}?${params}`, { signal: controller.signal })
      .then(r => { clearTimeout(timeout); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { d._model = model; return d; })
      .catch(e => { clearTimeout(timeout); throw e; });
  }));

  // 筛选成功返回的数据
  const successData = results.filter(r => r.status === 'fulfilled').map(r => r.value);

  if (successData.length === 0) {
    console.warn('所有模型均失败，使用演示数据');
    renderDemo();
    $loading.style.display = 'none';
    return;
  }

  // 记录成功模型
  state.modelSources = successData.map(d => d._model || 'unknown');

  // 如果只有一个模型成功，直接使用
  if (successData.length === 1) {
    const data = successData[0];
    data._source = data.meta && data.meta.models ? data.meta.models : data._model;
    state.forecastData = data;
    state.ensembleData = null;
    renderAll(data);
    $loading.style.display = 'none';
    return;
  }

  // 多模型集成：取逐时云量数据的均值（其他字段用第一个模型的主数据）
  // 注意：不同模型的逐时时间戳可能不完全对齐，Open-Meteo 统一返回 UTC 对齐的整点数据
  const primary = successData[0];
  const modelLabel = successData.map(d => d._model || d._source || '未知').join('+');

  // 构建集成数据：云量字段取各模型均值
  const cloudFields = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'];
  const hourlyLen = primary.hourly.time.length;

  for (let i = 0; i < hourlyLen; i++) {
    cloudFields.forEach(field => {
      let sum = 0, count = 0;
      successData.forEach(d => {
        if (d.hourly[field] && d.hourly[field][i] != null) {
          sum += d.hourly[field][i];
          count++;
        }
      });
      if (count > 0) {
        primary.hourly[field][i] = Math.round(sum / count);
      }
    });
  }

  // 降水概率也取均值（不同模型降水预报差异也很大）
  for (let i = 0; i < hourlyLen; i++) {
    let sum = 0, count = 0;
    successData.forEach(d => {
      if (d.hourly.precipitation_probability && d.hourly.precipitation_probability[i] != null) {
        sum += d.hourly.precipitation_probability[i];
        count++;
      }
    });
    if (count > 0) {
      primary.hourly.precipitation_probability[i] = Math.round(sum / count);
    }
  }

  // daily 降水概率也取均值
  if (primary.daily && primary.daily.precipitation_probability_max) {
    for (let i = 0; i < primary.daily.time.length; i++) {
      let sum = 0, count = 0;
      successData.forEach(d => {
        if (d.daily && d.daily.precipitation_probability_max && d.daily.precipitation_probability_max[i] != null) {
          sum += d.daily.precipitation_probability_max[i];
          count++;
        }
      });
      if (count > 0) {
        primary.daily.precipitation_probability_max[i] = Math.round(sum / count);
      }
    }
  }

  primary._source = modelLabel;
  state.forecastData = primary;
  state.ensembleData = successData; // 保留各模型原始数据供调试
  renderAll(primary);
  $loading.style.display = 'none';
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

  // 趋势分析
  const morningTrend = getTrendData(data, di, 'morning');
  const eveningTrend = getTrendData(data, di, 'evening');

  const morningProb = calcProbability(morningData, 'morning', morningTrend);
  const morningQuality = calcQuality(morningData, 'morning');
  const morningScore = calcScore(morningData, 'morning', morningTrend);
  const eveningProb = calcProbability(eveningData, 'evening', eveningTrend);
  const eveningQuality = calcQuality(eveningData, 'evening');
  const eveningScore = calcScore(eveningData, 'evening', eveningTrend);

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
    dewPoint: data.hourly.dew_point_2m ? data.hourly.dew_point_2m[idx] : null,
    precipProb: data.hourly.precipitation_probability[idx],
    visibility: data.hourly.visibility[idx],
    temp: data.hourly.temperature_2m[idx],
  };
}

// === AOD 通透度代理（基于能见度+湿度+低云的联合推断） ===
// 返回 0-1 的等效气溶胶光学厚度指数：0=极致通透，1=严重雾霾/沙尘
function _calcAODProxy(visibility, humidity, cloudLow) {
  // 能见度是 AOD 的最直接代理（单位：米）
  let aod = 0;
  if (visibility < 1000)       aod = 0.85;   // 浓雾/重度霾
  else if (visibility < 2000)  aod = 0.65;   // 重度霾
  else if (visibility < 3500)  aod = 0.45;   // 中度霾
  else if (visibility < 5000)  aod = 0.30;   // 轻度霾
  else if (visibility < 8000)  aod = 0.18;   // 轻微浑浊
  else if (visibility < 12000) aod = 0.10;   // 较通透
  else if (visibility < 18000) aod = 0.05;   // 通透
  else                         aod = 0.02;   // 极致通透

  // 湿度修正：高湿会放大气溶胶的散射效应（湿增长）
  if (humidity > 85)      aod = Math.min(1, aod * 1.3);
  else if (humidity > 70) aod = Math.min(1, aod * 1.15);
  else if (humidity < 25) aod = Math.max(0, aod * 0.85); // 干燥时气溶胶影响减弱

  // 低云修正：低云本身不是气溶胶，但低云多时大气边界层内颗粒物浓度通常更高
  if (cloudLow > 60)      aod = Math.min(1, aod + 0.08);
  else if (cloudLow > 30) aod = Math.min(1, aod + 0.03);

  return Math.max(0, Math.min(1, aod));
}

// === 太阳方位角计算（纯数学，无需API） ===
// lat: 纬度(°), dateStr: 'YYYY-MM-DD', type: 'sunrise'|'sunset'
// 返回：方位角（度，正北=0°，顺时针）
function _calcSolarAzimuth(lat, dateStr, type) {
  const date = new Date(dateStr + (type === 'sunrise' ? 'T06:00:00' : 'T18:00:00'));
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const declination = 23.44 * Math.sin((284 + dayOfYear) / 365 * 2 * Math.PI);
  const radLat = lat * Math.PI / 180;
  const radDec = declination * Math.PI / 180;

  // 日出/日落时时角
  const cosH = -Math.tan(radLat) * Math.tan(radDec);
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) * 180 / Math.PI;

  // 方位角公式（clamp sinAz 到 [-1,1] 防止浮点误差导致 NaN）
  const sinAz = Math.cos(radDec) * Math.sin(H * Math.PI / 180) / Math.cos(radLat);
  let azimuth = Math.asin(Math.max(-1, Math.min(1, sinAz))) * 180 / Math.PI;
  if (type === 'sunrise') azimuth = 180 - azimuth;
  else azimuth += 180;

  return Math.round(((azimuth % 360) + 360) % 360);
}

// === 云底高度估算（基于温度-露点差） ===
// 简化公式：云底高度(m) ≈ (温度°C - 露点°C) × 125
// 返回米为单位，null 表示无法计算
function _calcCloudBaseHeight(temp, dewPoint) {
  if (temp == null || dewPoint == null) return null;
  const spread = temp - dewPoint;
  if (spread < 0) return 0; // 饱和状态，云底≈地面
  return Math.round(spread * 125);
}

// === 中高层云连续性评分 ===
// 原理：中层云和高层云同时存在且量级接近 → 云层连续、反射面大 → 加分
//       只有一层有云或两层差异悬殊 → 云层破碎 → 不加分甚至减分
// 返回 -8 ~ +12 的修正值
function _calcCloudContinuity(cloudMid, cloudHigh) {
  // 两层都很少 → 无连续性可言
  if (cloudMid < 5 && cloudHigh < 5) return 0;

  // 只有一层有云 → 单层云，连续性差
  if (cloudMid < 5 || cloudHigh < 5) return -4;

  // 两层都有云 → 计算比值判断连续性
  const ratio = Math.min(cloudMid, cloudHigh) / Math.max(cloudMid, cloudHigh);
  if (ratio >= 0.7) return 12;   // 两层云量接近 → 高度连续
  else if (ratio >= 0.4) return 6;  // 中等连续
  else return -2;               // 差异悬殊 → 破碎
}

// === 太阳高度角季节性修正 ===
// 原理：日出/日落时太阳高度角决定光线穿过大气的路径长度
//       冬季太阳高度角低 → 路径长 → 散射更强 → 霞光更易出现（+权重）
//       夏季太阳高度角高 → 路径短 → 散射较弱 → 霞光概率略降（-权重）
// 参数：lat=纬度(°), month=月份(1-12), type='morning'|'evening'
// 返回：-5 ~ +5 的修正值
function _calcSolarElevationCorrection(lat, month, type) {
  // 简化模型：用月份近似太阳赤纬
  // 夏至(6月) δ≈+23.4°, 冬至(12月) δ≈-23.4°
  const dayOfYear = (month - 1) * 30 + 15; // 每月取月中
  const declination = 23.44 * Math.sin((284 + dayOfYear) / 365 * 2 * Math.PI);

  // 日出/日落时太阳高度角 ≈ 0°（地平线），但实际有效高度角受大气折射影响
  // 这里用"等效路径长度因子"代替精确计算：
  // 路径长度  1/sin(elevation)，elevation 越低路径越长
  // 冬季 |declination| 大 → 同纬度下日出方位角更偏南/北 → 有效路径更长

  const absLat = Math.abs(lat);
  // 北半球冬季(12-2月)和南半球夏季(6-8月)是霞光高发期
  let seasonalFactor = 0;
  if (lat >= 0) {
    // 北半球：冬季加分，夏季减分
    if (month >= 11 || month <= 2) seasonalFactor = 4;   // 冬
    else if (month >= 3 && month <= 5) seasonalFactor = 1; // 春
    else if (month >= 9 && month <= 10) seasonalFactor = 2; // 秋
    else seasonalFactor = -3;                             // 夏
  } else {
    // 南半球：季节相反
    if (month >= 5 && month <= 8) seasonalFactor = 4;     // 冬
    else if (month >= 9 && month <= 11) seasonalFactor = 1; // 春
    else if (month >= 3 && month <= 4) seasonalFactor = 2;  // 秋
    else seasonalFactor = -3;                              // 夏
  }

  // 高纬度地区季节效应更显著
  if (absLat > 40) seasonalFactor *= 1.3;
  else if (absLat < 20) seasonalFactor *= 0.6; // 低纬度季节差异小

  // 晚霞比朝霞对太阳高度角更敏感（傍晚大气更稳定）
  if (type === 'evening') seasonalFactor *= 1.1;

  return Math.round(Math.max(-5, Math.min(5, seasonalFactor)));
}

// ════════════════════════════════════════════════════════════
// 🔬 多因子融合评分引擎 v4
// 基于 r-ayin/sunset-prediction 研究驱动型日落质量引擎 v2.0
// 融合改进点：
//   - 云型分类（高云主导/低云主导/混合/晴空/阴天）
//   - 能见度作为独立 25% 权重因子（原仅通过 AOD proxy 间接）
//   - 多层云纹理加分（丰富度更细腻）
//   - 总云量 15-60% 最优区间重新校准
// ════════════════════════════════════════════════════════════

// === 云型分类评分（权重 ~35%） ===
// 高云 > 低云 > 混合 > 晴空 > 阴天
// 返回 { type, score, label } 分值 0-40 分
function _calcCloudTypeScore(cloudLow, cloudMid, cloudHigh, totalCloud) {
  const highIsDominant = cloudHigh >= 30 && cloudLow < 40;
  const lowIsDominant = cloudLow >= 20 && cloudLow <= 55 && cloudHigh < 40;
  const multiLayer = cloudHigh > 15 && cloudLow > 10;
  const overcast = totalCloud > 80;
  const clearSky = totalCloud < 10;

  let type, score, label;

  if (highIsDominant && !overcast) {
    // 🔥 高云晚霞——最佳！卷云/卷积云散射红光最强
    type = 'high_cloud_dominant';
    score = 40;
    label = '高云主导';
  } else if (lowIsDominant && !overcast) {
    // 低云主导——也不错，但需要 20-55%
    type = 'low_cloud_dominant';
    score = 28;
    label = '低云主导';
  } else if (totalCloud >= 10 && totalCloud <= 75) {
    // 混合云——适中
    type = 'mixed';
    score = 22;
    label = '混合云';
  } else if (clearSky) {
    // 晴空——无云散射，色彩平淡
    type = 'clear';
    score = 5;
    label = '晴空';
  } else if (overcast) {
    // 阴天——光线被完全遮挡
    type = 'overcast';
    score = -10;
    label = '阴天';
  } else {
    type = 'unknown';
    score = 10;
    label = '不确定';
  }

  // 多层云纹理加分（丰富度）
  if (multiLayer && type !== 'overcast' && type !== 'clear') {
    score += 8;
    label += '+多层';
  } else if (type === 'high_cloud_dominant' && cloudHigh > 40) {
    // 高云单层也有丰富纹理
    score += 4;
    label += '+纹理';
  }

  // 总云量最优区间额外加成
  if (totalCloud >= 15 && totalCloud <= 60 && type !== 'clear') {
    score += 5;
  }

  return { type, score: Math.round(score), label };
}

// === 能见度独立评分（权重 ~25%） ===
// 能见度 >20km = 通透，12-20km = 良好，<8km = 雾霾
function _calcVisibilityScore(visibility) {
  const visKm = visibility / 1000;
  if (visKm >= 20) return { score: 25, label: '极致通透', visKm };
  if (visKm >= 12) return { score: 18, label: '通透', visKm };
  if (visKm >= 8)  return { score: 12, label: '良好', visKm };
  if (visKm >= 5)  return { score: 5, label: '轻微浑浊', visKm };
  if (visKm >= 3)  return { score: -2, label: '浑浊', visKm };
  return { score: -10, label: '严重雾霾', visKm };
}

// === 湿度评分（权重 ~15%） ===
// 40-60% 最佳；>80% 雾蒙蒙；<30% 太干
function _calcHumidityScore(humidity) {
  if (humidity >= 40 && humidity <= 60) return 15;
  if (humidity >= 30 && humidity < 40) return 8;
  if (humidity > 60 && humidity <= 75) return 4;
  if (humidity > 75 && humidity <= 85) return -4;
  if (humidity > 85) return -12;
  return -8; // <30%
}

// === 评分算法 v4（r-ayin 融合版）===
// 概率：霞光出现的可能性（%），主要看遮挡因素
// 质量：霞光色彩壮观度（%），主要看散射条件
function calcProbability(d, type, trendData) {
  let prob = 50;

  const cloudMid = d.cloudMid, cloudHigh = d.cloudHigh, cloudLow = d.cloudLow;
  const cloudMH = Math.max(cloudMid, cloudHigh);
  const h = d.humidity;
  const v = d.visibility;

  // === 0. 云型分类评分（对概率的基础判定，权重缩小） ===
  const cloudType = _calcCloudTypeScore(cloudLow, cloudMid, cloudHigh, d.cloudCover);
  prob += cloudType.score * 0.3;

  // === 0b. 能见度（独立天气因素） ===
  const visScore = _calcVisibilityScore(v);
  prob += visScore.score * 0.2;

  // === 0c. 湿度 ===
  const humScore = _calcHumidityScore(h);
  prob += humScore * 0.15;

  // === 0d. 云层垂直连续性（统一权重） ===
  const continuityScore = _calcCloudContinuity(cloudMid, cloudHigh);
  prob += continuityScore * 0.3;

  const cloudBaseH = _calcCloudBaseHeight(d.temp, d.dewPoint);
  if (cloudBaseH !== null) {
    if (cloudBaseH < 200 && cloudLow > 20) prob -= 4;
    else if (cloudBaseH < 500 && cloudLow > 35) prob -= 2;
  }

  // === 1. 中高层云评分（取消重叠加分，仅设惩罚梯度） ===
  if (cloudMH < 3)  prob -= 30;
  else if (cloudMH < 8) prob -= 20;
  else if (cloudMH < 14) prob -= 10;
  else if (cloudMH >= 16 && cloudMH <= 62) prob += 3;  // 理想范围微奖励
  else if (cloudMH <= 75) prob -= 2;
  else if (cloudMH <= 85) prob -= 12;
  else if (cloudMH <= 93) prob -= 22;
  else prob -= 30;

  // === 2. 中高云叠加奖励（取消 — 云型分类和中高层段已覆盖） ===

  // === 3. 低云评分 + 遮挡中高层云的穿透惩罚 ===
  if (cloudLow > 75) {
    prob -= 25;
    if (cloudMH > 15) prob -= 8;
  } else if (cloudLow > 55) {
    prob -= 15;
    if (cloudMH > 20) prob -= 4;
  } else if (cloudLow > 35) {
    prob -= 7;
  } else if (cloudLow > 18) {
    prob -= 3;
  } else {
    prob += 2;
  }

  // === 4. 降水概率 ===
  if (d.precipProb > 75) prob -= 28;
  else if (d.precipProb > 55) prob -= 18;
  else if (d.precipProb > 30) prob -= 8;
  else if (d.precipProb > 12) prob -= 3;
  else prob += 2;

  // === 5. 总云量极端情况 ===
  if (d.cloudCover > 95) prob -= 18;
  if (d.cloudCover < 5 && cloudMH < 5) prob -= 10;

  // === 6. 趋势评分 ===
  if (trendData && trendData.cloudTrend != null) {
    if (type === 'morning') {
      if (trendData.preEventTrend < -3 && trendData.preEventTrend > -15) prob += 8;
      else if (trendData.preEventTrend < -1 && trendData.preEventTrend >= -3) prob += 4;
      else if (trendData.preEventTrend > 15) prob -= 5;
      if (trendData.lowCloudTrend < -5 && cloudLow < 40) prob += 4;
    } else {
      if (Math.abs(trendData.preEventTrend) < 5) prob += 5;
      else if (trendData.preEventTrend > 0 && trendData.preEventTrend <= 8) prob += 3;
      if (trendData.highTrend > 2 && trendData.highTrend < 12) prob += 4;
      else if (Math.abs(trendData.preEventTrend) > 20) prob -= 5;
    }
  }

  // === 7. 太阳高度角季节性修正 ===
  if (state.lat != null) {
    const month = new Date().getMonth() + 1;
    const solarCorrection = _calcSolarElevationCorrection(state.lat, month, type);
    prob += solarCorrection;
  }

  return Math.max(0, Math.min(100, Math.round(prob)));
}

function calcQuality(d, type) {
  let quality = 50;

  const cloudMid = d.cloudMid, cloudHigh = d.cloudHigh, cloudLow = d.cloudLow;
  const cloudMH = Math.max(cloudMid, cloudHigh);
  const h = d.humidity;
  const v = d.visibility;

  // === 0. 云型分类评分（质量维度核心） ===
  const cloudType = _calcCloudTypeScore(cloudLow, cloudMid, cloudHigh, d.cloudCover);
  quality += cloudType.score * 0.5;

  // === 0b. 能见度（质量维度，通透度直接影响色彩饱和） ===
  const visScore = _calcVisibilityScore(v);
  quality += visScore.score * 0.35;

  // === 0c. 湿度（适中湿度助散射，过高/过低都差） ===
  const humScore = _calcHumidityScore(h);
  quality += humScore * 0.25;

  // === 0d. 云层垂直连续性（统一权重） ===
  const continuityScore = _calcCloudContinuity(cloudMid, cloudHigh);
  quality += continuityScore * 0.4;

  const cloudBaseH = _calcCloudBaseHeight(d.temp, d.dewPoint);
  if (cloudBaseH !== null) {
    if (cloudBaseH < 200 && cloudLow > 20) quality -= 5;
    else if (cloudBaseH < 500 && cloudLow > 35) quality -= 3;
    else if (cloudBaseH > 2000 && cloudMH >= 15) quality += 2;
  }

  // === 1. 中高层云：色彩载体（取消重复奖励区间） ===
  if (cloudMH < 3)  quality -= 35;
  else if (cloudMH < 8) quality -= 24;
  else if (cloudMH < 15) quality -= 12;
  else if (cloudMH >= 18 && cloudMH <= 58) quality += 5;
  else if (cloudMH <= 70) quality -= 1;
  else if (cloudMH <= 82) quality -= 8;
  else if (cloudMH <= 92) quality -= 20;
  else quality -= 32;

  // === 2. 中高云叠加奖励（取消 — 云型分类+连续性已覆盖） ===

  // === 3. 低云遮挡关系 ===
  if (cloudLow > 70) {
    quality -= 20;
    if (cloudMH > 20) quality -= 7;
  } else if (cloudLow > 50) {
    quality -= 12;
  } else if (cloudLow > 30) {
    quality -= 5;
  } else if (cloudLow > 12) {
    quality -= 2;
  }
  if (cloudLow < 8) quality += 3;

  // === 4. 联合惩罚（保留极端组合修正） ===
  if (h > 70 && v < 4000) quality -= 10;
  if (h > 82 && v < 6000) quality -= 7;
  if (h < 50 && v < 3000) quality -= 5;
  if (h >= 25 && h <= 55 && v > 10000 && cloudMH >= 15 && cloudMH <= 55) {
    quality += 4;
  }

  // === 5. 太阳高度角季节性修正（权重降低） ===
  if (state.lat != null) {
    const month = new Date().getMonth() + 1;
    const solarCorrection = _calcSolarElevationCorrection(state.lat, month, type);
    quality += solarCorrection * 0.5;
  }

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

// === 趋势分析：提取日出/日落前后云量变化趋势 ===
// 返回 { cloudTrend, lowCloudTrend } — 正值表示云量在增多
// === 云层趋势分析（扩展窗口 + 滑动平均） ===
// data: 完整 forecast data, di: day index, type: 'morning'|'evening'
// 返回趋势对象供 calcProbability 使用
function getTrendData(data, di, type) {
  const daily = data.daily;
  const hourly = data.hourly;
  const dateStr = daily.time[di];
  if (!dateStr) return null;

  const eventISO = type === 'morning' ? daily.sunrise[di] : daily.sunset[di];
  if (!eventISO) return null;
  const eventTime = new Date(eventISO);
  const eventHour = eventTime.getHours() + eventTime.getMinutes() / 60;

  // 找到该日期的所有逐时索引
  const indices = hourly.time
    .map((t, i) => ({ i, t }))
    .filter(x => x.t.startsWith(dateStr))
    .sort((a, b) => a.t.localeCompare(b.t));

  if (indices.length < 3) return null;

  // 扩展时间窗口：
  // 朝霞：日出前 3h → 日出后 1h（检测云量是否在日出前持续下降→清晨通透）
  // 晚霞：日落前 2h → 日落后 2h（检测高层云是否缓慢增厚→晚霞延续）
  let windowStart, windowEnd;
  if (type === 'morning') {
    windowStart = eventHour - 3;
    windowEnd = eventHour + 1;
  } else {
    windowStart = eventHour - 2;
    windowEnd = eventHour + 2;
  }

  // 提取窗口内的数据点
  const windowPoints = indices.filter(x => {
    const h = new Date(x.t).getHours() + new Date(x.t).getMinutes() / 60;
    return h >= windowStart && h <= windowEnd;
  }).map(x => ({
    time: new Date(x.t),
    cloudCover: hourly.cloud_cover[x.i],
    cloudLow: hourly.cloud_cover_low[x.i],
    cloudMid: hourly.cloud_cover_mid[x.i],
    cloudHigh: hourly.cloud_cover_high[x.i],
  }));

  if (windowPoints.length < 3) return null;

  // 滑动平均平滑（窗口大小=3）
  function smooth(arr, winSize = 3) {
    if (arr.length < winSize) return arr;
    const result = [];
    for (let i = 0; i < arr.length; i++) {
      const start = Math.max(0, i - Math.floor(winSize / 2));
      const end = Math.min(arr.length, i + Math.ceil(winSize / 2));
      let sum = 0;
      for (let j = start; j < end; j++) sum += arr[j];
      result.push(sum / (end - start));
    }
    return result;
  }

  const rawCloud = windowPoints.map(p => p.cloudCover);
  const rawLow = windowPoints.map(p => p.cloudLow);
  const rawMid = windowPoints.map(p => p.cloudMid);
  const rawHigh = windowPoints.map(p => p.cloudHigh);

  const smCloud = smooth(rawCloud);
  const smLow = smooth(rawLow);
  const smMid = smooth(rawMid);
  const smHigh = smooth(rawHigh);

  // 计算趋势：用线性回归斜率代替首尾差分（更抗噪）
  function linearSlope(values) {
    const n = values.length;
    if (n < 2) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }
    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  const cloudTrend = linearSlope(smCloud);
  const lowCloudTrend = linearSlope(smLow);
  const midTrend = linearSlope(smMid);
  const highTrend = linearSlope(smHigh);

  // 额外指标：事件前后分段趋势（用于精细化评分）
  const eventIdx = windowPoints.findIndex(p => p.time >= eventTime);
  let preEventTrend = 0, postEventTrend = 0;
  if (eventIdx > 2) {
    preEventTrend = linearSlope(smCloud.slice(0, eventIdx));
  }
  if (eventIdx >= 0 && eventIdx < smCloud.length - 2) {
    postEventTrend = linearSlope(smCloud.slice(eventIdx));
  }

  return {
    cloudTrend,           // 整体云量趋势（°/h）
    lowCloudTrend,        // 低云趋势
    midTrend,             // 中层云趋势
    highTrend,            // 高层云趋势
    preEventTrend,        // 事件前趋势（朝霞=日出前，晚霞=日落前）
    postEventTrend,       // 事件后趋势
    windowSize: windowPoints.length,
  };
}

// 综合评分（保留向后兼容）
function calcScore(d, type, trendData) {
  const prob = calcProbability(d, type, trendData);
  const quality = calcQuality(d, type);

  // === 评分机制 v31（0-100 分制）===
  // 基础分：概率与质量的加权几何平均
  //   几何平均惩罚"高概率 + 低质量"的不一致情况（厚云有概率但不出彩）
  //   权重：概率 45% + 质量 55%（质量对最终出片影响更大）
  const baseScore = Math.pow(prob, 0.45) * Math.pow(quality, 0.55);

  // 趋势修正：云层变化方向对霞光持续性有影响
  let trendBonus = 0;
  if (trendData && trendData.cloudTrend != null) {
    if (type === 'morning') {
      if (trendData.preEventTrend < -2 && trendData.preEventTrend > -12) trendBonus += 5;
      if (trendData.lowCloudTrend < -4 && d.cloudLow < 35) trendBonus += 3;
    } else {
      if (Math.abs(trendData.preEventTrend) < 4) trendBonus += 4;
      else if (trendData.preEventTrend > 0 && trendData.preEventTrend <= 6) trendBonus += 3;
      if (trendData.highTrend > 1 && trendData.highTrend < 10) trendBonus += 3;
    }
  }

  // AOD 通透度额外加成（极致通透 + 有云 = 最佳条件）
  const aodProxy = _calcAODProxy(d.visibility, d.humidity, d.cloudLow);
  if (aodProxy < 0.08 && Math.max(d.cloudMid, d.cloudHigh) >= 12) {
    trendBonus += 2;
  }

  // 综合得分 = 基础分 × 75% + 趋势修正 × 25%（上限 100）
  let score = Math.round(baseScore * 0.75 + Math.min(trendBonus, 15) * (100 / 15) * 0.25);
  return Math.max(0, Math.min(100, score));
}

// === 一键分享预测卡片 ===
async function sharePrediction(score, type, timeRange, verdictText) {
  const typeLabel = type === 'morning' ? '朝霞' : '晚霞';
  const locName = state.name || '当前位置';
  const dateStr = state.forecastData?.daily?.time[state.activeTab] || '';
  const dateLabel = dateStr ? new Date(dateStr).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) : '';

  const text = `🌅 ${typeLabel}预测 · ${locName}\n📅 ${dateLabel}\n⭐ 综合评分：${score}/100\n💬 ${verdictText}\n⏰ 时段：${timeRange}\n\n数据来源：Open-Meteo ECMWF+GFS`;

  // 优先使用原生分享（iOS Safari / Android Chrome）
  if (navigator.share) {
    try {
      await navigator.share({
        title: `${typeLabel}预测 · ${score}/100`,
        text: text,
        url: window.location.href
      });
      return;
    } catch(e) {
      if (e.name === 'AbortError') return; // 用户取消
      // 降级到剪贴板
    }
  }

  // 降级：复制到剪贴板
  try {
    await navigator.clipboard.writeText(text);
    alert('✅ 预测信息已复制到剪贴板');
  } catch(e) {
    // 最终降级：prompt 让用户手动复制
    prompt('请长按复制以下预测信息：', text);
  }
}

// === 摄影建议 ===
function buildTips(d, type) {
  const tips = [];
  const cloudMH = Math.max(d.cloudMid, d.cloudHigh);
  const cloudLow = d.cloudLow;

  // === AOD 通透度提示 ===
  const aodProxy = _calcAODProxy(d.visibility, d.humidity, d.cloudLow);
  if (aodProxy > 0.5) {
    tips.push('🌫️ <strong>大气浑浊度高</strong>（等效 AOD ≈ ' + aodProxy.toFixed(2) + '），霞光色彩可能偏灰暗，建议后期加强饱和度。');
  } else if (aodProxy < 0.1 && cloudMH >= 10) {
    tips.unshift('🎯 <strong>极致通透</strong>——空气洁净度极佳 + 云层条件良好，大概率出大片！');
  }

  if (cloudMH >= 15 && cloudMH <= 65) {
    tips.push('✨ <strong>最佳云层条件</strong>——中高层云量适中，霞光色彩层次丰富。');
  } else if (cloudMH > 65) {
    tips.push('☁️ 中高层云偏多，霞光可能被遮挡，<strong>适合拍摄厚重氛围感</strong>。');
  } else {
    tips.push('🌤️ 云量偏少，霞光可能较为清淡，<strong>适合拍摄剪影</strong>风格。');
  }

  if (cloudLow > 35) {
    tips.push('⚠️ 低云较多，地平线附近可能被遮挡，<strong>建议找高地或制高点</strong>拍摄。');
  } else if (cloudLow < 8 && cloudMH >= 15) {
    tips.push('✅ 低云很少，地平线清晰通透，霞光视野良好。');
  }

  if (d.humidity > 80) {
    tips.push('💧 湿度偏高，注意<strong>镜头防雾</strong>，可备暖宝宝贴在镜筒上。');
  } else if (d.humidity >= 30 && d.humidity <= 58) {
    tips.push('💨 湿度适中，色彩饱和度预期良好。');
  }

  if (d.visibility < 2000) {
    tips.push('🌫️ 能见度极低（<2km），可能为雾/重霾，<strong>不建议出动</strong>。');
  } else if (d.visibility < 4000) {
    tips.push('🌫️ 能见度偏低，后期需加强<strong>去雾处理</strong>。');
  } else if (d.visibility > 12000) {
    tips.push('🔭 能见度极佳，空气通透度极好，色彩更鲜明。');
  }

  if (d.precipProb > 30) {
    tips.push('🌧️ 降水概率较高，带上<strong>防水装备</strong>，雨后初晴反而可能出大片。');
  }

  if (d.visibility > 10000 && cloudMH >= 18 && cloudMH <= 55 && d.humidity >= 28 && d.humidity <= 55) {
    tips.unshift('🎯 <strong>完美条件</strong>——通透 + 云量 + 湿度均在理想范围，大概率出片！');
  }

  if (type === 'morning' && d.temp < 8) {
    tips.push('🥶 清晨气温低，注意<strong>保暖和电池续航</strong>。');
  }

  return tips.join('<br>');
}

// === 构建预测卡片（莉景风格：概率 + 质量双指标 + 云层趋势图）===
// === 生成数据来源标签 ===
function getSourceLabel() {
  const sources = state.modelSources;
  if (!sources || sources.length === 0) return state.forecastData?._source || 'Open-Meteo';
  const labelMap = {
    'ecmwf_ifs': 'ECMWF IFS',
    'gfs_seamless': 'GFS',
  };
  const names = sources.map(s => labelMap[s] || s);
  if (names.length >= 2) return names.join(' + ') + ' (集成均值)';
  if (names.length === 1) return names[0] + ' (单一模型，部分数据缺失)';
  return 'Open-Meteo';
}

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
    if (s >= 85) return '#ff1744';   // 大烧
    if (s >= 70) return '#e040fb';   // 优质
    if (s >= 55) return '#4caf50';   // 好
    if (s >= 35) return '#ffeb3b';   // 一般
    if (s >= 15) return '#ff9800';   // 偏差
    return '#ff4444';                // 差
  }

  const scoreColorMain = scoreColor(score);

  const verdictMap = [
    { min: 85, text: '🔥 大烧 — 世纪朝/晚霞', emoji: '🔥' },
    { min: 70, text: '✨ 优质 — 强烈推荐出动', emoji: '✨' },
    { min: 55, text: '🌟 好烧 — 值得期待', emoji: '🌟' },
    { min: 35, text: '👀 小烧 — 有一定可能', emoji: '👀' },
    { min: 15, text: '🤔 微烧 — 不太理想', emoji: '🤔' },
    { min: 0,  text: '😴 无烧 — 建议休息', emoji: '😴' },
  ];
  const verdict = verdictMap.find(v => score >= v.min);
  const verdictText = verdict ? verdict.text : '—';

  // 概率与质量的文字评级
  const probDesc = prob >= 75 ? '✨ 较高' : prob >= 50 ? '中等' : prob >= 25 ? '偏低' : '极低';
  const qualDesc = quality >= 75 ? '🎨 绚丽' : quality >= 50 ? '尚可' : quality >= 25 ? '平淡' : '差';

  function probColorFn(s) {
    if (s >= 75) return '#4caf50';
    if (s >= 50) return '#ffeb3b';
    if (s >= 30) return '#ff9800';
    return '#ff4444';
  }
  const probColor = probColorFn(prob);
  const qualColor = probColorFn(quality);

  const factors = [
    { name: '中高层云', val: Math.max(data.cloudMid, data.cloudHigh) + '%',
      cls: Math.max(data.cloudMid, data.cloudHigh) >= 15 && Math.max(data.cloudMid, data.cloudHigh) <= 65 ? 'good' : Math.max(data.cloudMid, data.cloudHigh) > 80 ? 'bad' : 'warn' },
    { name: '低云', val: data.cloudLow + '%',
      cls: data.cloudLow > 35 ? 'bad' : data.cloudLow > 15 ? 'warn' : 'good' },
    { name: '总云量', val: data.cloudCover + '%',
      cls: data.cloudCover > 85 ? 'bad' : data.cloudCover < 5 ? 'warn' : 'good' },
    { name: '湿度', val: data.humidity + '%',
      cls: data.humidity > 85 ? 'bad' : data.humidity >= 40 && data.humidity <= 60 ? 'good' : data.humidity < 30 ? 'warn' : 'warn' },
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
            <div class="dual-circle" style="--pct:${prob};--circle-color:${probColor};color:${probColor}"><span>${prob}</span></div>
            <span class="dual-label">概率</span>
            <span class="dual-desc" style="color:${probColor}">${probDesc}</span>
          </div>
          <div class="dual-vs">×</div>
          <div class="dual-item">
            <div class="dual-circle" style="--pct:${quality};--circle-color:${qualColor};color:${qualColor}"><span>${quality}</span></div>
            <span class="dual-label">质量</span>
            <span class="dual-desc" style="color:${qualColor}">${qualDesc}</span>
          </div>
        </div>
        <div class="score-text">
          <div class="score-verdict" style="color:${scoreColorMain}">${verdict ? verdict.emoji + ' ' + verdict.text : '—'}</div>
          <div style="display:flex;align-items:baseline;gap:4px;margin-top:2px;">
            <span style="font-size:1.3rem;font-weight:800;color:${scoreColorMain}">${score}</span>
            <span style="font-size:0.65rem;color:var(--text-dim);">/ 100</span>
          </div>
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
      <div class="btn-row">
        <button class="nearby-btn" onclick="openNearbySearch('${type}')">📷 附近摄影点</button>
        <button class="share-btn" onclick="sharePrediction(${score}, '${type}', '${timeRange}', '${verdictText}')">📤 分享预测</button>
      </div>
      <div class="data-source">🌐 多模型集成 (${getSourceLabel()})</div>
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

    // === 太阳方位角静态显示（无需罗盘） ===
    if (dateStr && state.lat != null) {
      const srAz = _calcSolarAzimuth(state.lat, dateStr, 'sunrise');
      const ssAz = _calcSolarAzimuth(state.lat, dateStr, 'sunset');
      if ($srAzimuth) $srAzimuth.textContent = srAz + '°';
      if ($ssAzimuth) $ssAzimuth.textContent = ssAz + '°';
    }

    // === 蓝调时刻 & 黄金时刻计算 ===
    // 简化模型：持续时间随纬度和季节变化
    // 高纬度夏季：蓝调可达40-60分钟；低纬度冬季：仅15-20分钟
    const absLat = Math.abs(state.lat || 39.9);
    const month = now.getMonth() + 1;
    // 基础时长（分钟）：中纬度春秋约25分钟
    let baseDuration = 25;
    if (absLat > 45) baseDuration = 35;       // 高纬度更长
    else if (absLat < 25) baseDuration = 18;  // 低纬度更短
    // 季节修正：夏季略长，冬季略短
    if ((month >= 5 && month <= 8)) baseDuration += 5;
    else if (month >= 11 || month <= 2) baseDuration -= 3;

    const blueMs = baseDuration * 60000;   // 蓝调时长
    const goldMs = 60 * 60000;             // 黄金时刻固定约1小时

    // 晨蓝调：日出前 baseDuration 分钟 → 日出
    const bmStart = new Date(sr.getTime() - blueMs);
    // 晨黄金：日出 → 日出后1小时
    const gmEnd = new Date(sr.getTime() + goldMs);
    // 晚黄金：日落前1小时 → 日落
    const geStart = new Date(ss.getTime() - goldMs);
    // 晚蓝调：日落 → 日落后 baseDuration 分钟
    const beEnd = new Date(ss.getTime() + blueMs);

    const fmt = (d) => d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if ($blueMorning) $blueMorning.textContent = `${fmt(bmStart)} - ${fmt(sr)}`;
    if ($goldMorning) $goldMorning.textContent = `${fmt(sr)} - ${fmt(gmEnd)}`;
    if ($goldEvening) $goldEvening.textContent = `${fmt(geStart)} - ${fmt(ss)}`;
    if ($blueEvening) $blueEvening.textContent = `${fmt(ss)} - ${fmt(beEnd)}`;

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
        $countdownBar.classList.add('urgent');
      } else if (diff < 7200000) {
        $countdownBar.innerHTML = `📷 <strong>${nextEvent.type}</strong> 临近 · ${dayLabel} ${timeStr} · 还有 ${formatDuration(diff)}`;
        $countdownBar.style.background = nextEvent.type.includes('日出') ? 'rgba(255,152,0,0.1)' : 'rgba(224,64,251,0.1)';
        $countdownBar.classList.remove('urgent');
      } else {
        $countdownBar.innerHTML = `📷 距离 <strong>${nextEvent.type}</strong> · ${dayLabel} ${timeStr} · ${formatDuration(diff)}`;
        $countdownBar.style.background = 'rgba(255,152,0,0.05)';
        $countdownBar.classList.remove('urgent');
      }
    }
  };

  tick();
  state.countdownTimer = setInterval(tick, 1000);

  // iOS Safari 后台暂停定时器修复：页面重新可见时立即刷新
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tick(); // 立即刷新一次，修正后台期间累积的时间偏差
    }
  });
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
    cloud_cover_high: [], relative_humidity_2m: [], dew_point_2m: [], precipitation_probability: [],
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
      const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), h, 0, 0));
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
      // dew_point: approximate from temp and humidity (Magnus formula)
      const a = 17.27, b = 237.7;
      const rh = Math.max(1, sc.hum - jitter * 0.2) / 100;
      const gamma = a * (sc.tmp + Math.sin(h / 6) * 4) / (b + (sc.tmp + Math.sin(h / 6) * 4)) + Math.log(rh);
      const dewPt = b * gamma / (a - gamma);
      hourly.dew_point_2m.push(Math.round(dewPt * 10) / 10);
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

// 渲染本地地图（嵌入到预测卡片下方 — 仅作位置参考）

