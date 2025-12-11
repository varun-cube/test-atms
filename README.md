# Camera Video Stream Server

A Node.js server for streaming RTSP camera feeds to web browsers via WebSocket.

## Features

- ✅ RTSP to WebSocket streaming
- ✅ MJPEG stream proxy
- ✅ Snapshot caching for smooth playback
- ✅ Automatic fallback (RTSP → MJPEG → Snapshot)
- ✅ Adaptive refresh rates

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Configure camera (optional - via environment variables or defaults):
```bash
# Create .env file
CAMERA_IP=10.10.20.99
CAMERA_USERNAME=root
CAMERA_PASSWORD=lrtl@123
CAMERA_RTSP_PORT=554
RTSP_WS_PORT=9999
PORT=3000
```

3. Start the server:
```bash
npm start
```

4. Open in browser:
```
http://localhost:3000
```

## API Endpoints

### RTSP Streaming
- **Start stream**: `GET /api/camera/stream/rtsp/start`
- **Stop stream**: `GET /api/camera/stream/rtsp/stop`
- **Check status**: `GET /api/camera/stream/rtsp/status`
- **Get WebSocket URL**: `GET /api/camera/stream/rtsp/ws-url`

### Video Streaming
- **MJPEG stream**: `GET /api/camera/stream/mjpeg`
- **Snapshot**: `GET /api/camera/snapshot`

## RTSP URL Format

Default RTSP URL: `rtsp://root:lrtl@123@10.10.20.99:554/live1s1.sdp` (Sub-stream - optimized for smooth playback)

**Note:** The sub-stream (`live1s1.sdp`) is used by default for smoother playback. For higher quality (if bandwidth allows), you can use the main stream (`live1s0.sdp`) via custom URL parameter.

You can also provide a custom RTSP URL:
```
GET /api/camera/stream/rtsp/start?url=rtsp://user:pass@ip:port/path
```

## WebSocket Connection

The RTSP stream is converted to WebSocket for browser compatibility:
```
ws://localhost:9999
```

The frontend automatically connects to this WebSocket to display the video stream.

## Configuration

All settings can be configured via environment variables:
- `CAMERA_IP` - Camera IP address (default: 10.10.20.99)
- `CAMERA_USERNAME` - Camera username (default: root)
- `CAMERA_PASSWORD` - Camera password (default: lrtl@123)
- `CAMERA_PORT` - HTTP port (default: 80)
- `CAMERA_RTSP_PORT` - RTSP port (default: 554)
- `RTSP_WS_PORT` - WebSocket port (default: 9999)
- `PORT` - Server port (default: 3000)
- `RTSP_FPS` - Frame rate for RTSP stream (default: 20)
- `RTSP_BITRATE` - Video bitrate (default: 1.5M)

## Technical Documentation

### Architecture Overview

The system consists of three main components that work together to provide reliable video streaming:

1. **RTSP Stream Handler** (`backend/rtsp-stream-handler.js`)
   - Converts RTSP streams to WebSocket using FFmpeg
   - Handles stream lifecycle (start/stop/restart)
   - Manages port availability and client connections
   - Optimized for low-latency streaming with adaptive bitrate

2. **Video Stream Proxy** (`backend/video-stream-proxy.js`)
   - Proxies MJPEG streams from camera to web clients
   - Auto-discovers working MJPEG endpoints
   - Caches working URLs for performance

3. **Camera Controller** (`backend/camera-controller.js`)
   - Manages snapshot retrieval with endpoint discovery
   - Implements caching for reduced camera load
   - Adaptive refresh rate based on connection quality

### RTSP URL Patterns

The system supports multiple RTSP URL patterns for maximum compatibility. Patterns are tried in order until a working stream is found:

#### Sub-stream Patterns (Lower bandwidth, smoother playback)
- `rtsp://user:pass@ip:port/live1s1.sdp` (Primary - Vivotek SD9384/SD9368)
- `rtsp://user:pass@ip:port/live2s1.sdp` (Alternative Vivotek format)
- `rtsp://user:pass@ip:port/videoSub` (Generic sub-stream)
- `rtsp://user:pass@ip:port/Streaming/Channels/102` (ONVIF sub-stream)

#### Main Stream Patterns (Higher quality, more bandwidth)
- `rtsp://user:pass@ip:port/live1s0.sdp` (Primary - Vivotek SD9384/SD9368)
- `rtsp://user:pass@ip:port/live2s0.sdp` (Alternative Vivotek format)
- `rtsp://user:pass@ip:port/videoMain` (Generic main stream)
- `rtsp://user:pass@ip:port/Streaming/Channels/101` (ONVIF main stream)

#### Generic Patterns
- `rtsp://user:pass@ip:port/live.sdp` (Generic RTSP stream)

**Note:** The sub-stream (`live1s1.sdp`) is used by default for optimal performance. Use main stream patterns for higher quality when bandwidth allows.

### Snapshot Endpoints

The system automatically discovers working snapshot endpoints. Endpoints are tried in priority order:

#### Vivotek SD9384/SD9368 Specific
- `/cgi-bin/viewer/video.jpg` (Primary - confirmed working)
- `/cgi-bin/video.jpg`
- `/cgi-bin/viewer/video.jpg?channel=1`
- `/cgi-bin/viewer/video.jpg?channel=1&subtype=0`
- `/cgi-bin/snapshot.cgi?channel=1`
- `/cgi-bin/snapshot.cgi`

#### Other Camera Brands
- Hikvision: `/ISAPI/Streaming/channels/1/picture`, `/Streaming/channels/101/picture`
- Dahua: `/cgi-bin/snapshot.cgi?channel=1`
- Axis: `/axis-cgi/jpg/image.cgi`
- Generic: `/snapshot.jpg`, `/image.jpg`, `/video.jpg`

### MJPEG Stream Endpoints

MJPEG endpoints are auto-discovered and cached for performance:

#### Vivotek SD9384/SD9368 Specific
- `/cgi-bin/viewer/video.mjpg` (Primary)
- `/cgi-bin/viewer/video.mjpeg`
- `/cgi-bin/viewer/video.mjpg?channel=1&subtype=0` (Main stream)
- `/cgi-bin/viewer/video.mjpg?channel=1&subtype=1` (Sub-stream)
- `/cgi-bin/mjpg/video.cgi?channel=1&subtype=0`
- `/cgi-bin/mjpg/video.cgi?channel=1&subtype=1`

#### Generic Formats
- `/cgi-bin/video.mjpg`
- `/video.mjpg`
- `/stream/video.mjpeg`

### FFmpeg Configuration

The RTSP stream handler uses optimized FFmpeg settings for low-latency streaming:

- **Codec**: H.264 (libx264) with baseline profile
- **Preset**: ultrafast (for low latency)
- **Tune**: zerolatency
- **Transport**: TCP (reliable delivery)
- **Frame Rate**: Configurable (default: 20 FPS)
- **Bitrate**: Configurable (default: 1.5M for sub-stream)
- **Buffer Settings**: Adaptive with maxrate and bufsize for smooth playback

### Performance Optimization

#### Snapshot Caching
- Background refresh at ~5 FPS (200ms interval)
- Adaptive rate reduction on connection failures
- Serves cached snapshots for instant response
- Reduces camera load significantly

#### Stream Management
- Automatic port conflict detection and resolution
- Stream restart on unexpected termination
- Client connection tracking
- Graceful shutdown handling

#### Network Optimization
- TCP transport for RTSP (reliable over UDP)
- Thread queue size: 512 (smooth input buffering)
- Low delay flags for minimal latency
- Optimized GOP size (2 seconds)

### API Response Formats

#### Start RTSP Stream
```json
{
  "success": true,
  "message": "RTSP stream started",
  "wsUrl": "ws://localhost:9999"
}
```

#### Stream Status
```json
{
  "success": true,
  "active": true,
  "wsUrl": "ws://localhost:9999",
  "clients": 1
}
```

#### Error Response
```json
{
  "success": false,
  "error": "Error message description"
}
```

### Troubleshooting

#### RTSP Stream Issues

**Problem:** Stream won't start
- **Solution:** Check camera IP, credentials, and RTSP port (default: 554)
- Verify FFmpeg is installed: `ffmpeg -version`
- Try custom URL: `/api/camera/stream/rtsp/start?url=rtsp://user:pass@ip:port/path`

**Problem:** Port already in use
- **Solution:** Change `RTSP_WS_PORT` in `.env` or stop conflicting process
- System automatically waits for port release (up to 5 seconds)

**Problem:** Black screen or no video
- **Solution:** Try different RTSP URL pattern (sub-stream vs main stream)
- Check camera RTSP settings and ensure stream is enabled
- Verify network connectivity to camera

#### Snapshot Issues

**Problem:** Snapshots not loading
- **Solution:** System auto-discovers endpoints - check camera HTTP access
- Verify credentials and HTTP port (default: 80)
- Check camera firewall settings

**Problem:** Slow snapshot refresh
- **Solution:** System adapts rate automatically on failures
- Check network latency to camera
- Verify camera is not overloaded

#### MJPEG Stream Issues

**Problem:** MJPEG returns 404
- **Solution:** This is expected if camera doesn't support MJPEG
- System falls back to snapshot automatically
- Check camera MJPEG settings if available

### Camera Compatibility

**Tested and Optimized For:**
- Vivotek SD9384-EHL (5MP, 30x zoom)
- Vivotek SD9368-EHL (2MP, 40x zoom)

**Also Compatible With:**
- Hikvision cameras (ONVIF format)
- Dahua cameras
- Axis cameras
- Generic ONVIF-compliant cameras
- Most IP cameras with RTSP support

### Security Considerations

- Credentials are passed in RTSP URLs (ensure HTTPS in production)
- WebSocket connections are localhost-only by default
- Consider implementing authentication for API endpoints in production
- Use environment variables for sensitive credentials (never commit to git)

### Development Notes

- Snapshot refresh runs in background thread
- RTSP stream uses separate process (FFmpeg)
- WebSocket server runs on dedicated port
- All components support graceful shutdown
- Error handling includes automatic retry logic

### System Flow Diagram

```
┌─────────────┐
│   Browser   │
│  (Frontend) │
└──────┬──────┘
       │ WebSocket (ws://localhost:9999)
       ▼
┌─────────────────────┐
│  RTSP Stream Handler │
│  (node-rtsp-stream)   │
└──────┬───────────────┘
       │ RTSP (rtsp://camera:554/...)
       ▼
┌─────────────┐
│   Camera    │
│  (Vivotek)  │
└─────────────┘

Fallback Chain:
RTSP → MJPEG → Snapshot (cached)
```

### Advanced Configuration

#### Custom RTSP URL Parameters

You can override the default RTSP URL with query parameters:

```bash
# Use main stream instead of sub-stream
GET /api/camera/stream/rtsp/start?url=rtsp://user:pass@ip:554/live1s0.sdp

# Use ONVIF format
GET /api/camera/stream/rtsp/start?url=rtsp://user:pass@ip:554/Streaming/Channels/101

# Custom camera with different port
GET /api/camera/stream/rtsp/start?url=rtsp://user:pass@ip:8554/custom/path
```

#### Bitrate Calculation

The system automatically calculates optimal bitrate settings:

- **Base Bitrate**: Set via `RTSP_BITRATE` (default: 1.5M)
- **Max Rate**: 125% of base (allows for bitrate spikes)
- **Buffer Size**: 2.5x max rate (ensures smooth playback)
- **Min Rate**: 50% of base (maintains minimum quality)

Example with `RTSP_BITRATE=2M`:
- Base: 2M
- Max: 2.5M
- Buffer: 6.25M
- Min: 1M

#### Frame Rate Optimization

Recommended FPS settings based on use case:

- **Sub-stream (default)**: 20 FPS - Smooth playback, lower bandwidth
- **Main stream**: 25-30 FPS - Higher quality, requires more bandwidth
- **Low bandwidth**: 15 FPS - Reduced quality but stable connection
- **High quality**: 30 FPS - Maximum quality, requires good network

Set via environment variable:
```bash
RTSP_FPS=25
```

### Network Requirements

#### Bandwidth Calculations

**Sub-stream (live1s1.sdp):**
- Bitrate: ~1.5 Mbps
- Recommended: 2+ Mbps connection
- Suitable for: Multiple concurrent viewers

**Main stream (live1s0.sdp):**
- Bitrate: ~4-8 Mbps (depends on camera settings)
- Recommended: 10+ Mbps connection
- Suitable for: Single viewer, high quality requirement

#### Port Requirements

| Port | Protocol | Direction | Purpose |
|------|----------|-----------|---------|
| 3000 | HTTP | Inbound | Web server and API |
| 9999 | WebSocket | Inbound | RTSP stream WebSocket |
| 554 | RTSP | Outbound | Camera RTSP connection |
| 80 | HTTP | Outbound | Camera HTTP (snapshots/MJPEG) |

**Firewall Configuration:**
- Allow inbound: 3000 (HTTP), 9999 (WebSocket)
- Allow outbound: 554 (RTSP), 80 (HTTP)
- Ensure camera is accessible from server network

### Deployment Guide

#### Production Deployment

1. **Environment Setup**
   ```bash
   # Create production .env file
   CAMERA_IP=your.camera.ip
   CAMERA_USERNAME=secure_username
   CAMERA_PASSWORD=secure_password
   PORT=3000
   RTSP_WS_PORT=9999
   RTSP_FPS=20
   RTSP_BITRATE=1.5M
   ```

2. **Process Management (PM2)**
   ```bash
   npm install -g pm2
   pm2 start server.js --name camera-stream
   pm2 save
   pm2 startup  # Auto-start on system boot
   ```

3. **Reverse Proxy (Nginx)**
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
       
       location /ws {
           proxy_pass http://localhost:9999;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }
   }
   ```

4. **SSL/HTTPS Setup**
   - Use Let's Encrypt for free SSL certificates
   - Update Nginx config to use HTTPS
   - Ensure WebSocket connections use WSS in production

#### Docker Deployment

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install FFmpeg
RUN apk add --no-cache ffmpeg

# Copy package files
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

EXPOSE 3000 9999

CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t camera-stream-server .
docker run -d \
  -p 3000:3000 \
  -p 9999:9999 \
  --env-file .env \
  --name camera-stream \
  camera-stream-server
```

### Monitoring and Logging

#### Log Levels

The system provides structured logging:

- **Info**: Stream start/stop, endpoint discovery
- **Warning**: Port conflicts, connection issues
- **Error**: Stream failures, authentication errors

#### Health Check Endpoint

Monitor stream status:
```bash
curl http://localhost:3000/api/camera/stream/rtsp/status
```

Response includes:
- Stream active status
- WebSocket URL
- Connected client count

#### Performance Monitoring

Key metrics to monitor:

1. **Stream Uptime**: Check for frequent restarts
2. **Client Count**: Monitor concurrent connections
3. **Snapshot Refresh Rate**: Should be ~5 FPS normally
4. **Port Availability**: Check for conflicts
5. **Error Frequency**: Monitor consecutive failures

#### Log Analysis

Common log patterns:

**Successful Stream Start:**
```
Starting RTSP stream from: rtsp://****@10.10.20.99:554/live1s1.sdp
✓ RTSP stream started successfully
```

**Port Conflict:**
```
⚠️  Port 9999 is in use. Waiting for release...
```

**Endpoint Discovery:**
```
✓ Snapshot endpoint found: /cgi-bin/viewer/video.jpg
✓ Found working MJPEG stream: /cgi-bin/viewer/video.mjpg
```

### Integration Examples

#### JavaScript/TypeScript Client

```javascript
// Connect to WebSocket stream
const ws = new WebSocket('ws://localhost:9999');
const video = document.getElementById('video');

ws.onopen = () => {
  console.log('WebSocket connected');
  // Start RTSP stream via API
  fetch('/api/camera/stream/rtsp/start')
    .then(res => res.json())
    .then(data => console.log('Stream started:', data));
};

ws.onmessage = (event) => {
  // Handle video data (MPEG-TS format)
  // Use libraries like HLS.js or video.js for playback
};
```

#### Python Client

```python
import requests
import websocket
import json

# Start RTSP stream
response = requests.get('http://localhost:3000/api/camera/stream/rtsp/start')
data = response.json()
ws_url = data['wsUrl']

# Connect to WebSocket
ws = websocket.WebSocket()
ws.connect(ws_url)

# Receive video stream
while True:
    frame = ws.recv()
    # Process frame data
```

#### cURL Examples

```bash
# Start RTSP stream
curl http://localhost:3000/api/camera/stream/rtsp/start

# Check stream status
curl http://localhost:3000/api/camera/stream/rtsp/status

# Stop stream
curl http://localhost:3000/api/camera/stream/rtsp/stop

# Get snapshot
curl http://localhost:3000/api/camera/snapshot -o snapshot.jpg

# Get MJPEG stream
curl http://localhost:3000/api/camera/stream/mjpeg -o stream.mjpeg
```

### Performance Tuning

#### Optimizing for Low Latency

1. **Reduce Frame Rate**: Set `RTSP_FPS=15` for lower latency
2. **Use Sub-stream**: Lower resolution = lower latency
3. **Reduce Bitrate**: Set `RTSP_BITRATE=1M` for faster encoding
4. **Network Optimization**: Use wired connection, reduce network hops

#### Optimizing for Quality

1. **Use Main Stream**: Higher resolution and quality
2. **Increase Bitrate**: Set `RTSP_BITRATE=4M` or higher
3. **Higher Frame Rate**: Set `RTSP_FPS=30` for smooth motion
4. **Network Bandwidth**: Ensure adequate bandwidth (10+ Mbps)

#### Optimizing for Multiple Viewers

1. **Use Sub-stream**: Lower bandwidth per viewer
2. **Snapshot Fallback**: Use snapshot mode for many concurrent viewers
3. **Load Balancing**: Deploy multiple instances behind load balancer
4. **CDN Integration**: Cache snapshots via CDN for global distribution

### Error Handling

#### Automatic Recovery

The system includes automatic recovery mechanisms:

1. **Stream Restart**: Automatically restarts on unexpected termination
2. **Port Release**: Waits for port release on conflicts
3. **Endpoint Rediscovery**: Re-discovers endpoints on failures
4. **Adaptive Refresh**: Reduces snapshot rate on connection issues

#### Error Codes

Common error scenarios:

- **EADDRINUSE**: Port already in use
- **ECONNREFUSED**: Camera connection refused
- **ETIMEDOUT**: Connection timeout
- **401/403**: Authentication failure
- **404**: Endpoint not found

#### Manual Recovery

If automatic recovery fails:

1. **Restart Stream**: Call `/api/camera/stream/rtsp/stop` then `/start`
2. **Check Camera**: Verify camera is online and accessible
3. **Verify Credentials**: Test with camera web interface
4. **Network Test**: Ping camera IP, test RTSP with VLC player

### Testing

#### Manual Testing

1. **Test RTSP Connection**:
   ```bash
   ffmpeg -rtsp_transport tcp -i rtsp://user:pass@ip:554/live1s1.sdp -t 10 test.mp4
   ```

2. **Test Snapshot Endpoint**:
   ```bash
   curl -u user:pass http://ip:80/cgi-bin/viewer/video.jpg -o test.jpg
   ```

3. **Test MJPEG Stream**:
   ```bash
   curl -u user:pass http://ip:80/cgi-bin/viewer/video.mjpg > stream.mjpeg
   ```

#### Automated Testing

Create test script:
```javascript
// test-stream.js
const axios = require('axios');

async function testStream() {
  try {
    // Start stream
    const start = await axios.get('http://localhost:3000/api/camera/stream/rtsp/start');
    console.log('Stream started:', start.data);
    
    // Check status
    const status = await axios.get('http://localhost:3000/api/camera/stream/rtsp/status');
    console.log('Stream status:', status.data);
    
    // Get snapshot
    const snapshot = await axios.get('http://localhost:3000/api/camera/snapshot', {
      responseType: 'arraybuffer'
    });
    console.log('Snapshot size:', snapshot.data.length);
    
    // Stop stream
    const stop = await axios.get('http://localhost:3000/api/camera/stream/rtsp/stop');
    console.log('Stream stopped:', stop.data);
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testStream();
```

### Best Practices

1. **Always use sub-stream for multiple viewers** - Reduces bandwidth and improves stability
2. **Monitor error logs** - Set up log aggregation for production
3. **Use environment variables** - Never hardcode credentials
4. **Implement rate limiting** - Protect API endpoints from abuse
5. **Regular health checks** - Monitor stream status periodically
6. **Backup configuration** - Keep camera settings documented
7. **Network isolation** - Keep camera network separate when possible
8. **Regular updates** - Keep dependencies and FFmpeg updated

### Known Limitations

1. **Single RTSP stream per instance** - One active stream at a time
2. **WebSocket port limitation** - One WebSocket server per port
3. **FFmpeg dependency** - Requires FFmpeg installation
4. **Browser compatibility** - WebSocket video requires compatible player
5. **Network bandwidth** - Limited by camera and network capacity

### Future Enhancements

Potential improvements:

- Multi-stream support (multiple cameras)
- HLS/DASH output formats
- Recording functionality
- Motion detection integration
- WebRTC support
- Authentication middleware
- Metrics dashboard
- Cloud deployment guides
