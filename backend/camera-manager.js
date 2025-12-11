const CameraController = require('./camera-controller');
const VideoStreamProxy = require('./video-stream-proxy');
const RTSPStreamHandler = require('./rtsp-stream-handler');

/**
 * CameraManager
 * Manages multiple camera instances (controller, proxy, RTSP handler) keyed by cameraId.
 */
class CameraManager {
  constructor(initialConfigs = []) {
    this.cameras = new Map();

    const configs = Array.isArray(initialConfigs)
      ? initialConfigs
      : [initialConfigs];

    configs.filter(Boolean).forEach((cfg) => {
      this.registerCamera(cfg);
    });
  }

  /**
   * Register a camera configuration and create its helpers.
   * @param {Object} cfg - camera configuration
   * @param {string} cfg.id - unique camera id
   * @param {string} cfg.ip - camera IP
   * @param {number} cfg.port - camera HTTP port
   * @param {number} cfg.rtspPort - camera RTSP port
   * @param {string} cfg.username - camera username
   * @param {string} cfg.password - camera password
   * @param {string} cfg.protocol - http/https
   * @param {number} cfg.wsPort - websocket port for RTSP ws bridge
   * @param {number|string} cfg.bitrate - bitrate string e.g. "1.5M"
   * @param {number} cfg.fps - frame rate
   */
  registerCamera(cfg = {}) {
    const id = cfg.id || cfg.cameraId || 'default';
    if (!id) {
      throw new Error('camera id is required');
    }

    const cameraConfig = {
      id,
      ip: cfg.ip,
      port: cfg.port || 80,
      rtspPort: cfg.rtspPort || 554,
      username: cfg.username || 'admin',
      password: cfg.password || 'admin',
      protocol: cfg.protocol || 'http',
      wsPort: cfg.wsPort || 9999,
      fps: cfg.fps || 20,
      bitrate: cfg.bitrate || '1.5M'
    };

    const controller = new CameraController({
      ip: cameraConfig.ip,
      port: cameraConfig.port,
      username: cameraConfig.username,
      password: cameraConfig.password,
      protocol: cameraConfig.protocol
    });

    const proxy = new VideoStreamProxy({
      cameraIP: cameraConfig.ip,
      cameraPort: cameraConfig.port,
      username: cameraConfig.username,
      password: cameraConfig.password
    });

    const rtsp = new RTSPStreamHandler({
      cameraIP: cameraConfig.ip,
      cameraPort: cameraConfig.rtspPort,
      username: cameraConfig.username,
      password: cameraConfig.password,
      wsPort: cameraConfig.wsPort,
      fps: cameraConfig.fps,
      bitrate: cameraConfig.bitrate
    });

    this.cameras.set(id, {
      id,
      config: cameraConfig,
      controller,
      proxy,
      rtsp
    });

    return { id, config: cameraConfig };
  }

  /**
   * Get camera object or throw if not found.
   */
  getCameraOrThrow(cameraId = 'default') {
    const cam = this.cameras.get(cameraId);
    if (!cam) {
      throw new Error(`Camera '${cameraId}' not found`);
    }
    return cam;
  }

  /**
   * List registered camera ids.
   */
  listCameras() {
    return Array.from(this.cameras.keys());
  }
}

module.exports = CameraManager;

