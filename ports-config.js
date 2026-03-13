'use strict';

const PORTS = [
  { name: 'Rotterdam',       lat: 51.95,  lon: 4.25,   max: 80,  locode: ['NLRTM','ROTTERDAM','ROTTM','RTM','RTDM'],       inner: { lat: [51.80,52.10], lon: [3.90,4.60]    }, outer: { lat: [51.60,52.30], lon: [3.50,5.20]   } },
  { name: 'Singapore',       lat: 1.27,   lon: 103.82, max: 120, locode: ['SGSIN','SINGAPORE','SGP'],                      inner: { lat: [1.00,1.55],   lon: [103.50,104.20] }, outer: { lat: [0.70,1.80],   lon: [103.00,104.50]} },
  { name: 'Shanghai',        lat: 31.20,  lon: 121.70, max: 150, locode: ['CNSHA','SHANGHAI'],                             inner: { lat: [30.80,31.55], lon: [121.00,122.30] }, outer: { lat: [30.40,32.00], lon: [120.50,122.80]} },
  { name: 'Los Angeles',     lat: 33.73,  lon: -118.27,max: 70,  locode: ['USLAX','LOS ANGELES','LA','LONG BEACH'],        inner: { lat: [33.50,34.00], lon: [-118.80,-117.90]},outer: { lat: [33.20,34.30], lon: [-119.20,-117.50]}},
  { name: 'Hamburg',         lat: 53.55,  lon: 9.97,   max: 60,  locode: ['DEHAM','HAMBURG'],                             inner: { lat: [53.40,53.80], lon: [9.50,10.50]   }, outer: { lat: [53.20,54.00], lon: [8.80,11.00]  } },
  { name: 'Antwerp',         lat: 51.27,  lon: 4.30,   max: 65,  locode: ['BEANR','ANTWERP','ANR'],                       inner: { lat: [51.00,51.60], lon: [3.80,4.80]    }, outer: { lat: [50.80,51.80], lon: [3.30,5.30]   } },
  { name: 'Jebel Ali',       lat: 25.00,  lon: 55.05,  max: 80,  locode: ['AEJEA','JEBEL ALI','DUBAI'],                   inner: { lat: [24.70,25.30], lon: [54.80,55.50]  }, outer: { lat: [24.30,25.70], lon: [54.30,56.00]  } },
  { name: 'Busan',           lat: 35.10,  lon: 129.05, max: 90,  locode: ['KRPUS','BUSAN'],                               inner: { lat: [34.90,35.40], lon: [128.70,129.35] }, outer: { lat: [34.60,35.70], lon: [128.30,129.80]} },
  { name: 'New York',        lat: 40.67,  lon: -74.03, max: 55,  locode: ['USNYC','NEW YORK','NY'],                       inner: { lat: [40.40,40.95], lon: [-74.35,-73.75] }, outer: { lat: [40.10,41.20], lon: [-74.80,-73.30]} },
  { name: 'Hong Kong',       lat: 22.32,  lon: 114.19, max: 100, locode: ['HKHKG','HONG KONG','HK'],                      inner: { lat: [22.10,22.55], lon: [113.90,114.50] }, outer: { lat: [21.80,22.80], lon: [113.50,115.00]} },
  { name: 'Felixstowe',      lat: 51.95,  lon: 1.35,   max: 40,  locode: ['GBFXT','FELIXSTOWE'],                         inner: { lat: [51.85,52.05], lon: [1.20,1.60]    }, outer: { lat: [51.65,52.25], lon: [0.80,2.00]   } },
  { name: 'Le Havre',        lat: 49.50,  lon: 0.10,   max: 50,  locode: ['FRLEH','LE HAVRE','LH'],                       inner: { lat: [49.40,49.65], lon: [-0.25,0.55]   }, outer: { lat: [49.20,49.85], lon: [-0.70,1.10]  } },
  { name: 'Piraeus',         lat: 37.95,  lon: 23.65,  max: 55,  locode: ['GRPIR','PIRAEUS','ATHENS'],                    inner: { lat: [37.80,38.10], lon: [23.40,23.95]  }, outer: { lat: [37.55,38.35], lon: [23.00,24.40]  } },
  { name: 'Valencia',        lat: 39.45,  lon: -0.35,  max: 45,  locode: ['ESVLC','VALENCIA','VLC'],                      inner: { lat: [39.30,39.60], lon: [-0.55,-0.10]  }, outer: { lat: [39.10,39.80], lon: [-0.90,0.20]   } },
  { name: 'Barcelona',       lat: 41.37,  lon: 2.16,   max: 45,  locode: ['ESBCN','BARCELONA','BCN'],                     inner: { lat: [41.27,41.50], lon: [2.00,2.35]    }, outer: { lat: [41.10,41.70], lon: [1.70,2.70]   } },
  { name: 'Algeciras',       lat: 36.13,  lon: -5.45,  max: 50,  locode: ['ESALG','ALGECIRAS'],                          inner: { lat: [35.90,36.35], lon: [-5.85,-5.15]  }, outer: { lat: [35.60,36.60], lon: [-6.30,-4.60]  } },
  { name: 'Ningbo-Zhoushan', lat: 29.88,  lon: 122.00, max: 120, locode: ['CNNBO','NINGBO','ZHOUSHAN'],                  inner: { lat: [29.60,30.20], lon: [121.60,122.50] }, outer: { lat: [29.20,30.60], lon: [121.00,123.00]} },
  { name: 'Port Klang',      lat: 3.00,   lon: 101.38, max: 60,  locode: ['MYPKG','PORT KLANG','KLANG'],                  inner: { lat: [2.80,3.25],   lon: [101.20,101.75] }, outer: { lat: [2.50,3.55],   lon: [100.80,102.20]} },
  { name: 'Tanjung Pelepas', lat: 1.37,   lon: 103.55, max: 55,  locode: ['MYPTP','TANJUNG PELEPAS','PELEPAS'],          inner: { lat: [1.20,1.55],   lon: [103.40,103.80] }, outer: { lat: [0.90,1.80],   lon: [103.00,104.30]} },
  { name: 'Guangzhou',       lat: 22.70,  lon: 113.50, max: 80,  locode: ['CNGZU','GUANGZHOU','NANSHA'],                  inner: { lat: [22.50,22.95], lon: [113.20,113.85] }, outer: { lat: [22.20,23.20], lon: [112.80,114.30]} },
];

function inBox(lat, lon, zone) {
  return lat >= zone.lat[0] && lat <= zone.lat[1] && lon >= zone.lon[0] && lon <= zone.lon[1];
}

function normalizeDestination(raw) {
  if (!raw) return '';
  const cleaned = raw.replace(/[@#*]+/g, '').trim().toUpperCase();
  for (const port of PORTS) {
    for (const code of port.locode) {
      if (cleaned.includes(code)) return port.name;
    }
  }
  return cleaned;
}

module.exports = { PORTS, inBox, normalizeDestination };
