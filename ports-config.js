'use strict';

// 5 highest-value ports — concentrates sparse AISstream quota for better coverage
// Rotterdam, Singapore, LA, Hamburg, Antwerp = top EU + Asia + US gateways
const PORTS = [
  {
    name: 'Rotterdam', lat: 51.92, lon: 4.22, max: 120, reliability: 'high',
    locode: ['NLRTM','ROTTERDAM','ROTTM','RTM','RTDM'],
    inner: { lat: [51.87, 52.02], lon: [3.98, 4.55] },
    outer: { lat: [51.70, 52.20], lon: [3.50, 5.00] },
  },
  {
    name: 'Singapore', lat: 1.27, lon: 103.85, max: 180, reliability: 'high',
    locode: ['SGSIN','SINGAPORE','SGP'],
    inner: { lat: [1.15, 1.45], lon: [103.65, 104.10] },
    outer: { lat: [0.90, 1.70], lon: [103.45, 104.40] },
  },
  {
    name: 'Los Angeles', lat: 33.73, lon: -118.25, max: 100, reliability: 'high',
    locode: ['USLAX','LOS ANGELES','LA','LONG BEACH'],
    inner: { lat: [33.50, 34.00], lon: [-118.80, -117.90] },
    outer: { lat: [33.20, 34.30], lon: [-119.20, -117.50] },
  },
  {
    name: 'Hamburg', lat: 53.52, lon: 9.97, max: 70, reliability: 'high',
    locode: ['DEHAM','HAMBURG'],
    inner: { lat: [53.45, 53.60], lon: [9.75, 10.15] },
    outer: { lat: [53.30, 53.80], lon: [9.20, 10.80] },
  },
  {
    name: 'Antwerp', lat: 51.25, lon: 4.38, max: 100, reliability: 'high',
    locode: ['BEANR','ANTWERP','ANR'],
    inner: { lat: [51.17, 51.37], lon: [4.22, 4.58] },
    outer: { lat: [51.00, 51.60], lon: [3.80, 4.90] },
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
