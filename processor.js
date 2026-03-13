'use strict';

const { PORTS, inBox, normalizeDestination } = require('./ports-config');

const VESSEL_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// In-memory vessel state per port: mmsi → vessel object
const portVessels = {};
for (const p of PORTS) portVessels[p.name] = new Map();

// Static data cache: mmsi → { name, shipType, destination }
const staticCache = new Map();

// Hourly score history: portName → array[24], updated once per minute per hour bucket
const hourlyHistory = {};

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

function classifyStatus(navStatus, speed) {
  if (navStatus === 1) return 'anchored';
  if (navStatus === 5) return 'moored';
  if (navStatus === 0 || navStatus === 8) return 'underway';
  if (speed !== null && speed < 0.5) return 'moored';
  return 'unknown';
}

// ─── D&D rate (port-level, based on a blended 40ft container reference) ──────
function getDDRate(score, base = 800) {
  if (score < 25) return { rate: Math.round(base * 1.0),  mult: 1.0,  level: 'Low',      color: '#22c55e' };
  if (score < 50) return { rate: Math.round(base * 1.75), mult: 1.75, level: 'Moderate', color: '#eab308' };
  if (score < 75) return { rate: Math.round(base * 2.75), mult: 2.75, level: 'High',     color: '#f97316' };
  if (score < 90) return { rate: Math.round(base * 3.5),  mult: 3.5,  level: 'Severe',   color: '#ef4444' };
  return              { rate: Math.round(base * 4.5),  mult: 4.5,  level: 'Critical', color: '#991b1b' };
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

// ─── Congestion scoring ───────────────────────────────────────────────────────
// Only confirmed commercial vessels (type 70-89) drive the score.
// Saturation thresholds raised so score distributes meaningfully:
//   A (anchor weight 40): saturates at 60% of maxCap anchored
//   B (density weight 25): saturates at 150% of maxCap commercial in inner
//   C (slow % weight 20):  fraction of inner commercial vessels moving < 1.5kn
//   D (inbound weight 15): commercial vessels approaching in outer zone
function computeScore(vessels, maxCap) {
  const commercial = vessels.filter(v => isCommercial(v.shipType));
  const allAnchored = vessels.filter(v => v.navStatus === 1);

  // With no commercial vessels and nothing anchored, score is 0
  if (commercial.length === 0 && allAnchored.length === 0) return 0;

  const innerAll   = vessels.filter(v => v.zone === 'inner');
  const innerComm  = commercial.filter(v => v.zone === 'inner');
  const anchored   = allAnchored.length; // any anchored vessel is a congestion signal
  const slow       = innerAll.filter(v => v.speed !== null && v.speed < 1.5).length;
  const inbound    = commercial.filter(
    v => v.zone === 'outer' && (v.navStatus === 0 || v.navStatus === 8)
  ).length;

  const A = Math.min(1, anchored   / Math.max(1, maxCap * 0.60)) * 40;
  const B = Math.min(1, innerComm.length / Math.max(1, maxCap * 1.50)) * 25;
  const C = innerAll.length > 0 ? Math.min(1, slow / innerAll.length) * 20 : 0;
  const D = Math.min(1, inbound   / Math.max(1, maxCap)) * 15;

  return Math.min(100, Math.round(A + B + C + D));
}

// ─── 12-hour forecast with mean-reversion default ────────────────────────────
// When history exists → blend 60% history + 40% current.
// When no history → score decays 25% toward NEUTRAL_SCORE over 12 hours,
// avoiding the "flatline at current score" artifact of the previous implementation.
const NEUTRAL_SCORE = 38; // industry benchmark for a busy-but-normal port day

function forecast(portName, currentScore) {
  const history  = hourlyHistory[portName] ?? new Array(24).fill(null);
  const nowHour  = new Date().getUTCHours();

  return Array.from({ length: 12 }, (_, h) => {
    const fh = (nowHour + h + 1) % 24;
    let base;

    if (history[fh] !== null) {
      base = history[fh] * 0.6 + currentScore * 0.4;
    } else {
      // Mean reversion: weight toward neutral increases linearly over 12 hours
      const reversionWeight = (h + 1) / 12 * 0.28; // max 28% reversion at h=11
      base = currentScore * (1 - reversionWeight) + NEUTRAL_SCORE * reversionWeight;
    }

    const timeMult = (fh >= 6 && fh <= 20) ? 1.08 : 0.88;
    return Math.round(Math.min(100, Math.max(0, base * timeMult)));
  });
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
function buildPortStates() {
  evictStale();
  const now = new Date().toISOString();

  return PORTS.map(port => {
    const vessels    = Array.from(portVessels[port.name].values());
    const commercial = vessels.filter(v => isCommercial(v.shipType));

    const score = computeScore(vessels, port.max);
    const { rate, mult, level, color } = getDDRate(score);
    const fc             = forecast(port.name, score);
    const containerRates = computeContainerRates(mult);

    // Record hourly history (overwrite current hour bucket)
    if (!hourlyHistory[port.name]) hourlyHistory[port.name] = new Array(24).fill(null);
    hourlyHistory[port.name][new Date().getUTCHours()] = score;

    const anchored  = vessels.filter(v => v.navStatus === 1).length;
    const moored    = vessels.filter(v => v.navStatus === 5).length;
    const underway  = vessels.filter(v => v.navStatus === 0 || v.navStatus === 8).length;
    const inbound   = vessels.filter(
      v => v.zone === 'outer' && (v.navStatus === 0 || v.navStatus === 8)
    ).length;

    // Surface only commercial vessels in the detail list
    const vesselList = commercial
      .map(v => ({ ...v, statusLabel: classifyStatus(v.navStatus, v.speed) }))
      .sort((a, b) => {
        // Anchored first (most relevant for congestion), then moored, then underway
        const order = { anchored: 0, moored: 1, underway: 2, unknown: 3 };
        return (order[a.statusLabel] ?? 3) - (order[b.statusLabel] ?? 3);
      })
      .slice(0, 20);

    return {
      name: port.name, lat: port.lat, lon: port.lon,
      reliability: port.reliability,
      score, level, color,
      ddRate: rate, ddMultiplier: mult,
      anchored, moored, underway, inbound,
      totalVessels:      vessels.length,
      commercialVessels: commercial.length,
      vessels:           vesselList,
      containerRates,
      forecast: fc,
      lastUpdated: now,
    };
  });
}

module.exports = { processMessage, buildPortStates };
