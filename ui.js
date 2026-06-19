
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



// === 恢复的缺失函数 ===

  function linearSlope(v) {
    const n = v.length;
    if (n < 2) return 0;
    let sX = 0, sY = 0, sXY = 0, sX2 = 0;
    for (let i = 0; i < n; i++) { sX += i; sY += v[i]; sXY += i * v[i]; sX2 += i * i; }
    return (n * sXY - sX * sY) / (n * sX2 - sX * sX);
  }

function selectNearbyPOI(lat, long, name) {
  selectLocation(lat, long, name, '');
  closeNearbyModal();
  // 在地图选择器上标记该点
  showNearbyPOIOnMap(lat, long, name);
}

function closeCloudMap() {
  document.getElementById('cloudMapModal').style.display = 'none';
  document.body.classList.remove('no-scroll');
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

function openMapPicker() {
  $mapModal.style.display = 'flex';
  $mapCoords.textContent = '定位中…';
  $mapConfirmBtn.textContent = '确定';
  $mapConfirmBtn.disabled = true;
  // 初始化地图搜索插件（AutoComplete + PlaceSearch）
  initMapSearch();
  setTimeout(initMapInstance, 150);
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

function _transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}

function toggleCloudMapType() {
  _cloudMapType = _cloudMapType === 'evening' ? 'morning' : 'evening';
  document.getElementById('cloudMapToggle').textContent =
    _cloudMapType === 'evening' ? '🌅 晚霞' : '🌄 朝霞';
  document.getElementById('cloudMapTitle').textContent =
    _cloudMapType === 'evening' ? '🌅 晚霞预测地图' : '🌄 朝霞预测地图';
  loadCloudMapData();
}

function closeMapPicker() {
  $mapModal.style.display = 'none';
  $mapSearchResults.classList.remove('show');
  $mapSearchInput.value = '';
  if (_mapMarker && _mapInstance) { _mapInstance.remove(_mapMarker); _mapMarker = null; }
  _mapLat = null; _mapLon = null;
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
    pressure: data.hourly.surface_pressure ? data.hourly.surface_pressure[idx] : null,
    windSpeed: data.hourly.wind_speed_10m ? data.hourly.wind_speed_10m[idx] : null,
    windDir: data.hourly.wind_direction_10m ? data.hourly.wind_direction_10m[idx] : null,
  };
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

function bearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

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

  function probColorFn(s) {
    if (s >= 75) return '#4caf50';
    if (s >= 50) return '#ffeb3b';
    if (s >= 30) return '#ff9800';
    return '#ff4444';
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

  function smooth(arr, w = 3) {
    if (arr.length < w) return arr;
    const r = [];
    for (let i = 0; i < arr.length; i++) {
      const s = Math.max(0, i - Math.floor(w / 2));
      const e = Math.min(arr.length, i + Math.ceil(w / 2));
      let sum = 0;
      for (let j = s; j < e; j++) sum += arr[j];
      r.push(sum / (e - s));
    }
    return r;
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

function updateMapCoordsLabel() {
  if (_mapLat != null) {
    $mapCoords.textContent = `已选: ${_mapLat.toFixed(4)}, ${_mapLon.toFixed(4)}`;
    $mapConfirmBtn.disabled = false;
  }
}

function formatDuration(ms) {
  if (ms <= 0) return '0秒';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}小时${String(m).padStart(2, '0')}分${String(s).padStart(2, '0')}秒`;
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