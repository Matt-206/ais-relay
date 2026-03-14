'use strict';

// 5 highest-value ports — inner = berths/terminals, outer = approach/anchorage
// Zones calibrated to published port boundaries and anchorage areas
// max from port-capacities.json; berthCapacity from berth-capacities.json (see scripts/BERTH_UTILIZATION_METHODOLOGY.md)
const capacities = require('./port-capacities.json');
const berthCap = require('./berth-capacities.json');

const PORTS = [
  {
    name: 'Rotterdam', lat: 51.92, lon: 4.25, max: capacities.Rotterdam ?? 80, berthCapacity: berthCap.Rotterdam ?? 145, reliability: 'high', utcOffset: 1,
    locode: ['NLRTM','ROTTERDAM','ROTTM','RTM','RTDM'],
    inner: { lat: [51.86, 51.98], lon: [3.95, 4.52] },
    outer: { lat: [51.78, 52.02], lon: [3.72, 4.72] },
  },
  {
    name: 'Singapore', lat: 1.27, lon: 103.82, max: capacities.Singapore ?? 120, berthCapacity: berthCap.Singapore ?? 56, reliability: 'high', utcOffset: 8,
    locode: ['SGSIN','SINGAPORE','SGP','SNGPORE'],
    inner: { lat: [1.22, 1.32], lon: [103.76, 104.02] },
    outer: { lat: [1.08, 1.42], lon: [103.62, 104.18] },
  },
  {
    name: 'Los Angeles', lat: 33.74, lon: -118.27, max: capacities['Los Angeles'] ?? 70, berthCapacity: berthCap['Los Angeles'] ?? 70, reliability: 'high', utcOffset: -8,
    locode: ['USLAX','LOS ANGELES','LOSANGELES','LA','LONG BEACH','USLGB'],
    inner: { lat: [33.71, 33.78], lon: [-118.32, -118.12] },
    outer: { lat: [33.62, 33.85], lon: [-118.45, -118.02] },
  },
  {
    name: 'Hamburg', lat: 53.54, lon: 9.97, max: capacities.Hamburg ?? 60, berthCapacity: berthCap.Hamburg ?? 25, reliability: 'high', utcOffset: 1,
    locode: ['DEHAM','HAMBURG','HAMBG','HH'],
    inner: { lat: [53.50, 53.58], lon: [9.88, 10.05] },
    outer: { lat: [53.42, 53.63], lon: [9.72, 10.22] },
  },
  {
    name: 'Antwerp', lat: 51.27, lon: 4.34, max: capacities.Antwerp ?? 65, berthCapacity: berthCap.Antwerp ?? 28, reliability: 'high', utcOffset: 1,
    locode: ['BEANR','ANTWERP','ANTWRP','ANR'],
    inner: { lat: [51.22, 51.32], lon: [4.28, 4.48] },
    outer: { lat: [51.12, 51.42], lon: [4.12, 4.62] },
  },
];

function inBox(lat, lon, zone) {
  return lat >= zone.lat[0] && lat <= zone.lat[1] && lon >= zone.lon[0] && lon <= zone.lon[1];
}

function normalizeDestination(raw) {
  if (!raw) return '';
  const cleaned = raw.replace(/[@#*\s]+$/, '').trim().toUpperCase();
  for (const port of PORTS) {
    for (const code of port.locode) {
      if (cleaned.includes(code)) return port.name;
    }
  }
  return cleaned;
}

module.exports = { PORTS, inBox, normalizeDestination };
