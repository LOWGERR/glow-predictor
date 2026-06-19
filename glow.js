/* === 朝霞晚霞预测 · 摄影助手 - v2 === */

// ⚠️ 安全警告：API Key 硬编码在前端代码中，任何查看源码的人都能获取。
// 建议：监控用量、设置配额限制、定期轮换 Key。
const AMAP_KEY = '9a559408bacf3862588c08ad3a273edc';
const AMAP_SEARCH_URL = 'https://restapi.amap.com/v3/place/text';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

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
  // v33 新增
  aodData: null,          // 气溶胶光学厚度数据
  sunPathData: null,      // 太阳光路采样数据
  pressureTrend: null,    // 气压趋势
};


// === 错误边界：显示友好错误提示 ===
function showErrorBanner(message, showRetry) {
  let banner = document.getElementById('errorBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'errorBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9000;padding:12px 16px;background:rgba(244,67,54,0.95);color:#fff;font-size:0.85rem;text-align:center;display:none;backdrop-filter:blur(4px);';
    document.body.prepend(banner);
  }
  banner.innerHTML = message + (showRetry ? ' <button onclick="retryFetch()" style="margin-left:8px;padding:4px 12px;border:1px solid #fff;border-radius:8px;background:transparent;color:#fff;font-size:0.8rem;cursor:pointer;">重试</button>' : '');
  banner.style.display = 'block';
  setTimeout(() => { banner.style.display = 'none'; }, 8000);
}
function hideErrorBanner() {
  const b = document.getElementById('errorBanner');
  if (b) b.style.display = 'none';
}
function retryFetch() {
  hideErrorBanner();
  fetchForecast();
}

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

  // 欢迎引导：首次打开显示
  const _savedLoc = localStorage.getItem('glow_predictor_location');
  if (!_savedLoc) {
    const overlay = document.getElementById('welcomeOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      document.getElementById('welcomeLocate')?.addEventListener('click', () => {
        overlay.style.display = 'none';
        autoLocate();
      });
      document.getElementById('welcomeMap')?.addEventListener('click', () => {
        overlay.style.display = 'none';
        openMapPicker();
      });
      document.getElementById('welcomeSkip')?.addEventListener('click', () => {
        overlay.style.display = 'none';
        selectLocation(39.9042, 116.4074, '北京', '中国');
      });
    }
  }
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

  // 云层地图弹窗
  const $cmClose = document.getElementById('cloudMapClose');
  if ($cmClose) $cmClose.addEventListener('click', closeCloudMap);
  const $cmToggle = document.getElementById('cloudMapToggle');
  if ($cmToggle) $cmToggle.addEventListener('click', toggleCloudMapType);


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
// 火星坐标系偏移量算法
function _transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}
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
        // 用真实太阳方位角替代硬编码 90/270
        let sunDir = _nearbyType === 'morning' ? 90 : 270;
        if (state.forecastData?.daily?.time[state.activeTab] && state.lat != null) {
          sunDir = _calcSolarAzimuth(state.lat, state.forecastData.daily.time[state.activeTab],
            _nearbyType === 'morning' ? 'sunrise' : 'sunset');
        }
        const dirDiff = Math.abs(dir - sunDir);
        const dirScore = dirDiff <= 45 ? '⭐' : dirDiff <= 90 ? '👍' : '';
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
function navigateToPOI(lat, long, name) {
  // 先转换 WGS-84 → GCJ-02（高德坐标）
  const gcj = wgs84ToGcj02(lat, long);
  const url = `https://uri.amap.com/navigation?to=${gcj.lon},${gcj.lat},${encodeURIComponent(name)}&mode=car&coordinate=gaode`;
  window.location.href = url;
}
function distance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// === 地图内搜索（REST API + 自定义下拉面板）===
let _searchTimer = null;

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


// ════════════════════════════════════════════════════════════
// 🆕 v33 新增：气溶胶光学厚度(AOD)数据获取
// ════════════════════════════════════════════════════════════
// AOD 是预测霞光色彩饱和度的最重要单一特征（Henriksson 2019）
// Open-Meteo Air Quality API 提供 AOD 550nm 数据，免费无 key
async function fetchAODData(lat, lon) {
  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      hourly: 'aerosol_optical_depth_550nm,dust,uv_index',
      timezone: 'auto',
      forecast_days: 3,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${AIR_QUALITY_URL}?${params}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch(e) {
    console.warn('AOD 数据获取失败:', e.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// 🆕 v33 新增：太阳光路采样
// ════════════════════════════════════════════════════════════
// 沿太阳方位角方向采样远处云层数据
// 原理：好看的霞光不仅取决于头顶云层，还取决于太阳方向光路上的云层分布
// 参考：霞光雷达 golden-hour-radar 的 3 段光路采样
async function fetchSunPathData(lat, lon, azimuth, dateStr, eventType) {
  // 沿太阳方向采样 3 个距离点
  const rayDistances = [35, 90, 160]; // km
  const rayWeights = [0.45, 0.35, 0.20];

  const radAz = azimuth * Math.PI / 180;
  const R = 6371; // 地球半径 km

  const results = await Promise.allSettled(rayDistances.map(async (dist, i) => {
    // 计算采样点坐标（大圆公式简化版）
    const dR = dist / R;
    const sampleLat = Math.asin(
      Math.sin(lat * Math.PI / 180) * Math.cos(dR) +
      Math.cos(lat * Math.PI / 180) * Math.sin(dR) * Math.cos(radAz)
    ) * 180 / Math.PI;
    const sampleLon = lon + Math.atan2(
      Math.sin(radAz) * Math.sin(dR) * Math.cos(lat * Math.PI / 180),
      Math.cos(dR) - Math.sin(lat * Math.PI / 180) * Math.sin(sampleLat * Math.PI / 180)
    ) * 180 / Math.PI;

    const params = new URLSearchParams({
      latitude: sampleLat.toFixed(2),
      longitude: sampleLon.toFixed(2),
      hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high',
      timezone: 'auto',
      forecast_days: 3,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${FORECAST_URL}?${params}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return { dist: dist, weight: rayWeights[i], data: data, lat: sampleLat, lon: sampleLon };
  }));

  return results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);
}
function extractSunPathClouds(sunPathResults, eventType, eventISO) {
  if (!sunPathResults || sunPathResults.length === 0) return null;

  const eventTime = new Date(eventISO);
  const eventHour = eventTime.getHours();

  let weightedBlocking = 0;
  let totalWeight = 0;
  let weightedHighCloud = 0;

  sunPathResults.forEach(r => {
    if (!r.data || !r.data.hourly) return;
    const times = r.data.hourly.time;
    // 找最接近日出/日落时刻的小时
    let bestIdx = 0, bestDiff = Infinity;
    times.forEach((t, i) => {
      const h = new Date(t).getHours();
      const diff = Math.abs(h - eventHour);
      if (diff < bestDiff && t.startsWith(times[0].slice(0, 10))) {
        bestDiff = diff;
        bestIdx = i;
      }
    });

    const low = r.data.hourly.cloud_cover_low?.[bestIdx] ?? 0;
    const mid = r.data.hourly.cloud_cover_mid?.[bestIdx] ?? 0;
    const high = r.data.hourly.cloud_cover_high?.[bestIdx] ?? 0;

    // 光路阻挡公式（借鉴霞光雷达）
    const blocking = low * 0.78 + mid * 0.45 + high * 0.18;

    weightedBlocking += blocking * r.weight;
    weightedHighCloud += high * r.weight;
    totalWeight += r.weight;
  });

  if (totalWeight === 0) return null;

  return {
    blocking: Math.round(weightedBlocking / totalWeight),
    highCloudCanvas: Math.round(weightedHighCloud / totalWeight),
    points: sunPathResults.length,
  };
}
// 🆕 v33 新增：气压趋势分析
// ════════════════════════════════════════════════════════════
// 气压急升常伴随天况转好（反气旋控制），可作辅助指标
function getPressureTrend(data, di, type) {
  if (!data.hourly.surface_pressure) return null;

  const daily = data.daily;
  const hourly = data.hourly;
  const dateStr = daily.time[di];
  if (!dateStr) return null;

  const eventISO = type === 'morning' ? daily.sunrise[di] : daily.sunset[di];
  if (!eventISO) return null;
  const eventHour = new Date(eventISO).getHours();

  // 取事件前后 ±3h 的气压数据
  const indices = hourly.time
    .map((t, i) => ({ i, h: new Date(t).getHours() }))
    .filter(x => hourly.time[x.i].startsWith(dateStr))
    .filter(x => x.h >= eventHour - 3 && x.h <= eventHour + 3);

  if (indices.length < 3) return null;

  const pressures = indices.map(x => hourly.surface_pressure[x.i]).filter(v => v != null);
  if (pressures.length < 3) return null;

  // 线性回归斜率
  const n = pressures.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += pressures[i];
    sumXY += i * pressures[i]; sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // 气压变化率（hPa/h）：正值=升压（天况转好），负值=降压（可能转阴）
  return {
    slope: Math.round(slope * 100) / 100,
    current: pressures[Math.floor(pressures.length / 2)],
    trend: slope > 0.3 ? 'rising' : slope < -0.3 ? 'falling' : 'stable',
  };
}
function getSunPathFetches(data) {
  if (!data || !data.daily || !state.lat) return [];
  const todayIdx = 0;
  const results = [];

  // 朝霞光路
  if (data.daily.sunrise[todayIdx]) {
    const srAz = _calcSolarAzimuth(state.lat, data.daily.time[todayIdx], 'sunrise');
    results.push(fetchSunPathData(state.lat, state.lon, srAz, data.daily.time[todayIdx], 'sunrise'));
  }
  // 晚霞光路
  if (data.daily.sunset[todayIdx]) {
    const ssAz = _calcSolarAzimuth(state.lat, data.daily.time[todayIdx], 'sunset');
    results.push(fetchSunPathData(state.lat, state.lon, ssAz, data.daily.time[todayIdx], 'sunset'));
  }
  return results;
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
    hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,dew_point_2m,precipitation_probability,visibility,temperature_2m,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m',
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
    showErrorBanner('⚠️ 获取天气数据失败，请检查网络后重试', true);
    renderDemo();
    $loading.style.display = 'none';
    return;
  }

  // 记录成功模型
  state.modelSources = successData.map(d => d._model || 'unknown');

  // v33: 并行获取 AOD 和太阳光路数据（不阻塞主流程）
  const [aodResult, ...sunPathResults] = await Promise.allSettled([
    fetchAODData(state.lat, state.lon),
    // 为朝霞和晚霞各获取光路数据
    ...getSunPathFetches(successData[0])
  ]);
  state.aodData = aodResult.status === 'fulfilled' ? aodResult.value : null;
  state.sunPathData = {};
  if (sunPathResults[0]?.status === 'fulfilled') state.sunPathData.morning = sunPathResults[0].value;
  if (sunPathResults[1]?.status === 'fulfilled') state.sunPathData.evening = sunPathResults[1].value;

  // 如果只有一个模型成功，直接使用
  if (successData.length === 1) {
    const data = successData[0];
    data._source = data.meta && data.meta.models ? data.meta.models : data._model;
    data.timezone = data.timezone || 'Asia/Shanghai';
    state.forecastData = data;
    state.ensembleData = null;
    hideErrorBanner();
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
  primary.timezone = primary.timezone || 'Asia/Shanghai';
  state.forecastData = primary;
  state.ensembleData = successData; // 保留各模型原始数据供调试
  renderAll(primary);
  $loading.style.display = 'none';
}
function renderAll(data) {
  renderWeather(data);
  renderTabPredictions(data);
  startCountdown(data);
}
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

  // v33: 计算气压趋势
  const morningPressure = getPressureTrend(data, di, 'morning');
  const eveningPressure = getPressureTrend(data, di, 'evening');
  state.pressureTrend = { morning: morningPressure, evening: eveningPressure };

  const morningResult = calcScore(morningData, 'morning', morningTrend);
  const morningScore = morningResult.score;
  const morningProb = morningResult.prob;
  const morningQuality = morningResult.quality;
  const morningConfidence = morningResult.confidence;

  const eveningResult = calcScore(eveningData, 'evening', eveningTrend);
  const eveningScore = eveningResult.score;
  const eveningProb = eveningResult.prob;
  const eveningQuality = eveningResult.quality;
  const eveningConfidence = eveningResult.confidence;

  // 存到 state 供地图复用
  state.lastScores = {
    morning: { score: morningScore, prob: morningProb, quality: morningQuality, confidence: morningConfidence },
    evening: { score: eveningScore, prob: eveningProb, quality: eveningQuality, confidence: eveningConfidence },
  };

  const morningTips = buildTips(morningData, 'morning');
  const eveningTips = buildTips(eveningData, 'evening');

  const morningChart = buildCloudTrendChart(data, di, 'morning');
  const eveningChart = buildCloudTrendChart(data, di, 'evening');

  const dateLabel = formatTabDate(dateStr);

  $predictions.innerHTML =
    buildPredictionCard('🌄 朝霞预测', 'morning', morningScore, morningProb, morningQuality, morningConfidence, morningData, morningTips, sunriseISO, dateLabel, morningChart) +
    buildPredictionCard('🌇 晚霞预测', 'evening', eveningScore, eveningProb, eveningQuality, eveningConfidence, eveningData, eveningTips, sunsetISO, dateLabel, eveningChart);
}
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
// 简化公式：云底高度(m) ≈ (温度°C - 露点°C) × 125
// 返回米为单位，null 表示无法计算
function _calcCloudBaseHeight(temp, dewPoint) {
  if (temp == null || dewPoint == null) return null;
  const spread = temp - dewPoint;
  if (spread < 0) return 0; // 饱和状态，云底≈地面
  return Math.round(spread * 125);
}
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
// === 云层趋势图：SVG 折线图，显示日出/日落前后 ±2h 的云量趋势 ===
function buildCloudTrendChart(data, di, type) {
  const daily = data.daily;
  const hourly = data.hourly;

  const dateStr = daily.time[di];
  if (!dateStr) return '';

  const eventISO = type === 'morning' ? daily.sunrise[di] : daily.sunset[di];
  if (!eventISO) return '';
  const eventDate = new Date(eventISO);
  const eventHour = eventDate.getHours();

  const indices = hourly.time
    .map((t, i) => ({ i, h: new Date(t).getHours() }))
    .filter(x => hourly.time[x.i].startsWith(dateStr));

  const windowStart = eventHour - 2;
  const windowEnd = eventHour + 2;
  const windowIndices = indices
    .filter(x => x.h >= windowStart && x.h <= windowEnd)
    .sort((a, b) => a.h - b.h);

  if (windowIndices.length < 2) return '';

  const series = [
    { key: 'cloud_cover', label: '总云量', color: '#8888cc' },
    { key: 'cloud_cover_mid', label: '中云', color: '#ff9800' },
    { key: 'cloud_cover_high', label: '高云', color: '#e040fb' },
  ];

  let minVal = 0, maxVal = 100;
  const W = 240, H = 60, PAD = { top: 6, bottom: 14, left: 26, right: 10 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xScale = (idx) => PAD.left + (idx / (windowIndices.length - 1)) * plotW;
  const yScale = (v) => PAD.top + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

  let paths = '';
  series.forEach(s => {
    const pts = windowIndices.map((wi, idx) => {
      const v = hourly[s.key][wi.i] ?? 50;
      return `${xScale(idx)},${yScale(v)}`;
    });
    const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p).join(' ');
    const fillId = `fill_${s.key.replace(/_/g,'')}`;
    paths += `<defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${s.color}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${s.color}" stop-opacity="0.02"/>
    </linearGradient></defs>`;
    const bottomY = yScale(0);
    const fillD = `M${pts[0].split(',')[0]},${bottomY} L${pts.map(p => p).join(' L')} L${pts[pts.length-1].split(',')[0]},${bottomY} Z`;
    paths += `<path d="${fillD}" fill="url(#${fillId})" />`;
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`;
    pts.forEach((p, i) => {
      const [px, py] = p.split(',').map(Number);
      paths += `<circle cx="${px}" cy="${py}" r="1.8" fill="${s.color}" opacity="0.9"/>`;
    });
  });

  let xLabels = '';
  windowIndices.forEach((wi, idx) => {
    const label = `${wi.h}:00`;
    const x = xScale(idx);
    xLabels += `<text x="${x}" y="${H - 2}" text-anchor="middle" font-size="7" fill="#666">${label}</text>`;
  });

  const yTicks = [0, 25, 50, 75, 100];
  let yLabels = '';
  yTicks.forEach(v => {
    const y = yScale(v);
    yLabels += `<text x="${PAD.left - 3}" y="${y + 2.5}" text-anchor="end" font-size="6.5" fill="#555">${v}</text>`;
    yLabels += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#222" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.4"/>`;
  });

  const eventIdx = windowIndices.findIndex(wi => wi.h === eventHour);
  if (eventIdx >= 0) {
    const ex = xScale(eventIdx);
    paths += `<line x1="${ex}" y1="${PAD.top}" x2="${ex}" y2="${H - PAD.bottom}" stroke="#ff6" stroke-width="1" stroke-dasharray="3,2" opacity="0.8"/>`;
    paths += `<text x="${ex}" y="${PAD.top - 1}" text-anchor="middle" font-size="6.5" fill="#ff6" opacity="0.9">${type === 'morning' ? '🌅' : '🌇'}</text>`;
  }

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
function getTrendData(data, di, type) {
  const daily = data.daily;
  const hourly = data.hourly;
  const dateStr = daily.time[di];
  if (!dateStr) return null;

  const eventISO = type === 'morning' ? daily.sunrise[di] : daily.sunset[di];
  if (!eventISO) return null;
  const eventTime = new Date(eventISO);
  const eventHour = eventTime.getHours() + eventTime.getMinutes() / 60;

  const indices = hourly.time
    .map((t, i) => ({ i, t }))
    .filter(x => x.t.startsWith(dateStr))
    .sort((a, b) => a.t.localeCompare(b.t));

  if (indices.length < 3) return null;

  let windowStart, windowEnd;
  if (type === 'morning') { windowStart = eventHour - 3; windowEnd = eventHour + 1; }
  else { windowStart = eventHour - 2; windowEnd = eventHour + 2; }

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

  const smCloud = smooth(windowPoints.map(p => p.cloudCover));
  const smLow = smooth(windowPoints.map(p => p.cloudLow));
  const smHigh = smooth(windowPoints.map(p => p.cloudHigh));

  const eventIdx = windowPoints.findIndex(p => p.time >= eventTime);
  let preEventTrend = 0;
  if (eventIdx > 2) preEventTrend = linearSlope(smCloud.slice(0, eventIdx));

  return {
    cloudTrend: linearSlope(smCloud),
    lowCloudTrend: linearSlope(smLow),
    highTrend: linearSlope(smHigh),
    preEventTrend,
    windowSize: windowPoints.length,
  };
}
// ════════════════════════════════════════════════════════════

// 获取真实 AOD 值（优先真实数据，fallback 到 proxy 估算）
// 返回 { value, source } | null
function _getAOD(type, d) {
  // 1. 尝试真实 AOD 数据
  if (state.aodData?.hourly) {
    const aodTimes = state.aodData.hourly.time;
    const daily = state.forecastData?.daily;
    if (daily) {
      const eventISO = type === 'morning' ? daily.sunrise[0] : daily.sunset[0];
      if (eventISO) {
        const eventHour = new Date(eventISO).getHours();
        const eventDate = aodTimes[0]?.slice(0, 10);
        let aodVal = null;
        aodTimes.forEach((t, i) => {
          if (t.startsWith(eventDate) && Math.abs(new Date(t).getHours() - eventHour) <= 1) {
            const v = state.aodData.hourly.aerosol_optical_depth_550nm?.[i];
            if (v != null) aodVal = v;
          }
        });
        if (aodVal != null) return { value: aodVal, source: 'real' };
      }
    }
  }
  // 2. Fallback: 用能见度+湿度+低云估算
  if (d) {
    const proxy = _calcAODProxy(d.visibility, d.humidity, d.cloudLow);
    return { value: proxy, source: 'proxy' };
  }
  return null;
}
// 返回 { blocking, highCloudCanvas, score } | null
function _getSunPathScore(type) {
  if (!state.sunPathData) return null;
  const spData = type === 'morning' ? state.sunPathData.morning : state.sunPathData.evening;
  if (!spData) return null;
  const eventISO = type === 'morning'
    ? state.forecastData?.daily?.sunrise[0]
    : state.forecastData?.daily?.sunset[0];
  const sp = extractSunPathClouds(spData, type, eventISO);
  if (!sp) return null;

  // 光路通透评分 (0-100, 100=完全通透)
  let score = 100 - sp.blocking;
  // 远处高云画布加分
  if (sp.highCloudCanvas >= 20 && sp.highCloudCanvas <= 60) score += 10;
  else if (sp.highCloudCanvas < 8) score -= 15;
  score = Math.max(0, Math.min(100, score));

  return { blocking: sp.blocking, highCloudCanvas: sp.highCloudCanvas, score };
}
// 数据越完整、时效性越好，置信度越高
function calcConfidence(d, type) {
  let confidence = 50; // 基础分
  let factors = 0;
  let available = 0;

  // 1. 核心数据完整性 (每个 +5)
  const checks = [
    d.cloudCover != null, d.cloudLow != null, d.cloudMid != null,
    d.cloudHigh != null, d.humidity != null, d.visibility != null,
    d.precipProb != null, d.temp != null
  ];
  factors = checks.length;
  available = checks.filter(Boolean).length;
  confidence += (available / factors) * 25;

  // 2. AOD 数据可用性 (+10 真实, +5 proxy)
  const aod = _getAOD(type, d);
  if (aod?.source === 'real') confidence += 10;
  else if (aod?.source === 'proxy') confidence += 5;

  // 3. 光路数据可用性 (+8)
  if (_getSunPathScore(type)) confidence += 8;

  // 4. 趋势数据可用性 (+5)
  const trend = getTrendData(state.forecastData, state.activeTab, type);
  if (trend?.cloudTrend != null) confidence += 5;

  // 5. 气压数据可用性 (+3)
  if (state.forecastData?.hourly?.surface_pressure) confidence += 3;

  // 6. 露点数据可用性 (+4，用于云底高度)
  if (d.dewPoint != null) confidence += 4;

  return Math.max(0, Math.min(100, Math.round(confidence)));
}
// 🔬 多因子融合评分引擎 v5
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
// 40-60% 最佳；>80% 雾蒙蒙；<30% 太干
function _calcHumidityScore(humidity) {
  if (humidity >= 40 && humidity <= 60) return 15;
  if (humidity >= 30 && humidity < 40) return 8;
  if (humidity > 60 && humidity <= 75) return 4;
  if (humidity > 75 && humidity <= 85) return -4;
  if (humidity > 85) return -12;
  return -8; // <30%
}
// 概率：霞光出现的可能性（%），主要看遮挡因素
// 质量：霞光色彩壮观度（%），主要看散射条件
function calcProbability(d, type, trendData) {
  // v5: 概率只回答"有没有霞"——遮挡、降水、极端天气
  // 不包含 AOD/能见度/湿度（这些是质量因素）
  let prob = 50;
  const cloudMid = d.cloudMid, cloudHigh = d.cloudHigh, cloudLow = d.cloudLow;
  const cloudMH = Math.max(cloudMid, cloudHigh);

  // 1. 中高层云：霞光的"画布"
  if (cloudMH < 3)       prob -= 35;
  else if (cloudMH < 8)  prob -= 25;
  else if (cloudMH < 14) prob -= 12;
  else if (cloudMH >= 16 && cloudMH <= 62) prob += 5;
  else if (cloudMH <= 75) prob -= 3;
  else if (cloudMH <= 85) prob -= 15;
  else if (cloudMH <= 93) prob -= 25;
  else prob -= 32;

  // 2. 低云遮挡：低云挡住光线到达高云
  if (cloudLow > 75) { prob -= 28; if (cloudMH > 15) prob -= 10; }
  else if (cloudLow > 55) { prob -= 18; if (cloudMH > 20) prob -= 5; }
  else if (cloudLow > 35) prob -= 8;
  else if (cloudLow > 18) prob -= 3;
  else prob += 3;

  // 3. 降水概率
  if (d.precipProb > 75) prob -= 30;
  else if (d.precipProb > 55) prob -= 20;
  else if (d.precipProb > 30) prob -= 10;
  else if (d.precipProb > 12) prob -= 4;
  else prob += 2;

  // 4. 总云量极端
  if (d.cloudCover > 95) prob -= 20;
  if (d.cloudCover < 5 && cloudMH < 5) prob -= 12;

  // 5. 云底高度
  const cloudBaseH = _calcCloudBaseHeight(d.temp, d.dewPoint);
  if (cloudBaseH !== null) {
    if (cloudBaseH < 200 && cloudLow > 20) prob -= 5;
    else if (cloudBaseH < 500 && cloudLow > 35) prob -= 3;
  }

  // 6. 太阳光路采样
  const spScore = _getSunPathScore(type);
  if (spScore) {
    if (spScore.blocking < 15) prob += 8;
    else if (spScore.blocking < 30) prob += 4;
    else if (spScore.blocking < 50) prob += 0;
    else if (spScore.blocking < 70) prob -= 5;
    else prob -= 10;
    if (spScore.highCloudCanvas >= 20 && spScore.highCloudCanvas <= 65) prob += 5;
    else if (spScore.highCloudCanvas < 8) prob -= 4;
  }

  // 7. 趋势评分
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

  // 8. 气压趋势
  const pTrend = state.pressureTrend?.[type];
  if (pTrend) {
    if (pTrend.trend === 'rising' && pTrend.slope > 0.5) prob += 4;
    else if (pTrend.trend === 'rising') prob += 2;
    else if (pTrend.trend === 'falling' && pTrend.slope < -0.5) prob -= 3;
    else if (pTrend.trend === 'falling') prob -= 1;
  }

  // 9. 气压绝对值（高气压=天况好）
  if (d.pressure != null) {
    if (d.pressure > 1020) prob += 3;
    else if (d.pressure > 1013) prob += 1;
    else if (d.pressure < 1005) prob -= 3;
    else if (d.pressure < 1000) prob -= 5;
  }

  // 10. 风速（微风最佳，大风云消散快）
  if (d.windSpeed != null) {
    if (d.windSpeed >= 3 && d.windSpeed <= 15) prob += 3;   // 微风：云缓慢移动，持续时间长
    else if (d.windSpeed > 15 && d.windSpeed <= 25) prob += 0; // 轻风：中性
    else if (d.windSpeed > 25 && d.windSpeed <= 40) prob -= 3; // 中风：云变化快
    else if (d.windSpeed > 40) prob -= 8;                      // 大风：云快速消散
  }

  // 11. 季节修正
  if (state.lat != null) {
    const month = new Date().getMonth() + 1;
    prob += _calcSolarElevationCorrection(state.lat, month, type);
  }


  // 12. 雨后初晴加分
  if (d.precipProb < 20) {
    const _h = state.forecastData?.hourly;
    if (_h && _h.precipitation_probability) {
      const _ds = state.forecastData?.daily?.time[state.activeTab];
      const _ei = type === 'morning' ? state.forecastData?.daily?.sunrise[state.activeTab] : state.forecastData?.daily?.sunset[state.activeTab];
      if (_ds && _ei) {
        const _eh = new Date(_ei).getHours();
        let _mp = 0;
        _h.time.forEach((t, i) => {
          if (t.startsWith(_ds)) {
            const h = new Date(t).getHours();
            if (h >= _eh - 6 && h < _eh - 1) _mp = Math.max(_mp, _h.precipitation_probability[i] || 0);
          }
        });
        if (_mp > 50) prob += 10;
        else if (_mp > 30) prob += 5;
      }
    }
  }

  return Math.max(0, Math.min(100, Math.round(prob)));
}
// === 一键分享预测卡片 ===
async function sharePrediction(score, type, timeRange, verdictText) {
  const typeLabel = type === 'morning' ? '朝霞' : '晚霞';
  const locName = state.name || '当前位置';
  const dateStr = state.forecastData?.daily?.time[state.activeTab] || '';
  const dateLabel = dateStr ? new Date(dateStr).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) : '';

  // 获取置信度（从评分结果中获取）
  const confText = '';

  const url = window.location.href;
  const text = `🌅 ${typeLabel}预测 · ${locName}
📅 ${dateLabel}
⭐ 综合评分：${score}/100
💬 ${verdictText}
⏰ 时段：${timeRange}

🔗 ${url}
📊 数据来源：Open-Meteo ECMWF+GFS`;

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

  // v42: 霞光持续时间预测
  const _cMH = Math.max(d.cloudMid || 0, d.cloudHigh || 0);
  const _ws = d.windSpeed || 0;
  let _dur = 15;
  if (_cMH >= 20 && _cMH <= 60 && _ws < 20) _dur = 25;
  else if (_cMH >= 15 && _cMH <= 70 && _ws < 30) _dur = 18;
  else if (_ws > 35 || _cMH < 10 || _cMH > 80) _dur = 8;
  else if (_cMH < 5) _dur = 5;
  tips.push('⏱️ 预计霞光持续 <strong>' + _dur + '-' + (_dur + 5) + ' 分钟</strong>，' + (_dur >= 20 ? '有充足时间构图' : _dur >= 12 ? '建议提前到位' : '转瞬即逝，需快速反应') + '。');

  // v42: 最佳拍摄方向推荐
  if (state.lat != null && state.forecastData) {
    const _dStr = state.forecastData.daily?.time[state.activeTab];
    if (_dStr) {
      const _sAz = _calcSolarAzimuth(state.lat, _dStr, type === 'morning' ? 'sunrise' : 'sunset');
      const _dirName = ['北','东北','东','东南','南','西南','西','西北'][Math.round(_sAz / 45) % 8];
      tips.push('📸 推荐朝向 <strong>' + _sAz + '°（' + _dirName + '方向）</strong>，正对' + (type === 'morning' ? '日出' : '日落') + '光线。');
    }
  }



  // v41: 风速提示
  if (d.windSpeed != null) {
    if (d.windSpeed >= 3 && d.windSpeed <= 12) tips.push('🍃 微风 ' + Math.round(d.windSpeed) + 'km/h，大气稳定，散射均匀，<strong>色彩表现最佳</strong>。');
    else if (d.windSpeed > 35) tips.push('💨 风速 ' + Math.round(d.windSpeed) + 'km/h，云层变化快，<strong>霞光可能转瞬即逝</strong>，抓紧拍摄。');
    else if (d.windSpeed > 25) tips.push('🌬️ 风速 ' + Math.round(d.windSpeed) + 'km/h，云移动较快，注意<strong>提前构图等待</strong>。');
  }

  // v41: 气压提示
  if (d.pressure != null) {
    if (d.pressure > 1020) tips.push('📊 气压 ' + Math.round(d.pressure) + 'hPa（高压控制），<strong>天况稳定，通透度高</strong>。');
    else if (d.pressure < 1005) tips.push('📊 气压 ' + Math.round(d.pressure) + 'hPa（低压），天气可能不稳定，<strong>注意变化</strong>。');
  }

  // v5: AOD 通透度提示（使用统一 _getAOD 函数）
  const aodTip = _getAOD(type, d);
  if (aodTip) {
    const src = aodTip.source === 'real' ? '真实AOD' : '估算AOD';
    if (aodTip.value < 0.05) tips.unshift('🌍 <strong>' + src + ' ' + aodTip.value.toFixed(2) + '</strong>——空气极致通透，色彩饱和度将达到巅峰！');
    else if (aodTip.value < 0.1) tips.unshift('🌍 <strong>' + src + ' ' + aodTip.value.toFixed(2) + '</strong>——空气非常洁净，霞光色彩将很鲜艳。');
    else if (aodTip.value > 0.35) tips.push('🌫️ <strong>' + src + ' ' + aodTip.value.toFixed(2) + '</strong>——大气浑浊，霞光色彩可能偏灰暗。');
  }

  // v5: 太阳光路提示（使用统一 _getSunPathScore 函数）
  const spTip = _getSunPathScore(type);
  if (spTip) {
    if (spTip.blocking < 15 && spTip.highCloudCanvas >= 20) {
      tips.unshift('🔭 <strong>光路通透</strong>——太阳方向低云少、高云充足，光线将直达观测点！');
    } else if (spTip.blocking > 55) {
      tips.push('🚧 <strong>光路受阻</strong>——太阳方向云层较厚，霞光可能被遮挡，建议换方向或找制高点。');
    }
  }

  // v33: 气压趋势提示
  const pTrend = state.pressureTrend?.[type];
  if (pTrend) {
    if (pTrend.trend === 'rising' && pTrend.slope > 0.5) {
      tips.push('📈 <strong>气压上升中</strong>（' + pTrend.slope.toFixed(1) + ' hPa/h），天况可能持续转好。');
    } else if (pTrend.trend === 'falling' && pTrend.slope < -0.5) {
      tips.push('📉 <strong>气压下降中</strong>（' + pTrend.slope.toFixed(1) + ' hPa/h），注意天气可能变化。');
    }
  }

  return tips.join('<br>');
}
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

    const timeOpts = { hour: '2-digit', minute: '2-digit', timeZone: data.timezone || 'Asia/Shanghai' };
    $sunriseTime.textContent = sr.toLocaleTimeString('zh-CN', timeOpts);
    $sunsetTime.textContent = ss.toLocaleTimeString('zh-CN', timeOpts);

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

    const fmt = (d) => d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: data.timezone || 'Asia/Shanghai' });
    if ($blueMorning) $blueMorning.textContent = `${fmt(bmStart)} - ${fmt(sr)}`;
    if ($goldMorning) $goldMorning.textContent = `${fmt(sr)} - ${fmt(gmEnd)}`;
    if ($goldEvening) $goldEvening.textContent = `${fmt(geStart)} - ${fmt(ss)}`;
    if ($blueEvening) $blueEvening.textContent = `${fmt(ss)} - ${fmt(beEnd)}`;

    // 倒计时：距离最近的日出或日落事件
    // 找所有日出日落时间，找到下一个
    const events = [];
    for (let d = 0; d < daily.time.length; d++) {
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
      const timeStr = nextEvent.time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: data.timezone || 'Asia/Shanghai' });
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
function renderDemo() {
  const now = new Date();
  const daily = { time: [], sunrise: [], sunset: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [] };
  const hourly = { time: [], cloud_cover: [], cloud_cover_low: [], cloud_cover_mid: [],
    cloud_cover_high: [], relative_humidity_2m: [], dew_point_2m: [], precipitation_probability: [],
    visibility: [], temperature_2m: [], weather_code: [], surface_pressure: [], wind_speed_10m: [], wind_direction_10m: [] };

  const scenarios = [
    { cc: 55, cl: 8,  cm: 40, ch: 45, hum: 52, pp: 3,  vis: 9000,  tmp: 23, wc: 2,  tmax: 27, tmin: 18, ppmax: 8, wind: 8, pres: 1018 },
    { cc: 35, cl: 5,  cm: 20, ch: 25, hum: 42, pp: 0,  vis: 12000, tmp: 25, wc: 1,  tmax: 29, tmin: 19, ppmax: 0, wind: 12, pres: 1022 },
    { cc: 78, cl: 50, cm: 65, ch: 55, hum: 78, pp: 40, vis: 3500,  tmp: 20, wc: 61, tmax: 24, tmin: 16, ppmax: 55, wind: 28, pres: 1002 },
  ];

  for (let d = 0; d < 3; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().slice(0, 10);
    daily.time.push(dateStr);

    const sunriseD = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 5, 10 + Math.floor(Math.random() * 20), 0);
    const sunsetD = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 18, 30 + Math.floor(Math.random() * 30), 0);
    daily.sunrise.push(sunriseD.toISOString());
    daily.sunset.push(sunsetD.toISOString());

    const sc = scenarios[d % 3];
    daily.temperature_2m_max.push(sc.tmax);
    daily.temperature_2m_min.push(sc.tmin);
    daily.precipitation_probability_max.push(sc.ppmax);

    for (let h = 0; h < 24; h++) {
      const t = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, 0, 0);
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
      hourly.surface_pressure.push(Math.round((sc.pres || 1013) + jitter * 2));
      hourly.wind_speed_10m.push(Math.round((sc.wind || 10) + jitter * 0.5));
      hourly.wind_direction_10m.push(Math.round(180 + jitter * 10));
      // dew_point: approximate from temp and humidity (Magnus formula)
      const a = 17.27, b = 237.7;
      const rh = Math.max(1, sc.hum - jitter * 0.2) / 100;
      const gamma = a * (sc.tmp + Math.sin(h / 6) * 4) / (b + (sc.tmp + Math.sin(h / 6) * 4)) + Math.log(rh);
      const dewPt = b * gamma / (a - gamma);
      hourly.dew_point_2m.push(Math.round(dewPt * 10) / 10);
    }
  }

  const data = { daily, hourly, timezone: 'Asia/Shanghai' };
  state.forecastData = data;
  renderAll(data);


  const banner = document.createElement('div');
  banner.className = 'demo-banner';
  banner.textContent = '⚠️ 当前为演示模式，数据为模拟。联网后将展示真实预测。';
  $predictions.insertAdjacentElement('beforebegin', banner);
}
// 找到目标日期+日出/日落时刻的小时索引
function findHourlyIndex(data, di, type) {
  if (!data || !data.hourly || !data.daily) return 0;
  const dateStr = data.daily.time[di];
  const eventISO = type === 'morning' ? data.daily.sunrise?.[di] : data.daily.sunset?.[di];
  if (!dateStr || !eventISO) return 0;
  const eventHour = new Date(eventISO).getHours();
  let bestIdx = 0, bestDiff = 99;
  data.hourly.time.forEach((t, i) => {
    if (t.startsWith(dateStr)) {
      const h = new Date(t).getHours();
      const diff = Math.abs(h - eventHour);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
  });
  return bestIdx;
}

// ════════════════════════════════════════════════════════════
// 🆕 v36: 区域云层质量地图
// ════════════════════════════════════════════════════════════
let _cloudMap = null;
let _cloudMapMarkers = [];
let _cloudMapType = 'evening'; // 'morning' | 'evening'
let _cloudMapLoading = false;

// 获取评分对应颜色
function scoreColor(s) {
  if (s >= 85) return '#ff1744';
  if (s >= 70) return '#e040fb';
  if (s >= 55) return '#4caf50';
  if (s >= 35) return '#ffeb3b';
  if (s >= 15) return '#ff9800';
  return '#888';
}

// 获取评分等级文字
function scoreLabel(s) {
  if (s >= 85) return '大烧';
  if (s >= 70) return '优质';
  if (s >= 55) return '好烧';
  if (s >= 35) return '小烧';
  if (s >= 15) return '微烧';
  return '无烧';
}

async function loadCloudMapData() {
  if (_cloudMapLoading) return;
  _cloudMapLoading = true;
  const infoEl = document.getElementById('cloudMapInfo');
  infoEl.innerHTML = '⏳ 正在加载预测数据…';

  _cloudMapMarkers.forEach(m => _cloudMap.removeLayer(m));
  _cloudMapMarkers = [];

  const lat = state.lat, lon = state.lon;
  const type = _cloudMapType;

  // 太阳方位角
  const dateStr = state.forecastData?.daily?.time[state.activeTab];
  let sunAzimuth = type === 'morning' ? 90 : 270;
  if (dateStr && lat != null) sunAzimuth = _calcSolarAzimuth(lat, dateStr, type === 'morning' ? 'sunrise' : 'sunset');

  // 太阳方向线
  const sunRad = sunAzimuth * Math.PI / 180;
  const lineLen = 3;
  const sunEndLat = lat + lineLen * Math.cos(sunRad);
  const sunEndLon = lon + lineLen * Math.sin(sunRad) / Math.cos(lat * Math.PI / 180);
  const sunLine = L.polyline([[lat, lon], [sunEndLat, sunEndLon]],
    { color: '#ff9800', weight: 3, opacity: 0.6, dashArray: '8,6' }).addTo(_cloudMap);
  _cloudMapMarkers.push(sunLine);
  const sunIcon = L.divIcon({ className: '', html: '<div style="font-size:20px;text-shadow:0 0 6px rgba(255,152,0,0.8)">☀️</div>', iconSize: [24, 24], iconAnchor: [12, 12] });
  _cloudMapMarkers.push(L.marker([sunEndLat, sunEndLon], { icon: sunIcon }).addTo(_cloudMap));

  // 当前位置标记
  const hereIcon = L.divIcon({ className: '', html: '<div style="width:14px;height:14px;background:#007aff;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,122,255,0.6)"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
  _cloudMapMarkers.push(L.marker([lat, lon], { icon: hereIcon }).addTo(_cloudMap));

  // 中心点评分：直接用主页已计算的结果
  const saved = state.lastScores?.[type];
  const centerScore = saved?.score ?? 50;
  const centerProb = saved?.prob ?? 50;
  const centerQuality = saved?.quality ?? 50;
  const centerColor = scoreColor(centerScore);

  // 中心点大圆标记
  const centerCircle = L.circleMarker([lat, lon], {
    radius: 18, fillColor: centerColor, fillOpacity: 0.85,
    color: '#fff', weight: 2.5, opacity: 0.95,
  }).addTo(_cloudMap);
  const centerLabel = L.divIcon({ className: '', interactive: false,
    html: '<div style="font-size:11px;font-weight:700;color:#fff;text-align:center;line-height:20px;text-shadow:0 1px 3px rgba(0,0,0,0.7)">' + centerScore + '</div>',
    iconSize: [28, 22], iconAnchor: [14, 11] });
  L.marker([lat, lon], { icon: centerLabel, interactive: false }).addTo(_cloudMap);
  _cloudMapMarkers.push(centerCircle);

  // 周围 7x7 网格采样（用主页数据 + 距离衰减模拟空间变化）
  const gridSize = 7, spacing = 0.27;
  const startLat = lat - (gridSize - 1) / 2 * spacing;
  const startLon = lon - (gridSize - 1) / 2 * spacing;
  let successCount = 1;

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const pLat = startLat + r * spacing;
      const pLon = startLon + c * spacing;
      if (Math.abs(pLat - lat) < 0.01 && Math.abs(pLon - lon) < 0.01) continue;

      const dist = distance(lat, lon, pLat, pLon);
      const noise = (Math.random() - 0.5) * 15;
      const decay = Math.min(dist / 200, 1) * 0.3;
      const score = Math.max(0, Math.min(100, Math.round(centerScore * (1 - decay) + noise)));
      const color = scoreColor(score);

      const circle = L.circleMarker([pLat, pLon], {
        radius: 12, fillColor: color, fillOpacity: 0.6,
        color: color, weight: 1, opacity: 0.8,
      }).addTo(_cloudMap);

      const labelIcon = L.divIcon({ className: '', interactive: false,
        html: '<div style="font-size:9px;font-weight:700;color:#fff;text-align:center;line-height:18px;text-shadow:0 1px 2px rgba(0,0,0,0.5)">' + score + '</div>',
        iconSize: [24, 18], iconAnchor: [12, 9] });
      L.marker([pLat, pLon], { icon: labelIcon, interactive: false }).addTo(_cloudMap);

      circle.on('click', () => {
        const d = Math.round(distance(lat, lon, pLat, pLon));
        const dir = bearing(lat, lon, pLat, pLon);
        const dirStr = ['北','东北','东','东南','南','西南','西','西北'][Math.round(dir / 45) % 8];
        const typeLabel = type === 'morning' ? '朝霞' : '晚霞';
        infoEl.innerHTML = typeLabel + ' <span class="info-score" style="color:' + color + '">' + score + '</span> ' + scoreLabel(score) +
          ' <span style="color:var(--text-dim)">· ' + dirStr + ' ' + (d >= 1000 ? (d/1000).toFixed(1) + 'km' : d + 'm') + '</span>' +
          ' <span style="color:var(--text-dim);font-size:0.7rem">(基于中心点数据估算)</span>';
      });

      _cloudMapMarkers.push(circle);
      successCount++;
    }
  }

  const typeLabel = type === 'morning' ? '朝霞' : '晚霞';
  infoEl.innerHTML = '✅ ' + successCount + ' 个采样点 · ' + typeLabel + '综合 <span class="info-score" style="color:' + centerColor + '">' + centerScore + '</span> ' + scoreLabel(centerScore) + ' · 概率 ' + centerProb + ' · 质量 ' + centerQuality + ' <span style="color:var(--text-dim);font-size:0.7rem">· 中心点实际数据，周围为估算</span>';
  _cloudMapLoading = false;
}


// === 启动 ===
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

console.log('🌅 朝霞晚霞预测 v42 · 摄影助手已就绪');

// 渲染本地地图（嵌入到预测卡片下方 — 仅作位置参考）

