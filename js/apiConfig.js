// ==========================================================================
// MUSICFLOW — CENTRALIZED API CONFIGURATION & ENVIRONMENT DETECTOR
// Determines base URLs, endpoints, and fallbacks for:
// - Android APK / WebView (file:///android_asset/...) -> Deployed Production HTTPS
// - Desktop Development (localhost:3000 / 127.0.0.1)  -> Local Node Server
// - Production Web App (https://...)                 -> HTTPS Origin / Host
// ==========================================================================

const ApiConfig = (() => {
  // Production API Base (Deployed on Vercel)
  const PRODUCTION_API_BASE = 'https://spoton-sigma.vercel.app';
  const PRODUCTION_JIOSAAVN_API_BASE = 'https://spoton-sigma.vercel.app/api';
  // Local Development API Base URL
  const DEV_API_BASE = 'http://localhost:3000';

  /**
   * Detects if the app is currently running inside an Android APK / WebView environment
   */
  function isRunningInAndroid() {
    if (typeof window === 'undefined' || !window.location) return false;
    const protocol = window.location.protocol || '';
    const href = window.location.href || '';
    const userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    return (
      protocol === 'file:' ||
      href.startsWith('file:///android_asset/') ||
      href.includes('androidplatform.net') ||
      /MusicFlowApp|Android.*wv|Version\/.*Chrome/i.test(userAgent) ||
      (typeof window.AndroidMediaBridge !== 'undefined')
    );
  }

  /**
   * Detects if the app is currently running inside an iOS App / Capacitor WKWebView environment
   */
  function isRunningInIOS() {
    if (typeof window === 'undefined' || !window.location) return false;
    const protocol = window.location.protocol || '';
    const href = window.location.href || '';
    const hostname = window.location.hostname || '';
    const userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const platform = (typeof navigator !== 'undefined' && navigator.platform) || '';
    const maxTouchPoints = (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0;

    const isCapacitor = typeof window.Capacitor !== 'undefined' || protocol === 'capacitor:';
    const isIOSDevice = /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
    const hasWebKitBridge = typeof window.webkit !== 'undefined' && typeof window.webkit.messageHandlers !== 'undefined';
    const isLocalhostHttps = protocol === 'https:' && hostname === 'localhost';

    return (
      (isCapacitor && isIOSDevice) ||
      protocol === 'capacitor:' ||
      protocol === 'ionic:' ||
      protocol === 'app:' ||
      (hasWebKitBridge && (isLocalhostHttps || href.includes('localhost') || isIOSDevice)) ||
      (isIOSDevice && hasWebKitBridge) ||
      (isIOSDevice && typeof window.webkit !== 'undefined' && (isLocalhostHttps || href.includes('localhost')))
    );
  }

  /**
   * Detects if running inside any native mobile container (Android APK or iOS App)
   */
  function isNativeApp() {
    return isRunningInAndroid() || isRunningInIOS();
  }

  /**
   * Detects if running in a local developer workstation browser
   */
  function isLocalDevelopment() {
    if (isNativeApp()) return false;
    if (typeof window === 'undefined' || !window.location) return false;

    const protocol = window.location.protocol || '';
    if (protocol === 'capacitor:' || protocol === 'ionic:' || protocol === 'app:' || protocol === 'file:') return false;
    if (typeof window.webkit !== 'undefined' && typeof window.webkit.messageHandlers !== 'undefined') return false;
    if (typeof window.Capacitor !== 'undefined') return false;

    const hostname = window.location.hostname || '';
    const href = window.location.href || '';
    const port = window.location.port || '';

    // WKWebView on iOS serves packaged assets on https://localhost without port — this is mobile container, NEVER desktop dev server
    if (protocol === 'https:' && (hostname === 'localhost' || hostname === '127.0.0.1') && (!port || port === '443')) {
      return false;
    }

    return (
      (hostname === 'localhost' && (port === '3000' || port === '5173' || port === '8080' || href.startsWith('http://localhost:'))) ||
      (hostname === '127.0.0.1' && (port === '3000' || port === '5173' || port === '8080' || href.startsWith('http://127.0.0.1:'))) ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      href.startsWith('http://localhost:3000') ||
      href.startsWith('http://127.0.0.1:3000')
    );
  }

  /**
   * Resolves the authoritative API Base URL for the current environment
   */
  function getApiBaseUrl() {
    if (typeof window === 'undefined') {
      return DEV_API_BASE;
    }
    // Explicit environment override
    if (window.MUSICFLOW_API_BASE && typeof window.MUSICFLOW_API_BASE === 'string') {
      return window.MUSICFLOW_API_BASE.replace(/\/+$/, '');
    }
    // Native Mobile App (Android APK or iOS App) -> strictly production host (never localhost)
    if (isNativeApp()) {
      return PRODUCTION_API_BASE;
    }
    // Local development browser -> local node server on port 3000
    if (isLocalDevelopment()) {
      return (window.location && window.location.origin) ? window.location.origin : DEV_API_BASE;
    }
    // Production Web deployed to cloud/HTTPS -> same origin or production host
    if (window.location && window.location.origin && window.location.origin.startsWith('https://') && !window.location.origin.includes('localhost')) {
      return window.location.origin;
    }
    return PRODUCTION_API_BASE;
  }

  // Production Update Metadata Endpoint (Instant High-Availability GitHub Raw CDN & Pages Fallback)
  const PRODUCTION_UPDATE_API_URL = 'https://raw.githubusercontent.com/adi6499/MUSICFLOW/main/api/update.json';
  const PRODUCTION_UPDATE_API_FALLBACK = 'https://adi6499.github.io/MUSICFLOW/api/update.json';

  /**
   * Returns JioSaavn API endpoint base URL (always the live Saavn service host)
   */
  function getJioSaavnApiBase() {
    // If running in local development browser -> use local server /api
    if (isLocalDevelopment()) {
      const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : DEV_API_BASE;
      return `${origin}/api`;
    }
    // Hosts with no /api forwarder (GitHub Pages) -> the catalog server directly (it allows any origin)
    if (typeof window !== 'undefined' && window.location && /\.github\.io$/i.test(window.location.hostname || '')) {
      return PRODUCTION_JIOSAAVN_API_BASE;
    }
    // If running on web in browser (Vercel: vercel.json forwards /api) -> use same origin /api
    if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin.startsWith('https://') && !window.location.origin.includes('localhost')) {
      return `${window.location.origin}/api`;
    }
    return PRODUCTION_JIOSAAVN_API_BASE;
  }

  /**
   * Safe stub for backwards-compatibility
   */
  function getYouTubeMusicApiBase() {
    return '';
  }

  /**
   * Returns production Update API endpoint URL
   */
  function getUpdateApiBase() {
    if (isLocalDevelopment()) {
      return `${DEV_API_BASE}/api/update`;
    }
    return PRODUCTION_UPDATE_API_URL;
  }

  /**
   * Returns fallback update URL in case of primary CDN failure
   */
  function getUpdateApiFallback() {
    return PRODUCTION_UPDATE_API_FALLBACK;
  }

  /**
   * Constructs full URL from relative path
   */
  function buildUrl(endpoint) {
    if (!endpoint || typeof endpoint !== 'string') return getApiBaseUrl();
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      return endpoint;
    }
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${getApiBaseUrl()}${cleanEndpoint}`;
  }

  /**
   * Returns true if production environment
   */
  function isProduction() {
    return isNativeApp() || !isLocalDevelopment();
  }

  return {
    PRODUCTION_API_BASE,
    PRODUCTION_JIOSAAVN_API_BASE,
    PRODUCTION_UPDATE_API_URL,
    PRODUCTION_UPDATE_API_FALLBACK,
    DEV_API_BASE,
    isRunningInAndroid,
    isRunningInIOS,
    isNativeApp,
    isLocalDevelopment,
    isProduction,
    getApiBaseUrl,
    getJioSaavnApiBase,
    getYouTubeMusicApiBase,
    getUpdateApiBase,
    getUpdateApiFallback,
    buildUrl
  };
})();

if (typeof window !== 'undefined') {
  window.ApiConfig = ApiConfig;
  try {
    console.log('[MusicFlow] AUDIO API BASE:', ApiConfig.getJioSaavnApiBase());
  } catch (_) {}
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApiConfig;
}
