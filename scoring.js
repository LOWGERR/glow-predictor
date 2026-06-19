import { state } from './state.js';

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

function _calcCloudBaseHeight(temp, dewPoint) {
  if (temp == null || dewPoint == null) return null;
  const spread = temp - dewPoint;
  if (spread < 0) return 0; // 饱和状态，云底≈地面
  return Math.round(spread * 125);
}

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

function _calcVisibilityScore(visibility) {
  const visKm = visibility / 1000;
  if (visKm >= 20) return { score: 25, label: '极致通透', visKm };
  if (visKm >= 12) return { score: 18, label: '通透', visKm };
  if (visKm >= 8)  return { score: 12, label: '良好', visKm };
  if (visKm >= 5)  return { score: 5, label: '轻微浑浊', visKm };
  if (visKm >= 3)  return { score: -2, label: '浑浊', visKm };
  return { score: -10, label: '严重雾霾', visKm };
}

function _calcHumidityScore(humidity) {
  if (humidity >= 40 && humidity <= 60) return 15;
  if (humidity >= 30 && humidity < 40) return 8;
  if (humidity > 60 && humidity <= 75) return 4;
  if (humidity > 75 && humidity <= 85) return -4;
  if (humidity > 85) return -12;
  return -8; // <30%
}

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

function calcQuality(d, type) {
  // v5: 质量只回答"好不好看"——AOD、云型美观度、色彩饱和度
  let quality = 50;
  const cloudMid = d.cloudMid, cloudHigh = d.cloudHigh, cloudLow = d.cloudLow;
  const cloudMH = Math.max(cloudMid, cloudHigh);
  const h = d.humidity;
  const v = d.visibility;

  // 1. AOD 通透度：色彩饱和度的 #1 预测因子 (Henriksson 2019)
  const aod = _getAOD(type, d);
  if (aod) {
    const aodVal = aod.value;
    if (aod.source === 'real') {
      if (aodVal < 0.05) quality += 18;
      else if (aodVal < 0.1) quality += 12;
      else if (aodVal < 0.2) quality += 5;
      else if (aodVal < 0.4) quality -= 5;
      else if (aodVal < 0.6) quality -= 12;
      else quality -= 18;
    } else {
      if (aodVal < 0.08) quality += 10;
      else if (aodVal < 0.15) quality += 6;
      else if (aodVal < 0.3) quality += 2;
      else if (aodVal < 0.5) quality -= 4;
      else quality -= 10;
    }
  }

  // 2. 云型美观度：高云 >> 低云
  const highIsDominant = cloudHigh >= 30 && cloudLow < 40;
  const multiLayer = cloudHigh > 15 && cloudLow > 10;
  const overcast = d.cloudCover > 80;
  if (highIsDominant && !overcast) {
    quality += 15;
    if (cloudHigh > 40) quality += 5;
  } else if (cloudMH >= 18 && cloudMH <= 58) {
    quality += 8;
  } else if (cloudMH < 8) {
    quality -= 15;
  } else if (cloudMH > 80) {
    quality -= 12;
  }
  if (multiLayer && !overcast) quality += 6;

  // 3. 湿度：影响散射效果
  if (h >= 40 && h <= 60) quality += 8;
  else if (h >= 30 && h < 40) quality += 4;
  else if (h > 60 && h <= 75) quality += 2;
  else if (h > 85) quality -= 10;
  else if (h < 25) quality -= 5;

  // 4. 低云：影响地平线视野
  if (cloudLow > 70) quality -= 15;
  else if (cloudLow > 50) quality -= 8;

  else if (cloudLow > 30) quality -= 3;
  else if (cloudLow < 8 && cloudMH >= 15) quality += 4;

  // 5. 联合修正
  if (h > 70 && v < 4000) quality -= 10;
  if (h > 82 && v < 6000) quality -= 7;
  if (h >= 25 && h <= 55 && v > 10000 && cloudMH >= 15 && cloudMH <= 55) quality += 5;

  // 6. 季节修正
  if (state.lat != null) {
    const month = new Date().getMonth() + 1;
    quality += _calcSolarElevationCorrection(state.lat, month, type) * 0.3;
  }

  // 7. 风速（微风=大气稳定=散射均匀=色彩好）
  if (d.windSpeed != null) {
    if (d.windSpeed >= 3 && d.windSpeed <= 12) quality += 4;
    else if (d.windSpeed > 12 && d.windSpeed <= 25) quality += 0;
    else if (d.windSpeed > 25 && d.windSpeed <= 40) quality -= 4;
    else if (d.windSpeed > 40) quality -= 8;
  }

  // 8. 气压绝对值（高气压=空气洁净=通透度高）
  if (d.pressure != null) {
    if (d.pressure > 1020) quality += 3;
    else if (d.pressure > 1013) quality += 1;
    else if (d.pressure < 1005) quality -= 3;
  }

  return Math.max(0, Math.min(100, Math.round(quality)));
}

function calcScore(d, type, trendData) {
  const prob = calcProbability(d, type, trendData);
  const quality = calcQuality(d, type);
  const confidence = calcConfidence(d, type);

  // v5: 概率优先的分段加权
  let baseScore;
  if (prob < 15) {
    baseScore = prob * 0.8 + quality * 0.2;
  } else if (prob < 35) {
    baseScore = prob * 0.65 + quality * 0.35;
  } else if (prob < 65) {
    baseScore = prob * 0.50 + quality * 0.50;
  } else {
    baseScore = prob * 0.40 + quality * 0.60;
  }

  // 趋势修正
  let trendBonus = 0;
  if (trendData && trendData.cloudTrend != null) {
    if (type === 'morning') {
      if (trendData.preEventTrend < -2 && trendData.preEventTrend > -12) trendBonus += 4;
      if (trendData.lowCloudTrend < -4 && d.cloudLow < 35) trendBonus += 3;
    } else {
      if (Math.abs(trendData.preEventTrend) < 4) trendBonus += 3;
      else if (trendData.preEventTrend > 0 && trendData.preEventTrend <= 6) trendBonus += 2;
      if (trendData.highTrend > 1 && trendData.highTrend < 10) trendBonus += 3;
    }
  }
  baseScore = baseScore * 0.85 + Math.min(trendBonus, 15) * (100 / 15) * 0.15;

  // 置信度修正：数据不足时降低分数
  const confFactor = 0.7 + (confidence / 100) * 0.3;
  baseScore *= confFactor;

  const finalScore = Math.max(0, Math.min(100, Math.round(baseScore)));
  return { score: finalScore, prob, quality, confidence };
}

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

function scoreColor(s) {
  if (s >= 85) return '#ff1744';
  if (s >= 70) return '#e040fb';
  if (s >= 55) return '#4caf50';
  if (s >= 35) return '#ffeb3b';
  if (s >= 15) return '#ff9800';
  return '#888';
}

function scoreLabel(s) {
  if (s >= 85) return '大烧';
  if (s >= 70) return '优质';
  if (s >= 55) return '好烧';
  if (s >= 35) return '小烧';
  if (s >= 15) return '微烧';
  return '无烧';
}

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

export {
  _calcSolarAzimuth,
  _calcCloudBaseHeight,
  _calcCloudContinuity,
  _calcSolarElevationCorrection,
  _calcCloudTypeScore,
  _calcVisibilityScore,
  _calcHumidityScore,
  calcProbability,
  calcQuality,
  calcScore,
  calcConfidence,
  _getAOD,
  _getSunPathScore,
  getTrendData,
  buildCloudTrendChart,
  scoreColor,
  scoreLabel,
  findHourlyIndex,
  extractSunPathClouds,
  getPressureTrend
};
