// Offscreen document: fetches video URLs with credentials and creates blob URLs.
// Extension pages bypass CORS via host_permissions + have DOM for URL.createObjectURL.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_VIDEO') {
    handleFetchVideo(message.payload);
    return false;
  }
});

async function handleFetchVideo(payload) {
  const { url, requestId } = payload;

  try {
    const response = await fetch(url, {
      credentials: 'include',
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

    // Create blob URL
    const blob = new Blob(chunks, { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);

    chrome.runtime.sendMessage({
      type: 'FETCH_COMPLETE',
      payload: { requestId, blobUrl, size: received },
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'FETCH_ERROR',
      payload: { requestId, error: err.message || String(err) },
    });
  }
}
