
function _transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

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

async function mapSearch() {
  await doPlaceSearch($mapSearchInput.value.trim());
}

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

