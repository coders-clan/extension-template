// Offscreen document: fetches video URLs with credentials and creates blob URLs.
// Extension pages bypass CORS via host_permissions + have DOM for URL.createObjectURL.

// Track active downloads for pause/resume/cancel
const activeDownloads = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_VIDEO') {
    handleFetchVideo(message.payload);
    return false;
  }

  if (message.type === 'PAUSE_DOWNLOAD') {
    const dl = activeDownloads.get(message.payload.requestId);
    if (dl && !dl.paused) {
      dl.paused = true;
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_PAUSED',
        payload: { requestId: message.payload.requestId },
      });
    }
    return false;
  }

  if (message.type === 'RESUME_DOWNLOAD') {
    const dl = activeDownloads.get(message.payload.requestId);
    if (dl && dl.paused) {
      dl.paused = false;
      if (dl.resumeResolve) {
        dl.resumeResolve();
        dl.resumeResolve = null;
        dl.resumePromise = null;
      }
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_RESUMED',
        payload: { requestId: message.payload.requestId },
      });
    }
    return false;
  }

  if (message.type === 'CANCEL_DOWNLOAD') {
    const dl = activeDownloads.get(message.payload.requestId);
    if (dl) {
      dl.cancelled = true;
      dl.abortController.abort();
      // If paused, unblock the loop so it can exit
      if (dl.resumeResolve) {
        dl.resumeResolve();
        dl.resumeResolve = null;
      }
      activeDownloads.delete(message.payload.requestId);
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_CANCELLED',
        payload: { requestId: message.payload.requestId },
      });
    }
    return false;
  }
});

async function handleFetchVideo(payload) {
  const { url, requestId } = payload;

  const abortController = new AbortController();
  const dlState = {
    abortController,
    paused: false,
    cancelled: false,
    resumePromise: null,
    resumeResolve: null,
  };
  activeDownloads.set(requestId, dlState);

  try {
    const response = await fetch(url, {
      credentials: 'include',
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0');
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    let lastProgress = 0;

    while (true) {
      // Wait if paused
      if (dlState.paused) {
        dlState.resumePromise = new Promise((resolve) => {
          dlState.resumeResolve = resolve;
        });
        await dlState.resumePromise;
        // Check if cancelled while paused
        if (dlState.cancelled) break;
      }

      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      // Send progress updates every 5%
      if (contentLength > 0) {
        const pct = Math.round((received / contentLength) * 100);
        if (pct >= lastProgress + 5) {
          lastProgress = pct;
          chrome.runtime.sendMessage({
            type: 'FETCH_PROGRESS',
            payload: { requestId, pct, received, total: contentLength },
          });
        }
      }
    }

    if (dlState.cancelled) {
      // Already handled by CANCEL_DOWNLOAD handler
      return;
    }

    // Create blob URL
    const blob = new Blob(chunks, { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);

    activeDownloads.delete(requestId);

    chrome.runtime.sendMessage({
      type: 'FETCH_COMPLETE',
      payload: { requestId, blobUrl, size: received },
    });
  } catch (err) {
    activeDownloads.delete(requestId);
    // Don't send error for intentional cancellations
    if (dlState.cancelled) return;

    chrome.runtime.sendMessage({
      type: 'FETCH_ERROR',
      payload: { requestId, error: err.message || String(err) },
    });
  }
}
