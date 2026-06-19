import { state, DOM, AMAP_KEY, AMAP_SEARCH_URL, GEO_URL, FORECAST_URL, AIR_QUALITY_URL } from './state.js';
import { calcScore, calcProbability, calcQuality, calcConfidence, scoreColor, scoreLabel, _getAOD, _getSunPathScore, getTrendData, buildCloudTrendChart, findHourlyIndex, extractSunPathClouds, getPressureTrend, _calcSolarAzimuth, _calcCloudBaseHeight, _calcCloudContinuity, _calcSolarElevationCorrection, _calcCloudTypeScore, _calcVisibilityScore, _calcHumidityScore } from './scoring.js';
import { confirmMapPick, closeNearbyModal, queryAllCategories, searchNearbyPOI, showNearbyPOIOnMap, navigateToPOI, distance, doAutoSearch, doPlaceSearch, renderSearchResults, mapSearch, getAmapRegeo, loadCloudMapData, wgs84ToGcj02, convertWGS84toGCJ02, convertGCJ02toWGS84 } from './map.js';
import { showErrorBanner, hideErrorBanner, retryFetch, renderAll, handleTabClick, renderTabPredictions, sharePrediction, buildTips, getSourceLabel, startCountdown, renderDemo } from './ui.js';

const MARKER_SVG = 'data:image/svg+xml;base64,' + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 34">' +
  '<path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.2 11.3 20.5 12.1 21.3.2.2.4.3.7.3.2 0 .4-.1.6-.2.8-.8 12.1-12.1 12.1-21.3C25.5 5.6 19.9 0 12.5 0zm0 19c-3.6 0-6.5-2.9-6.5-6.5S8.9 6 12.5 6s6.5 2.9 6.5 6.5-2.9 6.5-6.5 6.5z" fill="#FF3B30"/></svg>'
);
// 火星坐标系偏移量算法


// === 常用位置收藏 ===
const FAV_KEY = 'glow_favorites';
const MAX_FAVS = 10;
function getFavorites() { try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch(e) { return []; } }
function saveFavorites(favs) { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); updateFavButton(); }
function isFavorite(lat, lon) { return getFavorites().some(f => Math.abs(f.lat - lat) < 0.001 && Math.abs(f.lon - lon) < 0.001); }
function toggleFavorite() {
  if (!state.lat || !state.lon) return;
  const favs = getFavorites();
  const idx = favs.findIndex(f => Math.abs(f.lat - state.lat) < 0.001 && Math.abs(f.lon - state.lon) < 0.001);
  if (idx >= 0) { favs.splice(idx, 1); }
  else { if (favs.length >= MAX_FAVS) { alert('最多收藏' + MAX_FAVS + '个位置'); return; } favs.push({ name: state.name || '未知位置', lat: state.lat, lon: state.lon }); }
  saveFavorites(favs);
}
function updateFavButton() {
  const btn = document.getElementById('favBtn');
  if (!btn || !state.lat || !state.lon) { if (btn) btn.style.display = 'none'; return; }
  btn.style.display = 'inline';
  btn.classList.toggle('active', isFavorite(state.lat, state.lon));
  btn.textContent = isFavorite(state.lat, state.lon) ? '⭐' : '☆';
}
function showFavorites() {
  const modal = document.getElementById('favoritesModal');
  const list = document.getElementById('favoritesList');
  if (!modal || !list) return;
  const favs = getFavorites();
  if (favs.length === 0) { list.innerHTML = '<div class="favorites-empty">还没有收藏位置<br><span style="font-size:0.7rem;opacity:0.6">在任意位置点击 ☆ 收藏</span></div>'; }
  else {
    list.innerHTML = favs.map((f, i) => '<div class="favorites-item" data-idx="' + i + '"><span>📍</span><span class="favorites-item-name">' + (f.name || '未知') + '</span><button class="favorites-item-del" data-del="' + i + '">🗑️</button></div>').join('');
    list.querySelectorAll('.favorites-item').forEach(el => {
      el.addEventListener('click', function(e) {
        if (e.target.closest('.favorites-item-del')) { const d = +e.target.closest('.favorites-item-del').dataset.del; const u = getFavorites(); u.splice(d, 1); saveFavorites(u); showFavorites(); return; }
        const f = getFavorites()[+el.dataset.idx];
        if (f) { selectLocation(f.lat, f.lon, f.name || '', ''); modal.style.display = 'none'; }
      });
    });
  }
  modal.style.display = 'flex';
}
function initFavorites() {
  const fb = document.getElementById('favBtn');
  const fl = document.getElementById('favListBtn');
  const fc = document.getElementById('favoritesClose');
  if (fb) fb.addEventListener('click', toggleFavorite);
  if (fl) fl.addEventListener('click', showFavorites);
  if (fc) fc.addEventListener('click', function() { document.getElementById('favoritesModal').style.display = 'none'; });
  const fm = document.getElementById('favoritesModal');
  if (fm) fm.addEventListener('click', function(e) { if (e.target === fm) fm.style.display = 'none'; });
  updateFavButton();
}

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
  updateFavButton();
  fetchForecast();
}

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
    try {
      try {
        const res = await fetch(`${FORECAST_URL}?${params}`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return null;
        const data = await res.json();
        return { dist: dist, weight: rayWeights[i], data: data, lat: sampleLat, lon: sampleLon };
      } catch(e) { clearTimeout(timeout); return null; }
    } catch(e) { clearTimeout(timeout); return null; }
  }));

  return results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);
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

// Make functions available for inline onclick handlers
window.openNearbySearch = queryAllCategories;
window.closeNearbyModal = closeNearbyModal;
window.showNearbyPOIOnMap = showNearbyPOIOnMap;
window.navigateToPOI = navigateToPOI;
window.openCloudMap = function(type) { loadCloudMapData(type); };
window.closeCloudMap = function() { document.getElementById('cloudMapModal').style.display = 'none'; };
window.toggleCloudMapType = function() { /* handled in map.js */ };
window.sharePrediction = sharePrediction;
window.selectLocation = selectLocation;
window.autoLocate = autoLocate;
window.openMapPicker = function() { /* handled inline */ };
window.retryFetch = retryFetch;
window.renderDemo = renderDemo;

// === 启动 ===
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

console.log('🌅 朝霞晚霞预测 v44 · 摄影助手已就绪');
