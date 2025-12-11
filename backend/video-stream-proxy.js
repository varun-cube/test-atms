const http = require('http');
const { URL } = require('url');

/**
 * Video Stream Proxy
 * Proxies HTTP MJPEG streams to web-compatible formats
 */
class VideoStreamProxy {
  constructor(config) {
    this.cameraIP = config.cameraIP;
    this.cameraPort = config.cameraPort || 80;
    this.username = config.username || 'admin';
    this.password = config.password || 'admin';
    this.workingMJPEGUrl = null; // Cache working MJPEG URL
    this.mjpegPaths = [
      // Vivotek SD9384/SD9368 specific MJPEG endpoints
      '/cgi-bin/viewer/video.mjpg',
      '/cgi-bin/viewer/video.mjpeg',
      '/cgi-bin/viewer/video.mjpg?channel=1&subtype=0',
      '/cgi-bin/viewer/video.mjpg?channel=1&subtype=1',
      // Alternative Vivotek MJPEG formats
      '/cgi-bin/video.mjpg',
      '/cgi-bin/mjpg/video.cgi?channel=1&subtype=0',
      '/cgi-bin/mjpg/video.cgi?channel=1&subtype=1',
      // Generic formats
      '/video.mjpg',
      '/stream/video.mjpeg'
    ];
  }

  /**
   * Get stream URL
   */
  getStreamUrl() {
    if (this.workingMJPEGUrl) {
      return this.workingMJPEGUrl;
    }

    const [first] = this.buildCandidateUrls();
    return first;
  }

  /**
   * Test and cache working MJPEG URL
   */
  async findWorkingMJPEGUrl() {
    if (this.workingMJPEGUrl) {
      return this.workingMJPEGUrl;
    }

    const streamUrls = this.buildCandidateUrls();

    for (const url of streamUrls) {
      try {
        const urlObj = new URL(url);
        const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || 80,
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Connection': 'keep-alive'
          },
          timeout: 3000
        };

        const response = await new Promise((resolve) => {
          const req = http.request(options, (res) => {
            if (res.statusCode === 200) {
              const contentType = res.headers['content-type'] || '';
              if (contentType.includes('multipart') || contentType.includes('mjpeg') || contentType.includes('mjpg')) {
                resolve({ success: true, url });
              } else {
                resolve({ success: false });
              }
            } else {
              resolve({ success: false });
            }
            res.on('data', () => {});
            res.on('end', () => {});
          });
          req.on('error', () => resolve({ success: false }));
          req.on('timeout', () => {
            req.destroy();
            resolve({ success: false });
          });
          req.end();
        });

        if (response.success) {
          this.workingMJPEGUrl = url;
          console.log(`✓ Found working MJPEG stream: ${urlObj.pathname}`);
          return url;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  /**
   * Build full MJPEG URLs with credentials from path list.
   */
  buildCandidateUrls() {
    const base = `http://${this.username}:${this.password}@${this.cameraIP}:${this.cameraPort}`;
    return this.mjpegPaths.map((path) => `${base}${path}`);
  }

  /**
   * Proxy MJPEG stream
   */
  async proxyStream(req, res) {
    try {
      // Try to find working MJPEG URL first if not cached
      if (!this.workingMJPEGUrl) {
        const foundUrl = await this.findWorkingMJPEGUrl();
        if (!foundUrl) {
          // No MJPEG available, return error so frontend can fall back to snapshot
          res.status(404).json({ 
            success: false, 
            error: 'MJPEG stream not available. Use snapshot endpoint instead.' 
          });
          return;
        }
      }

      const streamUrl = this.getStreamUrl();
      
      if (streamUrl.startsWith('http')) {
        return this.proxyHttpStream(streamUrl, req, res);
      } else {
        res.status(501).json({ 
          success: false, 
          error: 'RTSP streaming requires media server. Use WebRTC or convert to HLS.' 
        });
      }
    } catch (error) {
      // If MJPEG fails, clear cache and let frontend fall back to snapshot
      this.workingMJPEGUrl = null;
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  }

  /**
   * Proxy HTTP MJPEG stream
   */
  async proxyHttpStream(streamUrl, req, res) {
    return new Promise((resolve, reject) => {
      try {
        const url = new URL(streamUrl);
        const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');

        const options = {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Connection': 'keep-alive',
            'User-Agent': 'Mozilla/5.0'
          },
          timeout: 15000 // Increased timeout to 15 seconds
        };

        const proxyReq = http.request(options, (proxyRes) => {
          // Check if response is valid
          if (proxyRes.statusCode !== 200) {
            proxyReq.destroy();
            if (!res.headersSent) {
              reject(new Error(`Camera returned status ${proxyRes.statusCode}`));
            }
            return;
          }

          const contentType = proxyRes.headers['content-type'] || 'multipart/x-mixed-replace; boundary=--myboundary';
          
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
          res.setHeader('X-Accel-Buffering', 'no');

          proxyRes.on('error', (error) => {
            if (!res.headersSent) {
              // Clear cache on error so we can try other endpoints next time
              this.workingMJPEGUrl = null;
              reject(error);
            }
          });

          proxyRes.pipe(res, { end: false });

          proxyRes.on('end', () => {
            if (!res.headersSent) {
              resolve();
            }
          });
        });

        proxyReq.on('error', (error) => {
          // Clear cache on error
          this.workingMJPEGUrl = null;
          if (!res.headersSent) {
            reject(error);
          }
        });

        proxyReq.on('timeout', () => {
          proxyReq.destroy();
          // Clear cache on timeout
          this.workingMJPEGUrl = null;
          if (!res.headersSent) {
            reject(new Error('Request timeout - MJPEG stream may not be available'));
          }
        });

        req.on('close', () => {
          proxyReq.destroy();
        });

        req.on('aborted', () => {
          proxyReq.destroy();
        });

        proxyReq.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = VideoStreamProxy;
