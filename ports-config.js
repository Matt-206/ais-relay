'use strict';

// reliability: 'high' = dense AIS coverage, tight box
//              'medium' = coverage exists but zone may include adjacent traffic
//              'low' = sparse satellite coverage or zero vessels observed
const PORTS = [
  {
    name: 'Rotterdam', lat: 51.92, lon: 4.22, max: 120, reliability: 'high',
    locode: ['NLRTM','ROTTERDAM','ROTTM','RTM','RTDM'],
    // Tightened: Maasvlakte + Europoort + New Waterway only, cuts Rhine delta barges
    inner: { lat: [51.87, 52.02], lon: [3.98, 4.55] },
    outer: { lat: [51.70, 52.20], lon: [3.50, 5.00] },
  },
  {
    name: 'Singapore', lat: 1.27, lon: 103.85, max: 180, reliability: 'high',
    locode: ['SGSIN','SINGAPORE','SGP'],
    // Eastern anchorage + Jurong Island + Pasir Panjang — lon starts at 103.65 (no Tanjung Pelepas overlap)
    inner: { lat: [1.15, 1.45], lon: [103.65, 104.10] },
    outer: { lat: [0.90, 1.70], lon: [103.45, 104.40] },
  },
  {
    name: 'Shanghai', lat: 30.80, lon: 121.90, max: 150, reliability: 'medium',
    locode: ['CNSHA','SHANGHAI'],
    // Extended south to include Yangshan Deep Water Port (lat ~30.62)
    inner: { lat: [30.60, 31.50], lon: [121.25, 122.40] },
    outer: { lat: [30.30, 32.00], lon: [120.80, 122.80] },
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
    // Tightened to Hamburg port basin area, reduces Elbe river upstream traffic
    inner: { lat: [53.45, 53.60], lon: [9.75, 10.15] },
    outer: { lat: [53.30, 53.80], lon: [9.20, 10.80] },
  },
  {
    name: 'Antwerp', lat: 51.25, lon: 4.38, max: 100, reliability: 'high',
    locode: ['BEANR','ANTWERP','ANR'],
    // Tightened: port of Antwerp berths/docks only, cuts Scheldt estuary traffic
    inner: { lat: [51.17, 51.37], lon: [4.22, 4.58] },
    outer: { lat: [51.00, 51.60], lon: [3.80, 4.90] },
  },
  {
    name: 'Jebel Ali', lat: 25.00, lon: 55.05, max: 80, reliability: 'high',
    locode: ['AEJEA','JEBEL ALI','DUBAI'],
    inner: { lat: [24.75, 25.20], lon: [54.85, 55.45] },
    outer: { lat: [24.40, 25.60], lon: [54.40, 56.00] },
  },
  {
    name: 'Busan', lat: 35.10, lon: 129.05, max: 120, reliability: 'medium',
    locode: ['KRPUS','BUSAN'],
    inner: { lat: [34.90, 35.35], lon: [128.75, 129.30] },
    outer: { lat: [34.65, 35.65], lon: [128.35, 129.75] },
  },
  {
    name: 'New York', lat: 40.67, lon: -74.03, max: 75, reliability: 'high',
    locode: ['USNYC','NEW YORK','NY','NEWARK'],
    inner: { lat: [40.42, 40.92], lon: [-74.30, -73.80] },
    outer: { lat: [40.15, 41.15], lon: [-74.75, -73.35] },
  },
  {
    name: 'Hong Kong', lat: 22.30, lon: 114.18, max: 120, reliability: 'medium',
    locode: ['HKHKG','HONG KONG','HK'],
    // Separated from Guangzhou: lon starts at 113.95, lat max 22.48
    inner: { lat: [22.15, 22.48], lon: [113.95, 114.40] },
    outer: { lat: [21.90, 22.75], lon: [113.65, 114.75] },
  },
  {
    name: 'Felixstowe', lat: 51.95, lon: 1.35, max: 25, reliability: 'high',
    locode: ['GBFXT','FELIXSTOWE'],
    inner: { lat: [51.87, 52.03], lon: [1.22, 1.58] },
    outer: { lat: [51.65, 52.20], lon: [0.85, 1.95] },
  },
  {
    name: 'Le Havre', lat: 49.50, lon: 0.10, max: 80, reliability: 'high',
    locode: ['FRLEH','LE HAVRE','LH'],
    inner: { lat: [49.42, 49.62], lon: [-0.22, 0.50] },
    outer: { lat: [49.22, 49.82], lon: [-0.68, 1.05] },
  },
  {
    name: 'Piraeus', lat: 37.95, lon: 23.62, max: 100, reliability: 'high',
    locode: ['GRPIR','PIRAEUS','ATHENS'],
    inner: { lat: [37.82, 38.05], lon: [23.45, 23.90] },
    outer: { lat: [37.55, 38.30], lon: [23.05, 24.35] },
  },
  {
    name: 'Valencia', lat: 39.45, lon: -0.33, max: 60, reliability: 'high',
    locode: ['ESVLC','VALENCIA','VLC'],
    inner: { lat: [39.32, 39.58], lon: [-0.52, -0.12] },
    outer: { lat: [39.12, 39.78], lon: [-0.88, 0.18] },
  },
  {
    name: 'Barcelona', lat: 41.37, lon: 2.16, max: 55, reliability: 'high',
    locode: ['ESBCN','BARCELONA','BCN'],
    inner: { lat: [41.29, 41.48], lon: [2.02, 2.33] },
    outer: { lat: [41.12, 41.68], lon: [1.72, 2.68] },
  },
  {
    name: 'Algeciras', lat: 36.13, lon: -5.45, max: 60, reliability: 'low',
    locode: ['ESALG','ALGECIRAS'],
    inner: { lat: [35.92, 36.33], lon: [-5.82, -5.18] },
    outer: { lat: [35.62, 36.58], lon: [-6.28, -4.62] },
  },
  {
    name: 'Ningbo-Zhoushan', lat: 29.88, lon: 122.00, max: 150, reliability: 'low',
    locode: ['CNNBO','NINGBO','ZHOUSHAN'],
    inner: { lat: [29.62, 30.18], lon: [121.62, 122.48] },
    outer: { lat: [29.22, 30.58], lon: [121.05, 122.98] },
  },
  {
    name: 'Port Klang', lat: 3.00, lon: 101.38, max: 80, reliability: 'low',
    locode: ['MYPKG','PORT KLANG','KLANG'],
    inner: { lat: [2.82, 3.22], lon: [101.22, 101.72] },
    outer: { lat: [2.52, 3.52], lon: [100.82, 102.18] },
  },
  {
    name: 'Tanjung Pelepas', lat: 1.35, lon: 103.55, max: 70, reliability: 'medium',
    locode: ['MYPTP','TANJUNG PELEPAS','PELEPAS'],
    // lon max 103.63 — does NOT overlap with Singapore inner (starts at 103.65)
    inner: { lat: [1.20, 1.45], lon: [103.38, 103.63] },
    outer: { lat: [0.92, 1.72], lon: [103.05, 103.88] },
  },
  {
    name: 'Guangzhou', lat: 22.72, lon: 113.52, max: 90, reliability: 'medium',
    locode: ['CNGZU','GUANGZHOU','NANSHA'],
    // lat min 22.52 — does NOT overlap with Hong Kong inner (lat max 22.48)
    inner: { lat: [22.52, 22.92], lon: [113.18, 113.82] },
    outer: { lat: [22.22, 23.18], lon: [112.78, 114.28] },
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
