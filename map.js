// === 地图功能 ===
// 由 glow.js 自动拆分生成


// === 坐标转换（WGS-84 ? GCJ-02）===

function _transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}

// WGS-84 → GCJ-02（同步版，不依赖 AMap JS API，用于 REST API 调用）


// WGS-84 ? GCJ-02（高德地图专用，使用 AMap JS API 或回退本地算法）


// GCJ-02 ? WGS-84（迭代逼近，用于地图点选的坐标修正）


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


function closeMapPicker() {
  $mapModal.style.display = 'none';
  $mapSearchResults.classList.remove('show');
  $mapSearchInput.value = '';
  if (_mapMarker && _mapInstance) { _mapInstance.remove(_mapMarker); _mapMarker = null; }
  _mapLat = null; _mapLon = null;
}


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
    const safeName = p.name.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));
    const distText = p.dist >= 1000 ? (p.dist/1000).toFixed(1) + 'km' : p.dist + 'm';
    return `
      <div class="nearby-item" data-lat="${p.lat}" data-lon="${p.long}" data-name="${safeName}">
        <span class="nearby-rank">${i+1}</span>
        <div class="nearby-info">
          <div class="nearby-name">${p.name} ${p.dirScore}</div>
          <div class="nearby-detail">${distText} · ${p.type || (category || '景点')}</div>
        </div>
        <button class="nearby-nav-btn" title="导航前往">🗺️</button>
      </div>
    `;
  }).join('');

  // 用事件委托替代内联 onclick（更安全、更高效）
  const resultsEl = document.getElementById('nearbyResults');
  resultsEl.onclick = (e) => {
    const item = e.target.closest('.nearby-item');
    if (!item) return;
    const lat = +item.dataset.lat, lon = +item.dataset.lon, name = item.dataset.name;
    if (e.target.closest('.nearby-nav-btn')) {
      navigateToPOI(lat, lon, name);
    } else {
      selectNearbyPOI(lat, lon, name);
    }
  };
}


function selectNearbyPOI(lat, long, name) {
  selectLocation(lat, long, name, '');
  closeNearbyModal();
  // 在地图选择器上标记该点
  showNearbyPOIOnMap(lat, long, name);
}

// 附近摄影点 → 地图标记展示


// 一键导航到指定 POI（打开高德地图 app / 网页）


// 附近搜索：自定义关键词（用户输入）


function bearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}


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


// 渲染搜索结果（统一处理 inputtips 和 pois）





function openCloudMap(type) {
  if (!state.lat || !state.lon) { alert('请先获取位置'); return; }
  if (type) _cloudMapType = type;
  const modal = document.getElementById('cloudMapModal');
  modal.style.display = 'flex';
  document.getElementById('cloudMapTitle').textContent =
    _cloudMapType === 'evening' ? '🌅 晚霞预测地图' : '🌄 朝霞预测地图';
  document.getElementById('cloudMapInfo').innerHTML = '⏳ 正在加载地图…';
  document.body.classList.add('no-scroll');

  // 等待 DOM 渲染完成后再初始化地图（关键！）
  requestAnimationFrame(() => {
    setTimeout(() => {
      if (!_cloudMap) {
        _cloudMap = L.map('cloudMapContainer', {
          center: [state.lat, state.lon],
          zoom: 9,
          zoomControl: true,
        });
        L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
        subdomains: '1234',
        attribution: '© 高德地图',
        maxZoom: 18,
      }).addTo(_cloudMap);
      } else {
        _cloudMap.invalidateSize();
        _cloudMap.setView([state.lat, state.lon], 9);
      }
      // 确保瓦片加载
      setTimeout(() => {
        if (_cloudMap) _cloudMap.invalidateSize();
      }, 300);
      loadCloudMapData();
    }, 100);
  });
}

function closeCloudMap() {
  document.getElementById('cloudMapModal').style.display = 'none';
  document.body.classList.remove('no-scroll');
}

function toggleCloudMapType() {
  _cloudMapType = _cloudMapType === 'evening' ? 'morning' : 'evening';
  document.getElementById('cloudMapToggle').textContent =
    _cloudMapType === 'evening' ? '🌅 晚霞' : '🌄 朝霞';
  document.getElementById('cloudMapTitle').textContent =
    _cloudMapType === 'evening' ? '🌅 晚霞预测地图' : '🌄 朝霞预测地图';
  loadCloudMapData();
}