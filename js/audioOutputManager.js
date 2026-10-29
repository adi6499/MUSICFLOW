// ==========================================================================
// MUSICFLOW — AUDIO OUTPUT & BLUETOOTH / CAST ROUTING ENGINE
// Real Hardware Device Enumeration, Audio Sink Selection (setSinkId),
// Remote Cast Playback & Live Device Change Detection
// ==========================================================================

const AudioOutputManager = (() => {
  let availableDevices = [];
  let activeDeviceId = 'default';
  let activeDeviceLabel = 'Default Audio Output';
  let activeDeviceType = 'default'; // 'bluetooth' | 'headphones' | 'speaker' | 'cast' | 'default'
  let isInitialized = false;

  const listeners = {
    devicesChanged: [],
    outputChanged: []
  };

  function notify(event, data) {
    (listeners[event] || []).forEach(cb => {
      try { cb(data); } catch (e) { console.error(e); }
    });
  }

  function detectDeviceType(label) {
    if (!label) return 'default';
    const l = label.toLowerCase();
    if (l.includes('bluetooth') || l.includes('tws') || l.includes('airpods') || l.includes('buds') ||
        l.includes('tune') || l.includes('wh-') || l.includes('wf-') || l.includes('wireless') || l.includes('bt')) {
      return 'bluetooth';
    }
    if (l.includes('headphone') || l.includes('headset') || l.includes('earphone') || l.includes('jack') || l.includes('3.5mm')) {
      return 'headphones';
    }
    if (l.includes('cast') || l.includes('chromecast') || l.includes('display') || l.includes('tv') || l.includes('airplay')) {
      return 'cast';
    }
    if (l.includes('speaker') || l.includes('realtek') || l.includes('internal') || l.includes('built-in') || l.includes('audio output')) {
      return 'speaker';
    }
    return 'default';
  }

  function getDeviceIcon(type) {
    switch (type) {
      case 'bluetooth': return 'bluetooth';
      case 'headphones': return 'headphones';
      case 'cast': return 'cast';
      case 'speaker': return 'volume_up';
      default: return 'speaker';
    }
  }

  async function enumerateAudioDevices() {
    // 1. Android Native Bridge: Query real hardware audio outputs from AudioManager
    if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.getConnectedAudioOutputs === 'function') {
      try {
        const rawJson = window.AndroidMediaBridge.getConnectedAudioOutputs();
        if (rawJson) {
          const parsed = JSON.parse(rawJson);
          if (Array.isArray(parsed) && parsed.length > 0) {
            availableDevices = parsed.map(d => ({
              id: d.id,
              label: d.label,
              type: d.type || detectDeviceType(d.label),
              isDefault: !!d.isDefault,
              isConnected: !!d.isConnected
            }));
            return availableDevices;
          }
        }
      } catch (err) {
        console.warn('[AudioOutputManager] AndroidMediaBridge.getConnectedAudioOutputs error:', err);
      }
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return fallbackDevices();
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputDevices = devices.filter(d => d.kind === 'audiooutput');

      if (!outputDevices || outputDevices.length === 0) {
        return fallbackDevices();
      }

      availableDevices = outputDevices.map((d, index) => {
        let label = d.label || (d.deviceId === 'default' ? 'Default Audio Output' : `Audio Device ${index + 1}`);
        const type = detectDeviceType(label);
        return {
          id: d.deviceId || `device_${index}`,
          label,
          type,
          isDefault: d.deviceId === 'default' || index === 0
        };
      });

      // If browser hid device labels due to privacy permission, provide smart output options
      const allEmptyLabels = availableDevices.every(d => !d.label || d.label.startsWith('Audio Device'));
      if (allEmptyLabels) {
        return fallbackDevices();
      }

      return availableDevices;
    } catch (e) {
      console.warn('[AudioOutputManager] enumerateDevices failed:', e);
      return fallbackDevices();
    }
  }

  function fallbackDevices() {
    availableDevices = [
      { id: 'default', label: 'Default System Output (Speakers / Headphones)', type: 'speaker', isDefault: true },
      { id: 'internal_speaker', label: 'Phone / Device Speaker', type: 'speaker', isDefault: false },
      { id: 'bluetooth_output', label: 'Bluetooth / Connected Headset', type: 'bluetooth', isDefault: false },
      { id: 'cast_stream', label: 'Google Cast / Wireless Display', type: 'cast', isDefault: false }
    ];
    return availableDevices;
  }

  async function init() {
    if (isInitialized) return;
    isInitialized = true;

    // Load saved audio output device if present
    if (typeof Storage !== 'undefined' && Storage.getSelectedAudioOutput) {
      const saved = Storage.getSelectedAudioOutput();
      if (saved && saved.id) {
        activeDeviceId = saved.id;
        activeDeviceLabel = saved.label || 'Connected Audio Device';
        activeDeviceType = saved.type || detectDeviceType(activeDeviceLabel);
      }
    }

    await refreshDevices();

    // Listen for live hardware changes (Bluetooth connect/disconnect, USB DAC plug)
    if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', async () => {
        console.log('[AudioOutputManager] Hardware audio devices changed. Refreshing...');
        await refreshDevices();
        updateUI();
      });
    }

    updateUI();
  }

  async function refreshDevices() {
    const devs = await enumerateAudioDevices();
    // Validate active device
    const exists = devs.find(d => d.id === activeDeviceId);
    if (!exists && devs.length > 0) {
      // Prioritize active Bluetooth device if one is connected
      const btDevice = devs.find(d => d.type === 'bluetooth' && (d.isDefault || d.isConnected));
      if (btDevice) {
        activeDeviceId = btDevice.id;
        activeDeviceLabel = btDevice.label;
        activeDeviceType = btDevice.type;
      } else {
        activeDeviceId = devs[0].id;
        activeDeviceLabel = devs[0].label;
        activeDeviceType = devs[0].type;
      }
    } else if (exists) {
      activeDeviceLabel = exists.label;
      activeDeviceType = exists.type;
    }
    notify('devicesChanged', availableDevices);
    return availableDevices;
  }

  async function selectDevice(deviceId) {
    const target = availableDevices.find(d => d.id === deviceId) || { id: deviceId, label: 'Audio Device', type: 'default' };
    
    // Cast Handling
    if (target.type === 'cast' || target.id === 'cast_stream') {
      promptCastSession();
      return true;
    }

    activeDeviceId = target.id;
    activeDeviceLabel = target.label;
    activeDeviceType = target.type;

    // Apply sink to Player audio element if supported (avoid passing synthetic IDs into setSinkId)
    if (typeof Player !== 'undefined' && Player.setAudioSink) {
      const isSynthetic = ['bluetooth_output', 'internal_speaker'].includes(target.id) || target.id.startsWith('dev_');
      const sinkToSet = (target.id === 'default' || isSynthetic) ? '' : target.id;
      try {
        await Player.setAudioSink(sinkToSet);
      } catch (_) {}
    }

    // Persist selection
    if (typeof Storage !== 'undefined' && Storage.setSelectedAudioOutput) {
      Storage.setSelectedAudioOutput(activeDeviceId, activeDeviceLabel, activeDeviceType);
    }

    updateUI();
    notify('outputChanged', { id: activeDeviceId, label: activeDeviceLabel, type: activeDeviceType });

    if (typeof UI !== 'undefined' && UI.showToast) {
      UI.showToast(`Audio output routed to "${activeDeviceLabel}" 🎧`);
    }

    return true;
  }

  function promptCastSession() {
    const audioEl = (typeof Player !== 'undefined' && Player.getAudioElement) ? Player.getAudioElement() : document.querySelector('audio');
    if (audioEl && audioEl.remote && typeof audioEl.remote.prompt === 'function') {
      audioEl.remote.prompt().then(() => {
        if (typeof UI !== 'undefined' && UI.showToast) {
          UI.showToast('Connecting to Cast display... 📺');
        }
      }).catch(err => {
        console.warn('[AudioOutputManager] Remote playback prompt canceled/failed:', err);
        if (typeof UI !== 'undefined' && UI.showToast) {
          UI.showToast('Cast device selection closed or unavailable.');
        }
      });
      return;
    }

    if (typeof UI !== 'undefined' && UI.showToast) {
      UI.showToast('Google Cast: Use Android Quick Settings or Cast Screen to connect 📺');
    }
  }

  function openBluetoothOrExternalScan() {
    if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.openBluetoothSettings === 'function') {
      try {
        window.AndroidMediaBridge.openBluetoothSettings();
        if (typeof UI !== 'undefined' && UI.showToast) {
          UI.showToast('Opening Bluetooth Settings to connect device 🎧');
        }
        return;
      } catch (e) {
        console.warn('[AudioOutputManager] openBluetoothSettings error:', e);
      }
    }
    // Web / Desktop fallback
    requestAudioPermissions();
  }

  function openSystemAudioSwitcher() {
    if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.openSystemAudioSwitcher === 'function') {
      try {
        window.AndroidMediaBridge.openSystemAudioSwitcher();
        return;
      } catch (e) {
        console.warn('[AudioOutputManager] openSystemAudioSwitcher error:', e);
      }
    }
    openBluetoothOrExternalScan();
  }

  function onDevicesChanged(devicesJson) {
    try {
      const devices = typeof devicesJson === 'string' ? JSON.parse(devicesJson) : devicesJson;
      if (Array.isArray(devices) && devices.length > 0) {
        availableDevices = devices.map(d => ({
          id: d.id,
          label: d.label,
          type: d.type || detectDeviceType(d.label),
          isDefault: !!d.isDefault,
          isConnected: !!d.isConnected
        }));

        // Prioritize active Bluetooth device if one is connected
        const bt = availableDevices.find(d => d.type === 'bluetooth' && (d.isDefault || d.isConnected));
        if (bt) {
          activeDeviceId = bt.id;
          activeDeviceLabel = bt.label;
          activeDeviceType = 'bluetooth';
        } else {
          const def = availableDevices.find(d => d.isDefault) || availableDevices[0];
          activeDeviceId = def.id;
          activeDeviceLabel = def.label;
          activeDeviceType = def.type;
        }

        updateUI();
        renderOutputSheet();
        notify('devicesChanged', availableDevices);
        notify('outputChanged', { id: activeDeviceId, label: activeDeviceLabel, type: activeDeviceType });

        if (typeof Player !== 'undefined' && Player.onAudioOutputChanged) {
          Player.onAudioOutputChanged(activeDeviceId, activeDeviceLabel, activeDeviceType);
        }
      }
    } catch (e) {
      console.warn('[AudioOutputManager] onDevicesChanged error:', e);
    }
  }

  async function requestAudioPermissions() {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately stop tracks after getting permission
        stream.getTracks().forEach(t => t.stop());
        await refreshDevices();
        updateUI();
        renderOutputSheet();
        if (typeof UI !== 'undefined' && UI.showToast) {
          UI.showToast('Detected hardware audio devices! 🎵');
        }
      } catch (e) {
        console.warn('[AudioOutputManager] Microphone/Audio permission declined:', e);
      }
    }
  }

  function updateUI() {
    const nameEl = document.getElementById('player-device-name');
    const statusEl = document.getElementById('player-device-status');
    const iconEl = document.getElementById('player-device-icon');

    if (nameEl) {
      nameEl.textContent = activeDeviceLabel || 'Connected Audio Device';
    }
    if (statusEl) {
      statusEl.textContent = (activeDeviceType === 'bluetooth') ? 'Connected' : 'Active Output';
      statusEl.style.color = (activeDeviceType === 'bluetooth') ? 'var(--accent)' : 'rgba(255, 255, 255, 0.7)';
    }
    if (iconEl) {
      iconEl.textContent = getDeviceIcon(activeDeviceType);
      iconEl.style.color = (activeDeviceType === 'bluetooth') ? 'var(--accent)' : '#FFFFFF';
    }
  }

  function renderOutputSheet() {
    const listContainer = document.getElementById('audio-output-devices-list');
    if (!listContainer) return;

    listContainer.innerHTML = availableDevices.map(dev => {
      const isSelected = dev.id === activeDeviceId;
      const icon = getDeviceIcon(dev.type);
      return `
        <div class="audio-output-item ${isSelected ? 'active' : ''}" onclick="AudioOutputManager.selectDevice('${dev.id}')" role="button" aria-label="${dev.label}">
          <div class="audio-output-left">
            <span class="material-symbols-outlined audio-output-icon" style="color:${dev.type === 'bluetooth' ? 'var(--accent)' : '#FFFFFF'};">${icon}</span>
            <div class="audio-output-info">
              <span class="audio-output-title">${dev.label}</span>
              <span class="audio-output-sub">${dev.type.toUpperCase()}${dev.isDefault ? ' • SYSTEM DEFAULT' : ''}</span>
            </div>
          </div>
          ${isSelected ? `
            <span class="material-symbols-outlined audio-output-check" style="color:var(--accent); font-size:22px;">check_circle</span>
          ` : `
            <span class="material-symbols-outlined" style="color:rgba(255,255,255,0.2); font-size:20px;">radio_button_unchecked</span>
          `}
        </div>
      `;
    }).join('');
  }

  return {
    init,
    refreshDevices,
    selectDevice,
    promptCastSession,
    requestAudioPermissions,
    openBluetoothOrExternalScan,
    openSystemAudioSwitcher,
    onDevicesChanged,
    getAvailableDevices: () => [...availableDevices],
    getActiveDevice: () => ({ id: activeDeviceId, label: activeDeviceLabel, type: activeDeviceType }),
    renderOutputSheet,
    updateUI,
    on: (evt, cb) => { if (listeners[evt]) listeners[evt].push(cb); }
  };
})();

if (typeof window !== 'undefined') {
  window.AudioOutputManager = AudioOutputManager;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioOutputManager;
}
