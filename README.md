# RTSP to WebSocket + JSMpeg Viewer (Minimal Setup)

This project streams an RTSP camera feed to the browser. ffmpeg pulls RTSP, transcodes to MPEG-TS (MPEG1 video), and a WebSocket delivers the stream to the browser, where JSMpeg decodes and renders it on a `<canvas>`.

## Files

- `server.js` — Minimal RTSP → WebSocket bridge using ffmpeg, Express, and ws.
- `public/index.html` — Tiny viewer that loads JSMpeg, connects to the WS stream, and renders video on a canvas.
- `public/jsmpeg.min.js` — Local JSMpeg build (avoids CDN issues).
- `package.json` — Dependencies (express, ws).

## How it works (end-to-end)

1) Browser requests `http://<host>:<port>/` → `public/index.html` served.
2) `index.html` loads `jsmpeg.min.js` (local first, CDN fallbacks).
3) JSMpeg connects via WebSocket to `ws://<host>:<port>/`.
4) On each WS connection, `server.js` spawns `ffmpeg` to pull RTSP and transcode to MPEG-TS/MPEG1.
5) ffmpeg stdout → WebSocket → JSMpeg → `<canvas>` (live video).

## Running

```bash
# from project root
node server.js
# default: PORT=8080, RTSP_URL from server.js (or env)
# open http://localhost:8080/
```

Optional:
```bash
PORT=3000 RTSP_URL="rtsp://user:pass@ip:554/path" node server.js
```

Requirements: Node.js, ffmpeg on PATH, reachable RTSP camera.

## server.js (key lines explained)

```js
const PORT = process.env.PORT || 8080;
const RTSP_URL = process.env.RTSP_URL || 'rtsp://root:lrtl%40123@10.10.20.99:554/live1s1.sdp';
```
- Sets HTTP port and RTSP source (password “@” is URL-encoded as `%40`). Override with env vars.

```js
app.use(express.static(path.join(__dirname, 'public')));
```
- Serves `index.html`, `jsmpeg.min.js`, and assets.

```js
const server = app.listen(PORT, () => {...});
const wss = new WebSocket.Server({ server });
```
- Starts HTTP and attaches a WebSocket server on the same port (for JSMpeg).

```js
const ffmpegArgs = [
  '-rtsp_transport', 'tcp',
  '-i', RTSP_URL,
  '-f', 'mpegts',
  '-codec:v', 'mpeg1video',
  '-s', '640x480',
  '-b:v', '800k',
  '-r', '25',
  '-bf', '0',
  '-'
];
```
- ffmpeg command: pull RTSP over TCP, output MPEG1 in MPEG-TS, sized 640x480, 800 kbps, 25 fps, zero B-frames.

```js
const ffmpeg = spawn('ffmpeg', ffmpegArgs);
ffmpeg.stdout.on('data', (data) => { if (ws.OPEN) ws.send(data); });
```
- Starts ffmpeg; pipes its MPEG-TS output into the WebSocket to the browser.

```js
ffmpeg.stderr.on('data', (data) => { /* logs only errors/timeouts/refused */ });
```
- Logs error-like stderr messages to help debug connectivity.

```js
ws.on('close', () => ffmpeg.kill('SIGINT'));
ffmpeg.on('exit', (code, signal) => {...});
```
- Cleans up ffmpeg when the browser disconnects; logs exit.

## public/index.html (key lines explained)

```html
<div id="status">Loading player...</div>
<canvas id="video"></canvas>
```
- Status overlay plus the canvas where video is drawn.

```js
const sources = [
  './jsmpeg.min.js',
  'https://cdn.jsdelivr.net/npm/jsmpeg@0.2.1/jsmpeg.min.js',
  'https://unpkg.com/jsmpeg@0.2.1/jsmpeg.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jsmpeg/0.2/jsmpeg.min.js'
];
```
- Load JSMpeg locally first; if blocked, try CDNs.

```js
if (typeof JSMpeg === 'undefined') { statusEl.textContent = '...not available.'; return; }
const wsUrl = 'ws://' + location.host;
new JSMpeg.Player(wsUrl, { canvas: ..., autoplay: true, audio: false });
```
- Once JSMpeg is loaded, connect to the same host/port WS stream and render to the canvas. Audio is off by default.

Status messages flow: Loading → Player loaded → Connecting → Streaming (or failure if JSMpeg never loads).

## Integration summary

- The browser page (`public/index.html`) is served by Express and loads `public/jsmpeg.min.js` (local).
- JSMpeg connects to the WebSocket endpoint provided by `server.js` on the same host/port.
- `server.js` spawns ffmpeg per WS client, transcodes RTSP to MPEG-TS, and streams it to JSMpeg.
- No extra APIs or camera registry; it’s a single RTSP → WS → JSMpeg pipeline.

## Troubleshooting

- If video is blank:
  - Check browser console for JSMpeg load errors.
  - Ensure `public/jsmpeg.min.js` exists (local fallback).
  - Check terminal logs from `node server.js` for ffmpeg errors (connection refused/auth/path).
- If RTSP fails:
  - Verify the RTSP URL works in `ffmpeg -i <url> -t 3 -f null -`.
  - Confirm network reachability to camera, correct credentials/path, and ffmpeg on PATH.

