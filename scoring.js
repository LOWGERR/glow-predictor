// === 评分引擎 ===
// 由 glow.js 自动拆分生成


// 从光路采样数据中提取目标时刻的云层数据


// ════════════════════════════════════════════════════════════


// 获取太阳光路采样的 Promise 数组


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


// === 云底高度估算（基于温度-露点差） ===


// === 中高层云连续性评分 ===


// === 太阳高度角季节性修正 ===





// === 云层趋势分析（扩展窗口 + 滑动平均） ===


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


  function linearSlope(v) {
    const n = v.length;
    if (n < 2) return 0;
    let sX = 0, sY = 0, sXY = 0, sX2 = 0;
    for (let i = 0; i < n; i++) { sX += i; sY += v[i]; sXY += i * v[i]; sX2 += i * i; }
    return (n * sXY - sX * sY) / (n * sX2 - sX * sX);
  }


// v35 评分引擎重构：公共辅助函数


// 获取太阳光路阻挡评分


// 计算数据置信度 (0-100)


// ════════════════════════════════════════════════════════════


// === 能见度独立评分（权重 ~25%） ===


// === 湿度评分（权重 ~15%） ===


// === 评分算法 v4（r-ayin 融合版）===


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