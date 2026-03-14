'use strict';

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const { processMessage, buildPortStates } = require('./processor');
const { PORTS } = require('./ports-config');

const PORT = process.env.PORT || 3001;
const AIS_API_KEY = process.env.AISSTREAM_API_KEY;
const AIS_ENDPOINT = 'wss://stream.aisstream.io/v0/stream';

// Use outer bounding boxes for each configured port — avoids triggering
// AISstream's global-subscription throttle on free plans
const PORT_BOUNDING_BOXES = PORTS.map(p => [
  [p.outer.lat[0], p.outer.lon[0]],
  [p.outer.lat[1], p.outer.lon[1]],
]);

if (!AIS_API_KEY) {
  console.error('FATAL: AISSTREAM_API_KEY env var is required');
  process.exit(1);
}

// ─── AISstream WebSocket manager ─────────────────────────────────────────────

let ws = null;
const RECONNECT_DELAY = 3 * 60_000; // 3 min — balance between message volume and quota preservation
let messageCount = 0;
let connectedAt = null;
let isConnected = false;

function connect() {
  console.log('[AIS] Connecting to AISstream…');
  ws = new WebSocket(AIS_ENDPOINT);

  ws.on('open', () => {
    console.log(`[AIS] Connected — subscribing to ${PORT_BOUNDING_BOXES.length} port regions`);
    connectedAt = new Date().toISOString();
    isConnected = true;

    ws.send(JSON.stringify({
      APIKey: AIS_API_KEY,
      BoundingBoxes: PORT_BOUNDING_BOXES,
      FilterMessageTypes: [
        'PositionReport',
        'ShipStaticData',
        'StandardClassBPositionReport',
        'ExtendedClassBPositionReport',
        'StaticDataReport',
        'LongRangeAisBroadcastMessage',
      ],
    }));
  });

  ws.on('message', (data) => {
    messageCount++;
    if (messageCount === 1) console.log('[AIS] First message received — data flowing!');
    processMessage(data.toString());

    if (messageCount % 5000 === 0) {
      console.log(`[AIS] ${messageCount.toLocaleString()} messages processed`);
    }
  });

  ws.on('ping', () => {
    // ws package handles pong automatically — this just logs if needed
  });

  ws.on('error', (err) => {
    console.error('[AIS] Error:', err.message);
  });

  ws.on('close', (code, reason) => {
    isConnected = false;
    console.log(`[AIS] Disconnected — code:${code} reason:${reason?.toString() || 'none'}`);
    console.log(`[AIS] Reconnecting in 3 minutes…`);

    setTimeout(connect, RECONNECT_DELAY);
  });
}

// Start the persistent AISstream connection
connect();

// ─── Express HTTP server ──────────────────────────────────────────────────────

const app = express();

app.use(cors()); // allow Vercel to call this API

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Health / status endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'AIS Relay',
    status: isConnected ? 'connected' : 'reconnecting',
    messagesProcessed: messageCount,
    connectedAt,
    uptime: Math.round(process.uptime()) + 's',
  });
});

// All port states
app.get('/ports', (req, res) => {
  const ports = buildPortStates();
  res.json({
    ports,
    messageCount,
    timestamp: new Date().toISOString(),
    source: 'live',
    relayConnected: isConnected,
  });
});

// Single port detail
app.get('/port/:name', (req, res) => {
  const ports = buildPortStates();
  const port = ports.find(
    p => p.name.toLowerCase() === decodeURIComponent(req.params.name).toLowerCase()
  );
  if (!port) return res.status(404).json({ error: 'Port not found' });
  res.json({ ...port, source: 'live' });
});

app.listen(PORT, () => {
  console.log(`[HTTP] AIS Relay listening on port ${PORT}`);
});
