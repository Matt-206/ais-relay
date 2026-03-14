'use strict';

// 5 highest-value ports — inner = port/berth area, outer = approach/anchorage
// Zones tightened to avoid inflating counts with distant traffic (e.g. North Sea)
// Aligned with platform lib/ports-config.ts
// utcOffset: hours from UTC for port's local time (for time-of-day forecast multiplier)
const PORTS = [
  {
    name: 'Rotterdam', lat: 51.95, lon: 4.25, max: 80, reliability: 'high', utcOffset: 1,
    locode: ['NLRTM','ROTTERDAM','ROTTM','RTM','RTDM'],
    inner: { lat: [51.85, 52.02], lon: [4.10, 4.55] },
    outer: { lat: [51.75, 52.15], lon: [3.75, 4.85] },
  },
  {
    name: 'Singapore', lat: 1.27, lon: 103.82, max: 120, reliability: 'high', utcOffset: 8,
    locode: ['SGSIN','SINGAPORE','SGP','SNGPORE'],
    inner: { lat: [1.20, 1.38], lon: [103.72, 104.05] },
    outer: { lat: [1.05, 1.55], lon: [103.55, 104.25] },
  },
  {
    name: 'Los Angeles', lat: 33.73, lon: -118.27, max: 70, reliability: 'high', utcOffset: -8,
    locode: ['USLAX','LOS ANGELES','LOSANGELES','LA','LONG BEACH','USLGB'],
    inner: { lat: [33.65, 33.85], lon: [-118.45, -118.10] },
    outer: { lat: [33.45, 34.00], lon: [-118.75, -117.85] },
  },
  {
    name: 'Hamburg', lat: 53.55, lon: 9.97, max: 60, reliability: 'high', utcOffset: 1,
    locode: ['DEHAM','HAMBURG','HAMBG','HH'],
    inner: { lat: [53.48, 53.58], lon: [9.85, 10.08] },
    outer: { lat: [53.38, 53.72], lon: [9.50, 10.55] },
  },
  {
    name: 'Antwerp', lat: 51.27, lon: 4.30, max: 65, reliability: 'high', utcOffset: 1,
    locode: ['BEANR','ANTWERP','ANTWRP','ANR'],
    inner: { lat: [51.20, 51.35], lon: [4.25, 4.55] },
    outer: { lat: [51.05, 51.55], lon: [3.85, 4.95] },
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
