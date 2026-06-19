// state.js — 共享状态 + 常量
const AMAP_KEY = '9a559408bacf3862588c08ad3a273edc';
const AMAP_SEARCH_URL = 'https://restapi.amap.com/v3/place/text';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const state = {
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

const DOM = {};
