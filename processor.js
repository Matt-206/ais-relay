'use strict';

const fs = require('fs');
const path = require('path');
const { PORTS, inBox, normalizeDestination } = require('./ports-config');

const VESSEL_EXPIRY_MS = 5 * 60 * 60 * 1000; // 5 hours — lets vessel counts accumulate between sparse AISstream bursts

// In-memory vessel state per port: mmsi → vessel object
const portVessels = {};
for (const p of PORTS) portVessels[p.name] = new Map();

// Static data cache: mmsi → { name, shipType, destination }
const staticCache = new Map();

// ─── Persistent hourly history (survives relay restarts) ─────────────────────
// Format: { portName: { "YYYY-MM-DD": [24 scores] } } — keep last 7 days
const HISTORY_FILE = path.join(process.cwd(), '.ais-hourly-history.json');
const HISTORY_DAYS = 7;

function dateKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadHourlyHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    const data = JSON.parse(raw);
    const result = {};
    const today = dateKey(new Date());
    for (const portName of Object.keys(data)) {
      const v = data[portName];
      if (Array.isArray(v)) {
        // Migrate old format: single array → yesterday's data
        const yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        result[portName] = { [dateKey(yesterday)]: v };
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        result[portName] = v;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function pruneHistory(history) {
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - HISTORY_DAYS);
  const cutoffKey = dateKey(cutoff);
  for (const portName of Object.keys(history)) {
    const days = history[portName];
    if (days && typeof days === 'object') {
      for (const key of Object.keys(days)) {
        if (key < cutoffKey) delete days[key];
      }
    }
  }
}

function saveHourlyHistory(history) {
  pruneHistory(history);
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history), 'utf8');
  } catch (err) {
    console.warn('[Processor] Could not persist hourly history:', err.message);
  }
}

// ─── Container type definitions with real-market base rates (per container/day, USD)
// Source: industry benchmarks 2025-2026 for major North European / Asia ports
const CONTAINER_TYPES = [
  { id: '20dc', label: '20ft Dry Standard',  abbr: "20'DC", teu: 1.0, baseDay: 95  },
  { id: '40dc', label: '40ft Dry Standard',  abbr: "40'DC", teu: 2.0, baseDay: 175 },
  { id: '40hc', label: '40ft High Cube',     abbr: "40'HC", teu: 2.0, baseDay: 185 },
  { id: '45hc', label: '45ft High Cube',     abbr: "45'HC", teu: 2.5, baseDay: 222 },
  { id: '20rf', label: '20ft Reefer',        abbr: "20'RF", teu: 1.0, baseDay: 230 },
  { id: '40rf', label: '40ft Reefer',        abbr: "40'RF", teu: 2.0, baseDay: 345 },
  { id: '20ot', label: '20ft Open Top',      abbr: "20'OT", teu: 1.0, baseDay: 178 },
  { id: '40ot', label: '40ft Open Top',      abbr: "40'OT", teu: 2.0, baseDay: 288 },
  { id: '20fr', label: '20ft Flat Rack',     abbr: "20'FR", teu: 1.0, baseDay: 198 },
  { id: '40fr', label: '40ft Flat Rack',     abbr: "40'FR", teu: 2.0, baseDay: 315 },
  { id: 'tank', label: 'ISO Tank Container', abbr: 'TANK',  teu: 1.0, baseDay: 295 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isCommercial(shipType) {
  return typeof shipType === 'number' && shipType >= 70 && shipType <= 89;
}

// Zone-aware: outer zone + stopped = anchored (waiting); inner zone + stopped = moored (at berth).
// Many Class B reports omit NavigationalStatus — defaulting all low-speed to "moored" inflated counts.
function classifyStatus(navStatus, speed, zone) {
  if (navStatus === 1) return 'anchored';
  if (navStatus === 5) return 'moored';
  if (navStatus === 0 || navStatus === 8) return 'underway';
  if (speed !== null && speed < 0.5) {
    if (zone === 'inner') return 'moored';
    if (zone === 'outer') return 'anchored';
  }
  return 'unknown';
}

// ─── Smooth piecewise-linear multiplier curve ─────────────────────────────────
// Replaces the 5-step ladder with interpolation between calibrated anchor points.
// Anchors calibrated to: DP World incentive programmes (0.60×), FMC congestion
// surcharge filings (1.35× at score 50), Drewry peak-backlog data (2.0× at 75),
// 2021 supply chain crisis documented peaks (3.5× at 100).
const MULT_CURVE = [
  [0,   0.60],
  [15,  0.75],
  [25,  1.00],
  [50,  1.35],
  [75,  2.00],
  [88,  2.75],
  [100, 3.50],
];

function smoothMultiplier(score) {
  const s = Math.max(0, Math.min(100, score));
  for (let i = 1; i < MULT_CURVE.length; i++) {
    const [s0, m0] = MULT_CURVE[i - 1];
    const [s1, m1] = MULT_CURVE[i];
    if (s <= s1) {
      const t = (s - s0) / (s1 - s0);
      return m0 + t * (m1 - m0);
    }
  }
  return 3.50;
}

function getLevelFromScore(score) {
  if (score < 25) return { level: 'Low',      color: '#22c55e' };
  if (score < 50) return { level: 'Moderate', color: '#eab308' };
  if (score < 75) return { level: 'High',     color: '#f97316' };
  if (score < 90) return { level: 'Severe',   color: '#ef4444' };
  return               { level: 'Critical', color: '#991b1b' };
}

function getDDRate(score, base = 800) {
  const mult = smoothMultiplier(score);
  const { level, color } = getLevelFromScore(score);
  const bonusFreeDays = score < 10 ? 5 : score < 25 ? 2 : 0;
  return {
    rate: Math.round(base * mult),
    mult: Math.round(mult * 1000) / 1000,
    bonusFreeDays,
    level,
    color,
  };
}

// ─── Per-container-type D&D rates ────────────────────────────────────────────
function computeContainerRates(mult) {
  return CONTAINER_TYPES.map(ct => {
    const daily   = Math.round(ct.baseDay * mult);
    const weekly  = daily * 7;
    const monthly = daily * 30;
    const uplift  = Math.round((mult - 1) * 100);
    return {
      id:       ct.id,
      label:    ct.label,
      abbr:     ct.abbr,
      teu:      ct.teu,
      baseDay:  ct.baseDay,
      daily,
      weekly,
      monthly,
      upliftPct: uplift,
    };
  });
}

// ─── Congestion scoring (aligned with platform lib/congestion.ts) ─────────────
// Anchored 40%, density 25%, low-speed 20%, inbound 15%.
// Uses classifyStatus for anchored/moored/underway so speed infers when navStatus missing.
function computeScore(vessels, maxCap) {
  const commercial = vessels.filter(v => isCommercial(v.shipType));
  const innerComm  = commercial.filter(v => v.zone === 'inner');
  const outerComm  = commercial.filter(v => v.zone === 'outer');

  const anchoredCount = commercial.filter(v => classifyStatus(v.navStatus, v.speed, v.zone) === 'anchored').length;
  const mooredCount   = innerComm.filter(v => classifyStatus(v.navStatus, v.speed, v.zone) === 'moored').length;
  const underwayInner = innerComm.filter(v => classifyStatus(v.navStatus, v.speed, v.zone) === 'underway').length;

  if (vessels.length === 0) return 0;
  if (commercial.length === 0 && anchoredCount === 0) return 0;

  const maxAnchored = Math.max(1, maxCap * 0.3);
  const anchoredScore = Math.min(1, anchoredCount / maxAnchored) * 40;
  const densityScore = Math.min(1, innerComm.length / maxCap) * 25;
  const slowVessels = innerComm.filter(v => v.speed !== null && v.speed < 2).length;
  const lowSpeedRatio = innerComm.length > 0 ? slowVessels / innerComm.length : 0;
  const lowSpeedScore = lowSpeedRatio * 20;
  const inboundCount = outerComm.filter(v => classifyStatus(v.navStatus, v.speed, v.zone) === 'underway').length;
  const inboundPressure = Math.min(1, inboundCount / Math.max(1, maxCap * 0.5)) * 15;

  return Math.min(100, Math.round(anchoredScore + densityScore + lowSpeedScore + inboundPressure));
}

// ─── 12-hour forecast: multi-day history + trend + port-specific time-of-day ─
const NEUTRAL_SCORE = 38; // industry benchmark for a busy-but-normal port day

function getSameHourAverage(historyByDate, targetHour) {
  const scores = [];
  for (const day of Object.values(historyByDate)) {
    if (Array.isArray(day) && day[targetHour] != null) scores.push(day[targetHour]);
  }
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function getTrend(currentScore, todayHours, nowHour) {
  const prev = todayHours[nowHour - 1];
  const prev2 = todayHours[nowHour - 2];
  if (prev == null) return 0;
  const recent = prev2 != null ? (prev + prev2) / 2 : prev;
  const delta = currentScore - recent;
  return Math.max(-5, Math.min(5, delta * 0.15)); // modest nudge ±5
}

function forecast(portName, currentScore, hourlyHistory, utcOffset = 0) {
  const historyByDate = hourlyHistory[portName];
  const today = dateKey(new Date());
  const todayHours = (historyByDate && historyByDate[today]) ? historyByDate[today] : new Array(24).fill(null);
  const nowHour = new Date().getUTCHours();

  todayHours[nowHour] = currentScore;
  const trend = getTrend(currentScore, todayHours, nowHour);

  return Array.from({ length: 12 }, (_, h) => {
    const fh = (nowHour + h + 1) % 24;
    const sameHourAvg = historyByDate ? getSameHourAverage(historyByDate, fh) : null;
    let base;

    if (sameHourAvg != null) {
      base = sameHourAvg * 0.6 + currentScore * 0.4;
      base += trend * (1 - (h + 1) / 13); // trend fades over horizon
    } else {
      const reversionWeight = (h + 1) / 12 * 0.28;
      base = currentScore * (1 - reversionWeight) + NEUTRAL_SCORE * reversionWeight;
    }

    const localHour = (fh + utcOffset + 24) % 24;
    const timeMult = (localHour >= 6 && localHour <= 20) ? 1.08 : 0.88;
    return Math.round(Math.min(100, Math.max(0, base * timeMult)));
  });
}

// ─── Confidence score from vessel coverage ───────────────────────────────────
// high:   commercial >= 5 and total >= 3 — reliable congestion signal
// medium: commercial >= 2 or total >= 2 — usable but sparse
// low:    else — limited AIS coverage, interpret with caution
function getConfidence(totalVessels, commercialVessels, messageCount) {
  if (commercialVessels >= 5 && totalVessels >= 3) return 'high';
  if (commercialVessels >= 2 || totalVessels >= 2) return 'medium';
  if (messageCount < 500) return 'low'; // stream just started
  return 'low';
}

// ─── AIS message processing ───────────────────────────────────────────────────
function processMessage(raw) {
  let msg;
  try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return; }

  const { MessageType, MetaData, Message } = msg;
  if (!MessageType || !MetaData || !Message) return;

  const inner = Message[MessageType];
  if (!inner) return;

  // Discard protocol/nav-aid noise
  const noiseTypes = new Set([
    'DataLinkManagementMessage','Interrogation','BinaryAcknowledge',
    'ChannelManagement','AssignedModeCommand','CoordinatedUTCInquiry',
    'GnssBroadcastBinaryMessage','UnknownMessage','AidsToNavigationReport',
    'BaseStationReport',
  ]);
  if (noiseTypes.has(MessageType)) return;

  // Cache static vessel data
  if (MessageType === 'ShipStaticData' || MessageType === 'StaticDataReport') {
    const mmsi    = MetaData.MMSI;
    const existing = staticCache.get(mmsi) ?? {};
    const rawName  = (inner.Name ?? inner.ShipName ?? '').trim();
    const rawDest  = (inner.Destination ?? '').trim();
    staticCache.set(mmsi, {
      name:       rawName || existing.name,
      shipType:   inner.Type ?? existing.shipType,
      destination: rawDest ? normalizeDestination(rawDest) : existing.destination,
    });
    return;
  }

  const posTypes = new Set([
    'PositionReport','StandardClassBPositionReport',
    'ExtendedClassBPositionReport','LongRangeAisBroadcastMessage',
  ]);
  if (!posTypes.has(MessageType)) return;

  const mmsi = MetaData.MMSI || inner.UserID;
  if (!mmsi) return;

  const lat = inner.Latitude   ?? MetaData.latitude;
  const lon = inner.Longitude  ?? MetaData.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return;
  if (!isFinite(lat) || !isFinite(lon)) return;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;

  let speed = inner.Sog ?? null;
  if (speed !== null && speed > 102) speed = null;

  const navStatus  = inner.NavigationalStatus ?? null;
  const heading    = inner.TrueHeading === 511 ? (inner.Cog ?? null) : (inner.TrueHeading ?? null);

  const staticInfo = staticCache.get(mmsi);
  const name       = (MetaData.ShipName ?? '').trim() || staticInfo?.name || `MMSI ${mmsi}`;

  const vessel = {
    mmsi, name, speed, heading, navStatus,
    shipType:    staticInfo?.shipType    ?? null,
    destination: staticInfo?.destination ?? null,
    lat, lon, zone: null, lastSeen: Date.now(),
  };

  // Assign vessel to every port whose zone contains this position
  for (const port of PORTS) {
    if (inBox(lat, lon, port.inner)) {
      vessel.zone = 'inner';
      portVessels[port.name].set(mmsi, { ...vessel });
    } else if (inBox(lat, lon, port.outer)) {
      vessel.zone = 'outer';
      portVessels[port.name].set(mmsi, { ...vessel });
    } else {
      portVessels[port.name].delete(mmsi);
    }
  }
}

// ─── Evict stale vessel records ───────────────────────────────────────────────
function evictStale() {
  const cutoff = Date.now() - VESSEL_EXPIRY_MS;
  for (const portName of Object.keys(portVessels)) {
    for (const [mmsi, v] of portVessels[portName]) {
      if (v.lastSeen < cutoff) portVessels[portName].delete(mmsi);
    }
  }
}

// ─── Build full port state objects ───────────────────────────────────────────
function buildPortStates(messageCount = 0) {
  evictStale();
  const now = new Date().toISOString();

  // Load persisted history, merge with in-memory
  const persisted = loadHourlyHistory();
  const hourlyHistory = { ...persisted };

  const result = PORTS.map(port => {
    const vessels    = Array.from(portVessels[port.name].values());
    const commercial = vessels.filter(v => isCommercial(v.shipType));

    const score = computeScore(vessels, port.max);
    const { rate, mult, level, color } = getDDRate(score);

    // Record hourly history (multi-day format)
    const today = dateKey(new Date());
    if (!hourlyHistory[port.name]) hourlyHistory[port.name] = {};
    if (!hourlyHistory[port.name][today]) hourlyHistory[port.name][today] = new Array(24).fill(null);
    hourlyHistory[port.name][today][new Date().getUTCHours()] = score;

    const utcOffset = port.utcOffset ?? 0;
    const fc = forecast(port.name, score, hourlyHistory, utcOffset);
    const containerRates = computeContainerRates(mult);

    // Metrics from commercial vessels only — matches vessel list and congestion score
    const anchored = commercial.filter(v => classifyStatus(v.navStatus, v.speed, v.zone) === 'anchored').length;
    const moored  = commercial.filter(v => classifyStatus(v.navStatus, v.speed, v.zone) === 'moored').length;
    const underway = commercial.filter(v => classifyStatus(v.navStatus, v.speed, v.zone) === 'underway').length;
    const inbound  = commercial.filter(
      v => v.zone === 'outer' && classifyStatus(v.navStatus, v.speed, v.zone) === 'underway'
    ).length;
    const other = commercial.length - anchored - moored - underway;

    const totalVessels = vessels.length;
    const commercialVessels = commercial.length;
    const confidence = getConfidence(totalVessels, commercialVessels, messageCount);

    // Berth utilization (industry-standard BOR): moored / berthCapacity × 100
    const berthCap = port.berthCapacity ?? port.max;
    const berthUtilization = berthCap > 0 ? Math.min(100, Math.round((moored / berthCap) * 100)) : 0;

    const vesselList = commercial
      .map(v => ({ ...v, statusLabel: classifyStatus(v.navStatus, v.speed, v.zone) }))
      .sort((a, b) => {
        const order = { anchored: 0, moored: 1, underway: 2, unknown: 3 };
        return (order[a.statusLabel] ?? 3) - (order[b.statusLabel] ?? 3);
      });

    return {
      name: port.name, lat: port.lat, lon: port.lon,
      reliability: port.reliability,
      score, level, color,
      berthUtilization,
      berthCapacity: berthCap,
      ddRate: rate, ddMultiplier: mult,
      anchored, moored, underway, inbound, other,
      totalVessels,
      commercialVessels,
      vessels: vesselList,
      containerRates,
      forecast: fc,
      lastUpdated: now,
      dataQuality: {
        totalVessels,
        commercialVessels,
        messageCount,
        anchored,
        moored,
        underway,
        inbound,
      },
      confidence,
    };
  });

  saveHourlyHistory(hourlyHistory);
  return result;
}

module.exports = { processMessage, buildPortStates };
