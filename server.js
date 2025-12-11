// Minimal RTSP → WebSocket bridge using ffmpeg + Express + ws
// ffmpeg pulls RTSP, transcodes to MPEG-TS (MPEG1 video), and streams via WebSocket for JSMpeg in the browser.
const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 8080;
const RTSP_URL = process.env.RTSP_URL || 'rtsp://root:lrtl%40123@10.10.20.99:554/live1s1.sdp';

const app = express();
// Serve the static player page and the local jsmpeg.min.js
app.use(express.static(path.join(__dirname, 'public')));

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Using RTSP URL: ${RTSP_URL.replace(/:[^:@]+@/, ':****@')}`);
});

// WebSocket server for streaming MPEG-TS chunks to the browser (JSMpeg)
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Web client connected');

  // ffmpeg command: pull RTSP over TCP, encode to MPEG1 in an MPEG-TS container
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

  console.log('Spawning ffmpeg with args:', ffmpegArgs.join(' '));

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  // If ffmpeg fails to start
  ffmpeg.on('error', (err) => {
    console.error('Failed to start ffmpeg:', err.message);
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  // Pipe ffmpeg stdout (MPEG-TS) into the WebSocket
  ffmpeg.stdout.on('data', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Log only error-like messages from ffmpeg stderr to reduce noise
  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (/error|fail|refused|timed out|invalid/i.test(msg)) {
      console.error('[ffmpeg]', msg.trim());
    }
  });

  // When the browser disconnects, stop ffmpeg
  ws.on('close', () => {
    console.log('Client disconnected, killing ffmpeg');
    ffmpeg.kill('SIGINT');
  });

  // Log ffmpeg exit
  ffmpeg.on('exit', (code, signal) => {
    console.log(`ffmpeg exited: code=${code} signal=${signal}`);
  });
});

