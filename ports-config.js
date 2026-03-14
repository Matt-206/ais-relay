'use strict';

// 5 highest-value ports — concentrates sparse AISstream quota for better coverage
// Rotterdam, Singapore, LA, Hamburg, Antwerp = top EU + Asia + US gateways
// Aligned with platform lib/ports-config.ts maxCapacity
const PORTS = [
  {
    name: 'Rotterdam', lat: 51.95, lon: 4.25, max: 80, reliability: 'high',
    locode: ['NLRTM','ROTTERDAM','ROTTM','RTM','RTDM'],
    inner: { lat: [51.80, 52.10], lon: [3.90, 4.60] },
    outer: { lat: [51.60, 52.30], lon: [3.50, 5.20] },
  },
  {
    name: 'Singapore', lat: 1.27, lon: 103.82, max: 120, reliability: 'high',
    locode: ['SGSIN','SINGAPORE','SGP','SNGPORE'],
    inner: { lat: [1.15, 1.45], lon: [103.65, 104.10] },
    outer: { lat: [0.90, 1.70], lon: [103.45, 104.40] },
  },
  {
    name: 'Los Angeles', lat: 33.73, lon: -118.27, max: 70, reliability: 'high',
    locode: ['USLAX','LOS ANGELES','LOSANGELES','LA','LONG BEACH','USLGB'],
    inner: { lat: [33.50, 34.00], lon: [-118.80, -117.90] },
    outer: { lat: [33.20, 34.30], lon: [-119.20, -117.50] },
  },
  {
    name: 'Hamburg', lat: 53.55, lon: 9.97, max: 60, reliability: 'high',
    locode: ['DEHAM','HAMBURG','HAMBG','HH'],
    inner: { lat: [53.45, 53.60], lon: [9.75, 10.15] },
    outer: { lat: [53.20, 54.00], lon: [8.80, 11.00] },
  },
  {
    name: 'Antwerp', lat: 51.27, lon: 4.30, max: 65, reliability: 'high',
    locode: ['BEANR','ANTWERP','ANTWRP','ANR'],
    inner: { lat: [51.17, 51.37], lon: [4.22, 4.58] },
    outer: { lat: [50.80, 51.80], lon: [3.30, 5.30] },
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
