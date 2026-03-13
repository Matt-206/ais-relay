'use strict';

const { PORTS, inBox, normalizeDestination } = require('./ports-config');

const VESSEL_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// In-memory vessel state per port
const portVessels = {};
for (const p of PORTS) portVessels[p.name] = new Map();

// Static data cache: mmsi → { name, shipType, destination }
const staticCache = new Map();

// Hourly score history for forecasting: portName → array[24]
const hourlyHistory = {};

// ─── Nav status helpers ───────────────────────────────────────────────────────
function classifyStatus(navStatus, speed) {
  if (navStatus === 1) return 'anchored';
  if (navStatus === 5) return 'moored';
  if (navStatus === 0 || navStatus === 8) return 'underway';
  if (speed !== null && speed < 0.5) return 'moored';
  return 'unknown';
}

// ─── Congestion scoring ───────────────────────────────────────────────────────
function computeScore(vessels, maxCap) {
  if (!vessels.length) return 0;
  const inner   = vessels.filter(v => v.zone === 'inner');
  const anchored = vessels.filter(v => v.navStatus === 1).length;
  const slow     = inner.filter(v => v.speed !== null && v.speed < 2).length;
  const inbound  = vessels.filter(v => v.zone === 'outer' && (v.navStatus === 0 || v.navStatus === 8)).length;
  const commercial = inner.filter(v => !v.shipType || (v.shipType >= 70 && v.shipType <= 89)).length;

  const a = Math.min(1, anchored / Math.max(1, maxCap * 0.3)) * 40;
  const d = Math.min(1, commercial / maxCap) * 25;
  const l = inner.length > 0 ? (slow / inner.length) * 20 : 0;
  const i = Math.min(1, inbound / Math.max(1, maxCap * 0.5)) * 15;
  return Math.min(100, Math.round(a + d + l + i));
}

function getDDRate(score, base = 800) {
  if (score < 25) return { rate: base * 1.0,  mult: 1.0,  level: 'Low',      color: '#22c55e' };
  if (score < 50) return { rate: base * 1.75, mult: 1.75, level: 'Moderate', color: '#eab308' };
  if (score < 75) return { rate: base * 2.75, mult: 2.75, level: 'High',     color: '#f97316' };
  if (score < 90) return { rate: base * 3.5,  mult: 3.5,  level: 'Severe',   color: '#ef4444' };
  return              { rate: base * 4.5,  mult: 4.5,  level: 'Critical', color: '#991b1b' };
}

function forecast(portName, currentScore) {
  const history = hourlyHistory[portName] ?? new Array(24).fill(null);
  const nowHour = new Date().getUTCHours();
  return Array.from({ length: 12 }, (_, h) => {
    const fh = (nowHour + h + 1) % 24;
    const yest = history[fh] ?? currentScore;
    const blended = yest * 0.6 + currentScore * 0.4;
    const mult = (fh >= 6 && fh <= 20) ? 1.08 : 0.88;
    return Math.round(Math.min(100, Math.max(0, blended * mult)));
  });
}

// ─── Message processing ───────────────────────────────────────────────────────
function processMessage(raw) {
  let msg;
  try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return; }

  const { MessageType, MetaData, Message } = msg;
  if (!MessageType || !MetaData || !Message) return;

  const inner = Message[MessageType];
  if (!inner) return;

  const noiseTypes = new Set([
    'DataLinkManagementMessage','Interrogation','BinaryAcknowledge',
    'ChannelManagement','AssignedModeCommand','CoordinatedUTCInquiry',
    'GnssBroadcastBinaryMessage','UnknownMessage',
  ]);
  if (noiseTypes.has(MessageType)) return;

  if (MessageType === 'ShipStaticData' || MessageType === 'StaticDataReport') {
    const mmsi = MetaData.MMSI;
    const existing = staticCache.get(mmsi) ?? {};
    const rawName = (inner.Name ?? inner.ShipName ?? '').trim();
    const rawDest = (inner.Destination ?? '').trim();
    staticCache.set(mmsi, {
      name: rawName || existing.name,
      shipType: inner.Type ?? existing.shipType,
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

  const lat = inner.Latitude ?? MetaData.latitude;
  const lon = inner.Longitude ?? MetaData.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return;
  if (!isFinite(lat) || !isFinite(lon)) return;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;

  let speed = inner.Sog ?? null;
  if (speed !== null && speed > 102) speed = null;

  const navStatus = inner.NavigationalStatus ?? null;
  const heading = inner.TrueHeading === 511 ? (inner.Cog ?? null) : (inner.TrueHeading ?? null);

  const staticInfo = staticCache.get(mmsi);
  const name = (MetaData.ShipName ?? '').trim() || staticInfo?.name || `MMSI ${mmsi}`;

  const vessel = {
    mmsi, name, speed, heading, navStatus,
    shipType: staticInfo?.shipType ?? null,
    destination: staticInfo?.destination ?? null,
    lat, lon, zone: null, lastSeen: Date.now(),
  };

  for (const port of PORTS) {
    if (inBox(lat, lon, port.inner)) {
      vessel.zone = 'inner';
      portVessels[port.name].set(mmsi, vessel);
    } else if (inBox(lat, lon, port.outer)) {
      vessel.zone = 'outer';
      portVessels[port.name].set(mmsi, vessel);
    } else {
      portVessels[port.name].delete(mmsi);
    }
  }
}

// ─── Evict stale vessels ──────────────────────────────────────────────────────
function evictStale() {
  const cutoff = Date.now() - VESSEL_EXPIRY_MS;
  for (const portName of Object.keys(portVessels)) {
    for (const [mmsi, v] of portVessels[portName]) {
      if (v.lastSeen < cutoff) portVessels[portName].delete(mmsi);
    }
  }
}

// ─── Build port state objects ─────────────────────────────────────────────────
function buildPortStates() {
  evictStale();
  const now = new Date().toISOString();

  return PORTS.map(port => {
    const vessels = Array.from(portVessels[port.name].values());
    const score = computeScore(vessels, port.max);
    const { rate, mult, level, color } = getDDRate(score);
    const fc = forecast(port.name, score);

    // Record for history
    if (!hourlyHistory[port.name]) hourlyHistory[port.name] = new Array(24).fill(null);
    hourlyHistory[port.name][new Date().getUTCHours()] = score;

    const anchored = vessels.filter(v => v.navStatus === 1).length;
    const moored   = vessels.filter(v => v.navStatus === 5).length;
    const underway = vessels.filter(v => v.navStatus === 0 || v.navStatus === 8).length;
    const inbound  = vessels.filter(v => v.zone === 'outer' && (v.navStatus === 0 || v.navStatus === 8)).length;

    return {
      name: port.name, lat: port.lat, lon: port.lon,
      score, level, color,
      ddRate: Math.round(rate), ddMultiplier: mult,
      anchored, moored, underway, inbound,
      totalVessels: vessels.length,
      vessels: vessels
        .map(v => ({ ...v, statusLabel: classifyStatus(v.navStatus, v.speed) }))
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, 20),
      forecast: fc,
      lastUpdated: now,
    };
  });
}

module.exports = { processMessage, buildPortStates };
