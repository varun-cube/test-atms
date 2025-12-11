const axios = require('axios');

/**
 * Camera Controller
 * Handles camera snapshot retrieval and basic camera operations
 */
class CameraController {
  constructor(config) {
    this.ip = config.ip;
    this.port = config.port || 80;
    this.username = config.username || 'admin';
    this.password = config.password || 'admin';
    this.protocol = config.protocol || 'http';
    this.baseUrl = `${this.protocol}://${this.ip}:${this.port}`;
    
    // Cache for working snapshot endpoint
    this.workingSnapshotEndpoint = null;
    this.snapshotEndpointFailCount = 0;
    this.maxFailuresBeforeRetry = 3;
    this.snapshotEndpoints = [
      // Vivotek SD9384/SD9368 specific endpoints (confirmed working)
      '/cgi-bin/viewer/video.jpg',
      '/cgi-bin/video.jpg',
      '/cgi-bin/viewer/video.jpg?channel=1',
      '/cgi-bin/viewer/video.jpg?channel=1&subtype=0',
      '/cgi-bin/snapshot.cgi?channel=1',
      '/cgi-bin/snapshot.cgi',
      // Hikvision
      '/ISAPI/Streaming/channels/1/picture',
      '/ISAPI/Streaming/channels/101/picture',
      '/Streaming/channels/1/picture',
      '/Streaming/channels/101/picture',
      // Dahua
      '/cgi-bin/snapshot.cgi?channel=1',
      '/cgi-bin/snapshot.cgi',
      '/snapshot.cgi?channel=1',
      // Generic IP Camera
      '/snapshot.jpg',
      '/snapshot.jpeg',
      '/image.jpg',
      '/image.jpeg',
      '/jpg/image.jpg',
      '/jpg/image.cgi',
      // Axis
      '/axis-cgi/jpg/image.cgi',
      '/axis-cgi/jpg/image.cgi?resolution=640x480',
      // Other common endpoints
      '/video.jpg',
      '/video.mjpg',
      '/img/snapshot.cgi',
      '/api/camera/snapshot'
    ];
    
    // Create axios instance with authentication
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000, // 10 second timeout for general requests
      auth: {
        username: this.username,
        password: this.password
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Get camera information
   */
  async getCameraInfo() {
    try {
      const endpoints = [
        '/ISAPI/System/deviceInfo',
        '/cgi-bin/magicBox.cgi?action=getDeviceClass',
        '/api/system/deviceinfo',
        '/onvif/device_service'
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await this.httpClient.get(endpoint);
          return {
            ip: this.ip,
            port: this.port,
            protocol: this.protocol,
            info: response.data
          };
        } catch (e) {
          continue;
        }
      }

      return {
        ip: this.ip,
        port: this.port,
        protocol: this.protocol,
        status: 'connected',
        message: 'Camera connected but info endpoint not found'
      };
    } catch (error) {
      throw new Error(`Failed to get camera info: ${error.message}`);
    }
  }

  /**
   * Get camera snapshot
   * Uses cached working endpoint for performance, falls back to discovery if needed
   */
  async getSnapshot() {
    try {
      // If we have a cached working endpoint, try it first
      if (this.workingSnapshotEndpoint) {
        try {
          const response = await this.httpClient.get(this.workingSnapshotEndpoint, {
            responseType: 'arraybuffer',
            timeout: 8000, // Increased timeout to 8 seconds
            validateStatus: (status) => status === 200
          });
          
          if (response.data && response.data.length > 0) {
            const buffer = Buffer.from(response.data);
            if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
              this.snapshotEndpointFailCount = 0;
              return buffer;
            }
          }
        } catch (e) {
          this.snapshotEndpointFailCount++;
          
          if (this.snapshotEndpointFailCount >= this.maxFailuresBeforeRetry) {
            console.log(`⚠️  Cached snapshot endpoint failed ${this.maxFailuresBeforeRetry} times, rediscovering...`);
            this.workingSnapshotEndpoint = null;
            this.snapshotEndpointFailCount = 0;
          }
        }
      }

      let lastError = null;
      for (const endpoint of this.snapshotEndpoints) {
        try {
          const response = await this.httpClient.get(endpoint, {
            responseType: 'arraybuffer',
            timeout: 8000, // Increased timeout to 8 seconds
            validateStatus: (status) => status === 200
          });
          
          if (response.data && response.data.length > 0) {
            const buffer = Buffer.from(response.data);
            if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
              if (this.workingSnapshotEndpoint !== endpoint) {
                console.log(`✓ Snapshot endpoint found: ${endpoint}`);
                this.workingSnapshotEndpoint = endpoint;
              }
              this.snapshotEndpointFailCount = 0;
              return buffer;
            }
          }
        } catch (e) {
          lastError = e;
          continue;
        }
      }

      throw new Error(`Snapshot endpoint not found. Last error: ${lastError?.response?.status === 404 ? '404 Not Found' : lastError?.message || 'Unknown'}`);
    } catch (error) {
      // Only log error if we don't have a working endpoint cached (to avoid spam)
      // The server.js will handle logging for background refresh failures
      if ((this.snapshotEndpointFailCount === 0 || !this.workingSnapshotEndpoint) && !error.message.includes('timeout')) {
        // Don't log timeout errors here - they're expected during discovery
      }
      throw new Error(`Get snapshot failed: ${error.message}`);
    }
  }

  /**
   * Get camera status
   */
  async getStatus() {
    try {
      const info = await this.getCameraInfo();
      return {
        connected: true,
        ip: this.ip,
        port: this.port,
        protocol: this.protocol,
        timestamp: new Date().toISOString(),
        info
      };
    } catch (error) {
      return {
        connected: false,
        ip: this.ip,
        port: this.port,
        protocol: this.protocol,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = CameraController;

