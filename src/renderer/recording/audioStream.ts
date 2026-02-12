export type WarmAudioStream = { stream: MediaStream; requestedDeviceId: string | null };

export type AudioStreamResult = { stream: MediaStream; didFallback: boolean; requestedDeviceId: string | null };

export async function getAudioStream(
  deviceId: string | null,
  takeWarmAudioStream: (deviceId: string | null) => WarmAudioStream | null
): Promise<AudioStreamResult> {
  const warm = takeWarmAudioStream(deviceId);
  if (warm) {
    return { stream: warm.stream, didFallback: false, requestedDeviceId: warm.requestedDeviceId };
  }

  if (!deviceId) {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: true }),
      didFallback: false,
      requestedDeviceId: null
    };
  }
  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } }),
      didFallback: false,
      requestedDeviceId: deviceId
    };
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')
    ) {
      return {
        stream: await navigator.mediaDevices.getUserMedia({ audio: true }),
        didFallback: true,
        requestedDeviceId: null
      };
    }
    throw error;
  }
}

