'use strict';

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const { processMessage, buildPortStates } = require('./processor');

const PORT = process.env.PORT || 3001;
const AIS_API_KEY = process.env.AISSTREAM_API_KEY;
const AIS_ENDPOINT = 'wss://stream.aisstream.io/v0/stream';

if (!AIS_API_KEY) {
  console.error('FATAL: AISSTREAM_API_KEY env var is required');
  process.exit(1);
}

// ─── AISstream WebSocket manager ─────────────────────────────────────────────

let ws = null;
let reconnectDelay = 5000;
let messageCount = 0;
let connectedAt = null;
let isConnected = false;

function connect() {
  console.log('[AIS] Connecting to AISstream…');
  ws = new WebSocket(AIS_ENDPOINT);

  ws.on('open', () => {
    console.log('[AIS] Connected — subscribing globally');
    connectedAt = new Date().toISOString();
    isConnected = true;
    reconnectDelay = 5000; // reset backoff on successful connect

    ws.send(JSON.stringify({
      APIKey: AIS_API_KEY,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
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
    processMessage(data.toString());

    // Log throughput every 10,000 messages
    if (messageCount % 10000 === 0) {
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
    console.log(`[AIS] Reconnecting in ${reconnectDelay / 1000}s…`);

    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 60000); // cap at 60s
      connect();
    }, reconnectDelay);
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
