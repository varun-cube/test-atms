require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const CameraManager = require('./backend/camera-manager');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Centralized camera/server configuration (default camera)
const cameraConfig = {
  id: 'default',
  ip: process.env.CAMERA_IP || '10.10.20.99',
  port: process.env.CAMERA_PORT || 80,
  rtspPort: process.env.CAMERA_RTSP_PORT || 554,
  username: process.env.CAMERA_USERNAME || 'CUBE_BS',
  password: process.env.CAMERA_PASSWORD || 'CubeBS@4321',
  protocol: process.env.CAMERA_PROTOCOL || 'http',
  wsPort: process.env.RTSP_WS_PORT || 9999,
  fps: parseInt(process.env.RTSP_FPS, 10) || 20,
  bitrate: process.env.RTSP_BITRATE || '1.5M'
};

// Camera manager to support many cameras (200+)
const cameraManager = new CameraManager([cameraConfig]);

// API Routes - Video Streaming (multi-camera capable)

function resolveCamera(req) {
  const cameraId = req.params.cameraId || req.query.cameraId || 'default';
  const cam = cameraManager.getCameraOrThrow(cameraId);
  return { cameraId, ...cam };
}

// Camera registration (in-memory)
app.post('/api/cameras', (req, res) => {
  try {
    const cfg = req.body || {};
    if (!cfg.ip) {
      return res.status(400).json({ success: false, error: 'ip is required' });
    }
    const registered = cameraManager.registerCamera(cfg);
    res.json({ success: true, camera: registered });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/cameras', (req, res) => {
  res.json({ success: true, cameras: cameraManager.listCameras() });
});

// RTSP Stream endpoints (multi-camera)
async function startRtspStream(req, res) {
  try {
    const { cameraId, rtsp } = resolveCamera(req);
    const customUrl = req.query.url || null;
    await rtsp.startStream(customUrl);
    res.json({ 
      success: true, 
      message: `RTSP stream started for ${cameraId}`,
      wsUrl: rtsp.getWebSocketUrl()
    });
  } catch (error) {
    console.error('RTSP start error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

function stopRtspStream(req, res) {
  try {
    const { cameraId, rtsp } = resolveCamera(req);
    rtsp.stopStream();
    res.json({ success: true, message: `RTSP stream stopped for ${cameraId}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

function rtspStatus(req, res) {
  try {
    const { rtsp } = resolveCamera(req);
    res.json({ 
      success: true, 
      active: rtsp.isStreamActive(),
      wsUrl: rtsp.getWebSocketUrl(),
      clients: rtsp.getClientCount()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

function rtspWsUrl(req, res) {
  try {
    const { rtsp } = resolveCamera(req);
    res.json({ 
      success: true, 
      wsUrl: rtsp.getWebSocketUrl()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

app.get('/api/camera/stream/rtsp/start', startRtspStream); // default camera (backward compatible)
app.get('/api/camera/stream/rtsp/stop', stopRtspStream);
app.get('/api/camera/stream/rtsp/status', rtspStatus);
app.get('/api/camera/stream/rtsp/ws-url', rtspWsUrl);

app.get('/api/cameras/:cameraId/stream/rtsp/start', startRtspStream);
app.get('/api/cameras/:cameraId/stream/rtsp/stop', stopRtspStream);
app.get('/api/cameras/:cameraId/stream/rtsp/status', rtspStatus);
app.get('/api/cameras/:cameraId/stream/rtsp/ws-url', rtspWsUrl);

// Proxy video stream (MJPEG) - tries MJPEG first, falls back to snapshot
app.get(['/api/camera/stream/mjpeg', '/api/cameras/:cameraId/stream/mjpeg'], async (req, res) => {
  try {
    const { proxy } = resolveCamera(req);
    await proxy.proxyStream(req, res);
  } catch (error) {
    // Only log if it's not a "not available" error (404)
    if (!error.message.includes('not available') && !error.message.includes('404')) {
      console.error('MJPEG stream error:', error.message);
    }
    if (!res.headersSent) {
      // Return 404 for "not available" so frontend knows to use snapshot
      const statusCode = error.message.includes('not available') ? 404 : 500;
      res.status(statusCode).json({ success: false, error: error.message });
    }
  }
});

// Snapshot cache per camera for smoother streaming and lower camera load
const snapshotState = new Map(); // cameraId -> state
const SNAPSHOT_INTERVAL_MS = 200; // pull ~5 FPS from camera (reasonable rate)
const MAX_CONSECUTIVE_FAILURES = 5; // After 5 failures, slow down refresh rate

function ensureSnapshotState(cameraId) {
  if (!snapshotState.has(cameraId)) {
    snapshotState.set(cameraId, {
      latestSnapshot: null,
      lastSnapshotTime: 0,
      isRefreshing: false,
      consecutiveFailures: 0,
      refreshInterval: null,
      currentIntervalMs: SNAPSHOT_INTERVAL_MS
    });
  }
  return snapshotState.get(cameraId);
}

function startSnapshotRefresh(cameraId, controller, intervalMs = SNAPSHOT_INTERVAL_MS) {
  const state = ensureSnapshotState(cameraId);
  if (state.refreshInterval) {
    clearInterval(state.refreshInterval);
  }
  state.currentIntervalMs = intervalMs;
  state.refreshInterval = setInterval(() => refreshSnapshot(cameraId, controller), intervalMs);
}

// Snapshot refresh function with adaptive rate per camera
async function refreshSnapshot(cameraId, controller) {
  const state = ensureSnapshotState(cameraId);
  if (state.isRefreshing) {
    return;
  }

  state.isRefreshing = true;
  try {
    const buf = await controller.getSnapshot();
    state.latestSnapshot = buf;
    state.lastSnapshotTime = Date.now();
    
    // Reset failure count and restore normal rate on success
    if (state.consecutiveFailures > 0) {
      state.consecutiveFailures = 0;
      if (state.currentIntervalMs !== SNAPSHOT_INTERVAL_MS) {
        startSnapshotRefresh(cameraId, controller, SNAPSHOT_INTERVAL_MS);
        console.log(`✓ Snapshot connection restored for ${cameraId}, resuming normal refresh rate`);
      }
    }
  } catch (err) {
    state.consecutiveFailures++;
    
    // Only log errors occasionally to avoid spam
    if (state.consecutiveFailures === 1) {
      console.error(`Snapshot refresh failed (${cameraId}): ${err.message}`);
    } else if (state.consecutiveFailures % 10 === 0) {
      console.error(`Snapshot refresh failed (${cameraId}) (${state.consecutiveFailures} consecutive failures)`);
    }
    
    // If too many failures, slow down refresh rate
    if (state.consecutiveFailures === MAX_CONSECUTIVE_FAILURES && state.currentIntervalMs === SNAPSHOT_INTERVAL_MS) {
      console.warn(`⚠️  Too many snapshot failures (${cameraId}). Slowing down refresh rate to 1 FPS. Check camera connectivity.`);
      startSnapshotRefresh(cameraId, controller, 1000); // 1 FPS when having issues
    }
  } finally {
    state.isRefreshing = false;
  }
}

// Start background snapshot pull at normal rate for default camera only (avoid spinning 200 timers)
try {
  const defaultCam = cameraManager.getCameraOrThrow('default');
  startSnapshotRefresh('default', defaultCam.controller, SNAPSHOT_INTERVAL_MS);
} catch (e) {
  console.warn('Default camera snapshot refresh not started:', e.message);
}

// Snapshot - served from cached frame for speed (per camera)
app.get(['/api/camera/snapshot', '/api/cameras/:cameraId/snapshot'], async (req, res) => {
  try {
    const { cameraId, controller } = resolveCamera(req);
    const state = ensureSnapshotState(cameraId);

    // If cache is stale (> 300ms), attempt a fresh pull
    if (!state.latestSnapshot || Date.now() - state.lastSnapshotTime > 300) {
      await refreshSnapshot(cameraId, controller);
    }

    if (!state.latestSnapshot) {
      throw new Error('No snapshot available');
    }

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET');
    res.send(state.latestSnapshot);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Serve static files and SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const server = app.listen(PORT, () => {
  const defaultCam = cameraManager.getCameraOrThrow('default');
  console.log(`🚀 Camera Video Stream Server running on http://localhost:${PORT}`);
  console.log(`📹 Default Camera IP: ${defaultCam.config.ip}`);
  console.log(`👤 Username: ${defaultCam.config.username}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
  console.log(`🎥 RTSP WebSocket (default): ${defaultCam.rtsp.getWebSocketUrl()}`);
  console.log(`\n💡 To start RTSP stream: GET /api/camera/stream/rtsp/start`);
  console.log(`💡 To start RTSP stream for a specific camera: GET /api/cameras/{cameraId}/stream/rtsp/start`);
});

// Graceful shutdown
async function cleanupAll() {
  const ids = cameraManager.listCameras();
  for (const id of ids) {
    try {
      const cam = cameraManager.getCameraOrThrow(id);
      if (cam.rtsp?.cleanup) {
        await cam.rtsp.cleanup();
      } else if (cam.rtsp?.stopStream) {
        cam.rtsp.stopStream();
      }
      const state = snapshotState.get(id);
      if (state?.refreshInterval) {
        clearInterval(state.refreshInterval);
      }
    } catch (e) {
      console.error(`Error cleaning camera ${id}:`, e.message);
    }
  }
}

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await cleanupAll();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await cleanupAll();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;

