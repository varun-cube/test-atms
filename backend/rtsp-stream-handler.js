const Stream = require('node-rtsp-stream');

/**
 * RTSP Stream Handler
 * Handles RTSP to WebSocket streaming for web browser compatibility
 */
class RTSPStreamHandler {
  constructor(config) {
    this.cameraIP = config.cameraIP;
    this.cameraPort = config.cameraPort || 554; // RTSP default port
    this.username = config.username || 'admin';
    this.password = config.password || 'admin';
    this.wsPort = config.wsPort || 9999;
    this.fps = config.fps || 25; // Default 25 FPS for smooth playback
    this.bitrate = config.bitrate || '2M'; // Default 2Mbps bitrate
    
    this.stream = null;
    this.clients = new Set();
    this.rtspUrl = null;
    
    // Build RTSP URL patterns once for this camera
    this.rtspUrlPatterns = this.createRtspPatterns();
  }

  /**
   * Build RTSP URL patterns for the camera (ordered by preference).
   */
  createRtspPatterns() {
    // Encode credentials to handle special characters (e.g. @ in password)
    const user = encodeURIComponent(this.username);
    const pass = encodeURIComponent(this.password);
    const base = `rtsp://${user}:${pass}@${this.cameraIP}:${this.cameraPort}`;
    return [
      // Sub-stream options (smoother / lower bandwidth)
      `${base}/live1s1.sdp`,
      `${base}/live2s1.sdp`,
      `${base}/videoSub`,
      `${base}/Streaming/Channels/102`,
      // Main stream options (higher quality)
      `${base}/live1s0.sdp`,
      `${base}/live2s0.sdp`,
      `${base}/videoMain`,
      `${base}/Streaming/Channels/101`,
      // Generic fallback
      `${base}/live.sdp`
    ];
  }

  /**
   * Get RTSP URL (use first pattern or custom if provided)
   */
  getRTSPUrl(customUrl = null) {
    if (customUrl) {
      return customUrl;
    }
    // Use first pattern as default
    return this.rtspUrlPatterns[0];
  }

  /**
   * Calculate max bitrate (125% of base bitrate)
   */
  calculateMaxRate() {
    const base = parseFloat(this.bitrate);
    const unit = this.bitrate.replace(/[\d.]/g, '');
    return `${(base * 1.25).toFixed(1)}${unit}`;
  }

  /**
   * Calculate buffer size (2.5x maxrate for smoothness)
   */
  calculateBufSize() {
    const maxRate = this.calculateMaxRate();
    const base = parseFloat(maxRate);
    const unit = maxRate.replace(/[\d.]/g, '');
    return `${(base * 2.5).toFixed(1)}${unit}`;
  }

  /**
   * Calculate min bitrate (50% of base bitrate)
   */
  calculateMinRate() {
    const base = parseFloat(this.bitrate);
    const unit = this.bitrate.replace(/[\d.]/g, '');
    return `${(base * 0.5).toFixed(1)}${unit}`;
  }

  /**
   * Build FFmpeg options for low-latency, browser-friendly streaming.
   */
  buildFfmpegOptions() {
    return {
      // Input settings - optimize for smooth streaming
      '-rtsp_transport': 'tcp', // Use TCP for reliable delivery (smoother than UDP)
      '-thread_queue_size': '512', // Larger queue for smoother input
      '-analyzeduration': '10000000', // 10s analysis for stream parameters
      '-probesize': '5000000', // Probe up to ~5MB to detect stream
      
      // Video codec and quality settings - optimized for performance
      '-c:v': 'libx264', // H.264 codec
      '-preset': 'ultrafast', // Fast encoding for low latency
      '-tune': 'zerolatency', // Zero latency tuning
      '-profile:v': 'baseline', // Baseline profile for compatibility
      '-pix_fmt': 'yuv420p', // Pixel format for compatibility
      '-threads': '2', // Limit CPU threads for better stability
      
      // Frame rate - configurable FPS for smooth playback
      '-r': this.fps,
      '-g': this.fps * 2, // GOP size (2 seconds)
      '-keyint_min': this.fps, // Minimum keyframe interval
      
      // Bitrate and buffer settings for smooth streaming
      '-b:v': this.bitrate, // Video bitrate
      '-maxrate': this.calculateMaxRate(), // Maximum bitrate (with buffer)
      '-bufsize': this.calculateBufSize(), // Buffer size (2.5x maxrate for smoothness)
      '-minrate': this.calculateMinRate(), // Minimum bitrate
      
      // X264 encoding optimizations for smoother playback
      '-x264opts': 'no-mbtree:no-cabac:ref=1:8x8dct=0:weightp=0', // Faster encoding, less CPU
      
      // Low latency and smooth playback settings
      '-fflags': 'nobuffer+fastseek+genpts', // No buffering + fast seeking + generate PTS
      '-flags': 'low_delay', // Low delay flag
      '-strict': 'experimental',
      '-avoid_negative_ts': 'make_zero',
      
      // Output format
      '-f': 'mpegts', // MPEG-TS format for streaming
      '-muxdelay': '0', // No muxing delay
      '-muxpreload': '0' // No preload delay
    };
  }

  /**
   * Check if port is available
   */
  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const net = require('net');
      const server = net.createServer();
      
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          resolve(false);
        }
        server.close();
      });

      server.once('listening', () => {
        server.close();
        resolve(true);
      });

      server.listen(port);
    });
  }

  /**
   * Wait for port to be released (with timeout)
   */
  async waitForPortRelease(port, maxWaitMs = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      if (await this.isPortAvailable(port)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return false;
  }

  /**
   * Start RTSP stream
   */
  async startStream(customRTSPUrl = null) {
    // Always stop existing stream first
    if (this.stream) {
      console.log('Stopping existing RTSP stream...');
      this.stopStream();
      // Wait for port to be released
      const portReleased = await this.waitForPortRelease(this.wsPort, 3000);
      if (!portReleased) {
        throw new Error(`Port ${this.wsPort} is still in use after stopping stream. Please wait a moment and try again.`);
      }
    }

    this.rtspUrl = this.getRTSPUrl(customRTSPUrl);
    console.log(`Starting RTSP stream from: ${this.rtspUrl.replace(/:[^:@]+@/, ':****@')}`);

    try {
      // Check if port is available
      const portAvailable = await this.isPortAvailable(this.wsPort);
      if (!portAvailable) {
        console.log(`⚠️  Port ${this.wsPort} is in use. Waiting for release...`);
        const released = await this.waitForPortRelease(this.wsPort, 5000);
        if (!released) {
          throw new Error(`Port ${this.wsPort} is still in use. Another process may be using it.`);
        }
      }

      // Create RTSP stream (node-rtsp-stream will create its own WebSocket server)
      this.stream = new Stream({
        name: 'camera-stream',
        streamUrl: this.rtspUrl,
        wsPort: this.wsPort,
        ffmpegOptions: this.buildFfmpegOptions()
      });

      this.stream.on('exit', (code, signal) => {
        console.error(`RTSP stream process exited with code ${code}, signal ${signal}`);
        this.stream = null;
        
        // Attempt to restart if there are clients
        if (this.clients.size > 0) {
          console.log('Attempting to restart RTSP stream...');
          setTimeout(() => {
            if (this.clients.size > 0) {
              this.startStream(customRTSPUrl);
            }
          }, 2000);
        }
      });

      // Handle stream errors
      this.stream.on('error', (error) => {
        console.error('RTSP stream error:', error.message);
        this.stream = null;
      });

      console.log('✓ RTSP stream started successfully');
    } catch (error) {
      console.error('Failed to start RTSP stream:', error.message);
      this.stream = null;
      throw error;
    }
  }

  /**
   * Stop RTSP stream
   */
  stopStream() {
    if (this.stream) {
      try {
        this.stream.stop();
        this.stream = null;
        console.log('RTSP stream stopped');
      } catch (error) {
        console.error('Error stopping RTSP stream:', error.message);
        this.stream = null;
      }
    }
  }

  /**
   * Get WebSocket URL for client connection
   */
  getWebSocketUrl() {
    return `ws://localhost:${this.wsPort}`;
  }

  /**
   * Check if stream is active
   */
  isStreamActive() {
    return this.stream !== null;
  }

  /**
   * Get active client count
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * Cleanup - stop stream and close WebSocket server
   */
  async cleanup() {
    this.stopStream();
    
    // node-rtsp-stream manages its own WebSocket server
    // Just clear clients and wait for port to be released
    this.clients.clear();
    
    // Wait a bit for port to be fully released
    await this.waitForPortRelease(this.wsPort, 2000);
    console.log('RTSP cleanup completed');
  }
}

module.exports = RTSPStreamHandler;

