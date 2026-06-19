
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

