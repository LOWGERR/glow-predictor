// state.js — 共享状态 + 常量
var AMAP_KEY = '9a559408bacf3862588c08ad3a273edc';
var AMAP_SEARCH_URL = 'https://restapi.amap.com/v3/place/text';
var GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
var FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
var AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

var state = {
  lat: null, lon: null, name: '', country: '',
  forecastData: null,
  activeTab: 0,
  countdownTimer: null,
  ensembleData: null,
  modelSources: [],
  aodData: null,
  sunPathData: null,
  pressureTrend: null,
  lastScores: null,
};

var DOM = {};
