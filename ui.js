// === UI 渲染 ===
// 由 glow.js 自动拆分生成


// === 渲染全部 ===


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
  const parts = dateStr.split('-');
  const d = new Date(+parts[0], +parts[1]-1, +parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d - today) / 86400000);
  const weekday = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
  const mm = d.getMonth() + 1, dd = d.getDate();
  const datePart = `${mm}月${dd}日 ${weekday}`;
  const labels = { 0: '今天', 1: '明天', 2: '后天' };
  const label = labels[diff] || `第${diff + 1}天`;
  return `📍 ${label} · ${datePart}`;
}

// === 渲染选项卡预测 ===


// === 摄影建议 ===


// === 构建预测卡片（莉景风格：概率 + 质量双指标 + 云层趋势图）===


function buildPredictionCard(label, type, score, prob, quality, confidence, data, tips, timeISO, dateLabel, chartSvg) {
  const typeCls = type === 'morning' ? 'morning' : 'evening';
  // 时间区间：日出/日落 ±30 分钟
  const t = new Date(timeISO);
  const startTime = new Date(t.getTime() - 30 * 60000);
  const endTime = new Date(t.getTime() + 30 * 60000);
  const fmt = (d) => d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const timeRange = `${fmt(startTime)} - ${fmt(endTime)}`;

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

  // v5: 使用统一辅助函数
  const aodInfo = _getAOD(type, data);
  const aodVal = aodInfo?.value ?? null;
  const spInfo = _getSunPathScore(type);
  const pTrend = state.pressureTrend?.[type];

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
    { name: '气溶胶AOD', val: aodVal != null ? aodVal.toFixed(2) : '--',
      cls: aodVal == null ? 'warn' : aodVal < 0.1 ? 'good' : aodVal > 0.3 ? 'bad' : 'warn' },
    { name: '光路通透', val: spInfo ? spInfo.score + '%' : '--',
      cls: !spInfo ? 'warn' : spInfo.blocking < 25 ? 'good' : spInfo.blocking > 55 ? 'bad' : 'warn' },
    { name: '气压趋势', val: pTrend ? (pTrend.trend === 'rising' ? '↑' : pTrend.trend === 'falling' ? '↓' : '→') : '--',
      cls: !pTrend ? 'warn' : pTrend.trend === 'rising' ? 'good' : pTrend.trend === 'falling' ? 'bad' : 'good' },
    { name: '风速', val: data.windSpeed != null ? Math.round(data.windSpeed) + 'km/h' : '--',
      cls: data.windSpeed == null ? 'warn' : data.windSpeed <= 15 ? 'good' : data.windSpeed > 35 ? 'bad' : 'warn' },
    { name: '气压', val: data.pressure != null ? Math.round(data.pressure) + 'hPa' : '--',
      cls: data.pressure == null ? 'warn' : data.pressure > 1013 ? 'good' : data.pressure < 1005 ? 'bad' : 'good' },
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
          <div style="font-size:0.6rem;color:var(--text-dim);margin-top:1px;">置信度 ${confidence}%</div>
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
        <button class="share-btn" onclick="openCloudMap('${type}')">${type === 'morning' ? '🌄 朝霞地图' : '🌇 晚霞地图'}</button>
      </div>
      <div class="data-source">🌐 ${getSourceLabel()}${state.aodData ? " · AOD" : ""}${state.sunPathData ? " · 光路" : ""}${confidence ? " · 置信度" + confidence + "%" : ""}</div>
    </div>
  </div>`;
}

// === 倒计时 ===


function formatDuration(ms) {
  if (ms <= 0) return '0秒';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}小时${String(m).padStart(2, '0')}分${String(s).padStart(2, '0')}秒`;
}

// === 演示模式 ===