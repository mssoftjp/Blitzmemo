export function normalizeMicLabel(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : 'undefined';
}

export async function refreshAudioInputDevices(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const next: { deviceId: string; label: string }[] = [];
    let systemDefaultLabel: string | null = null;
    const seen = new Set<string>();
    for (const device of devices) {
      if (device.kind !== 'audioinput') continue;
      const deviceId = typeof device.deviceId === 'string' ? device.deviceId.trim() : '';
      if (!deviceId) continue;
      if (deviceId === 'default') {
        systemDefaultLabel = normalizeMicLabel(device.label);
        continue;
      }
      if (seen.has(deviceId)) continue;
      seen.add(deviceId);
      next.push({ deviceId, label: normalizeMicLabel(device.label) });
    }
    window.voiceInput.notifySystemDefaultMicrophone(systemDefaultLabel);
    window.voiceInput.notifyAudioInputDevices(next);
  } catch {
    // ignore
  }
}

export function notifyActiveMicrophone(stream: MediaStream | null): void {
  if (!stream) {
    try {
      window.voiceInput.notifyActiveMicrophone(null);
    } catch {
      // ignore
    }
    return;
  }

  const track = stream.getAudioTracks()[0];
  if (!track) return;
  const settings = track.getSettings?.();
  const deviceIdRaw = typeof settings?.deviceId === 'string' ? settings.deviceId.trim() : '';
  try {
    window.voiceInput.notifyActiveMicrophone({
      deviceId: deviceIdRaw.length > 0 ? deviceIdRaw : null,
      label: normalizeMicLabel(track.label)
    });
  } catch {
    // ignore
  }
}

