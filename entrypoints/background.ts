export interface CapturedRecording {
  url: string;
  label: string;
  resolution: string;
  timestamp: number;
}

const capturedRecordings = new Map<number, CapturedRecording[]>();

// Track pending download requests (offscreen -> background -> content script)
const pendingDownloads = new Map<
  string,
  { tabId: number; filename: string }
>();
let requestCounter = 0;

function isZoomMp4Url(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'ssrweb.zoom.us' &&
      parsed.pathname.includes('.mp4')
    );
  } catch {
    return false;
  }
}

const BUNNY_MASTER_PLAYLIST = /^\/([0-9a-f-]{36})\/playlist\.m3u8$/i;

function getBunnyBase(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('.b-cdn.net')) return null;
    const match = parsed.pathname.match(BUNNY_MASTER_PLAYLIST);
    return match ? `${parsed.origin}/${match[1]}/` : null;
  } catch {
    return null;
  }
}

function isSupportedPageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.endsWith('.zoom.us') ||
      parsed.hostname === 'techspert.co.il' ||
      parsed.hostname.endsWith('.techspert.co.il')
    );
  } catch {
    return false;
  }
}

async function fetchBunnyRecordings(base: string): Promise<CapturedRecording[]> {
  const playlist = await fetch(`${base}playlist.m3u8`).then((r) => r.text());
  const heights = [...playlist.matchAll(/RESOLUTION=\d+x(\d+)/g)]
    .map((m) => parseInt(m[1]))
    .sort((a, b) => b - a);

  const found: CapturedRecording[] = [];
  for (const height of heights) {
    const url = `${base}play_${height}p.mp4`;
    const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (head?.ok) {
      found.push({
        url,
        label: 'recording',
        resolution: `${height}p`,
        timestamp: Date.now(),
      });
    }
  }
  return found;
}

const bunnyInFlight = new Set<string>();

async function captureBunnyRecordings(tabId: number, base: string) {
  const key = `${tabId}:${base}`;
  if (bunnyInFlight.has(key)) return;
  bunnyInFlight.add(key);
  try {
    const found = await fetchBunnyRecordings(base);
    const existing = capturedRecordings.get(tabId) || [];
    for (const recording of found) {
      if (!existing.some((r) => r.url === recording.url)) existing.push(recording);
    }
    capturedRecordings.set(tabId, existing);
    updateBadge(tabId);
  } catch (err) {
    console.error('[Zoom DL] Failed to read Bunny playlist:', err);
  } finally {
    bunnyInFlight.delete(key);
  }
}

function extractLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split('/').pop() || '';
    const lower = filename.toLowerCase();

    // Zoom uses _as_ for shared screen (Application Share), _avo_ for speaker (Active Video Output)
    if (lower.includes('_as_')) return 'screen_recording';
    if (lower.includes('_avo_')) return 'speaker';
    if (lower.includes('screen')) return 'screen_recording';
    if (lower.includes('speaker')) return 'speaker';

    // Try to extract resolution for extra context
    return 'recording';
  } catch {
    return 'recording';
  }
}

function extractResolution(url: string): string {
  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split('/').pop() || '';
    const match = filename.match(/(\d{3,4})x(\d{3,4})/);
    return match ? `${match[1]}x${match[2]}` : '';
  } catch {
    return '';
  }
}

function updateBadge(tabId: number) {
  const recordings = capturedRecordings.get(tabId);
  if (recordings && recordings.length > 0) {
    browser.action.setBadgeText({ text: String(recordings.length), tabId });
    browser.action.setBadgeBackgroundColor({ color: '#2D8CFF', tabId });
  } else {
    browser.action.setBadgeText({ text: '', tabId });
  }
}

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 200) + '.mp4'
  );
}

let offscreenReady = false;
const REFERER_RULE_ID = 1;

async function setRefererRule(referer: string) {
  // Remove any existing rule first
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [REFERER_RULE_ID],
    addRules: [
      {
        id: REFERER_RULE_ID,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            {
              header: 'Referer',
              operation: chrome.declarativeNetRequest.HeaderOperation.SET,
              value: referer,
            },
            {
              header: 'Origin',
              operation: chrome.declarativeNetRequest.HeaderOperation.SET,
              value: new URL(referer).origin,
            },
          ],
        },
        condition: {
          urlFilter: '*://ssrweb.zoom.us/*',
          resourceTypes: [
            chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
            chrome.declarativeNetRequest.ResourceType.OTHER,
          ],
        },
      },
    ],
  });
  console.log('[Zoom DL] Referer rule set:', referer);
}

async function removeRefererRule() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [REFERER_RULE_ID],
  });
  console.log('[Zoom DL] Referer rule removed');
}

async function ensureOffscreen() {
  if (offscreenReady) return;
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT as any],
    });
    if (contexts.length > 0) {
      offscreenReady = true;
      return;
    }
  } catch {
    // getContexts might not exist in older Chrome
  }

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'Fetch video with cookies and create blob URL for download',
    });
    offscreenReady = true;
    console.log('[Zoom DL] Offscreen document created');
  } catch (err: any) {
    if (err?.message?.includes('already exists')) {
      offscreenReady = true;
    } else {
      throw err;
    }
  }
}

async function sendToOffscreen(message: any): Promise<void> {
  const MAX_RETRIES = 10;
  const DELAY_MS = 500;

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await chrome.runtime.sendMessage(message);
      return;
    } catch (err: any) {
      const isNotReady =
        err?.message?.includes('Receiving end does not exist') ||
        err?.message?.includes('Could not establish connection');
      if (isNotReady && i < MAX_RETRIES - 1) {
        console.log(`[Zoom DL] Offscreen not ready, retry ${i + 1}/${MAX_RETRIES}...`);
        await new Promise((r) => setTimeout(r, DELAY_MS));
        continue;
      }
      throw err;
    }
  }
}

export default defineBackground(() => {
  console.log('[Zoom DL] Background script started');

  // 1. Detect .mp4 requests to ssrweb.zoom.us
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!isZoomMp4Url(details.url)) return;
      if (details.tabId < 0) return;

      const tabId = details.tabId;
      const existing = capturedRecordings.get(tabId) || [];
      const baseUrl = details.url.split('?')[0];
      if (existing.some((r) => r.url.split('?')[0] === baseUrl)) return;

      const recording: CapturedRecording = {
        url: details.url,
        label: extractLabel(details.url),
        resolution: extractResolution(details.url),
        timestamp: Date.now(),
      };

      existing.push(recording);
      capturedRecordings.set(tabId, existing);
      updateBadge(tabId);

      console.log(
        `[Zoom DL] Captured .mp4 for tab ${tabId}:`,
        recording.label,
        details.url.substring(0, 100) + '...'
      );
    },
    { urls: ['*://ssrweb.zoom.us/*'] }
  );

  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0) return;
      const base = getBunnyBase(details.url);
      if (base) captureBunnyRecordings(details.tabId, base);
    },
    { urls: ['*://*.b-cdn.net/*/playlist.m3u8*'] }
  );

  // 2. Clean up on tab close/navigate
  browser.tabs.onRemoved.addListener((tabId) => {
    capturedRecordings.delete(tabId);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url && !isSupportedPageUrl(changeInfo.url)) {
      capturedRecordings.delete(tabId);
      updateBadge(tabId);
    }
  });

  // 3. Handle messages
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab?.id;

    // Content script asks for captured recordings
    if (message.type === 'GET_RECORDINGS') {
      const recordings = tabId ? capturedRecordings.get(tabId) || [] : [];
      sendResponse({ recordings });
      return true;
    }

    // Content script requests a download
    if (message.type === 'DOWNLOAD_RECORDING') {
      const { url, filename, pageUrl } = message.payload as {
        url: string;
        filename: string;
        pageUrl: string;
      };

      const requestId = `dl_${++requestCounter}`;
      if (tabId) {
        pendingDownloads.set(requestId, {
          tabId,
          filename: sanitizeFilename(filename),
        });
      }

      (async () => {
        try {
          // Set Referer header rule before fetching
          await setRefererRule(pageUrl);
          await ensureOffscreen();

          // Tell offscreen to fetch the video (with retry for race condition)
          await sendToOffscreen({
            type: 'FETCH_VIDEO',
            payload: { url, requestId },
          });
        } catch (err) {
          console.error('[Zoom DL] Failed to start offscreen fetch:', err);
          if (tabId) {
            chrome.tabs.sendMessage(tabId, {
              type: 'DOWNLOAD_STATUS',
              status: 'error',
              error: String(err),
            });
          }
          pendingDownloads.delete(requestId);
          removeRefererRule().catch(() => { });
        }
      })();

      sendResponse({ ok: true, requestId });
      return true;
    }

    // Content script requests pause/resume/cancel
    if (message.type === 'PAUSE_DOWNLOAD' || message.type === 'RESUME_DOWNLOAD' || message.type === 'CANCEL_DOWNLOAD') {
      const { requestId } = message.payload;
      (async () => {
        try {
          await ensureOffscreen();
          await sendToOffscreen({ type: message.type, payload: { requestId } });
        } catch (err) {
          console.error(`[Zoom DL] Failed to send ${message.type}:`, err);
        }
      })();
      sendResponse({ ok: true });
      return true;
    }

    // Offscreen reports download paused
    if (message.type === 'DOWNLOAD_PAUSED') {
      const { requestId } = message.payload;
      const pending = pendingDownloads.get(requestId);
      if (pending) {
        chrome.tabs.sendMessage(pending.tabId, {
          type: 'DOWNLOAD_STATUS',
          status: 'paused',
        });
      }
      return false;
    }

    // Offscreen reports download resumed
    if (message.type === 'DOWNLOAD_RESUMED') {
      const { requestId } = message.payload;
      const pending = pendingDownloads.get(requestId);
      if (pending) {
        chrome.tabs.sendMessage(pending.tabId, {
          type: 'DOWNLOAD_STATUS',
          status: 'resumed',
        });
      }
      return false;
    }

    // Offscreen reports download cancelled
    if (message.type === 'DOWNLOAD_CANCELLED') {
      const { requestId } = message.payload;
      const pending = pendingDownloads.get(requestId);
      removeRefererRule().catch(() => { });
      if (pending) {
        chrome.tabs.sendMessage(pending.tabId, {
          type: 'DOWNLOAD_STATUS',
          status: 'cancelled',
        });
        pendingDownloads.delete(requestId);
      }
      return false;
    }

    // Offscreen reports fetch progress
    if (message.type === 'FETCH_PROGRESS') {
      const { requestId, pct } = message.payload;
      const pending = pendingDownloads.get(requestId);
      if (pending) {
        chrome.tabs.sendMessage(pending.tabId, {
          type: 'DOWNLOAD_STATUS',
          status: 'progress',
          pct,
        });
      }
      return false;
    }

    // Offscreen completed fetching - blob URL ready
    if (message.type === 'FETCH_COMPLETE') {
      const { requestId, blobUrl, size } = message.payload;
      const pending = pendingDownloads.get(requestId);
      if (!pending) return false;

      removeRefererRule().catch(() => { });

      console.log(
        `[Zoom DL] Blob ready (${(size / (1024 * 1024)).toFixed(1)} MB), downloading as: ${pending.filename}`
      );

      chrome.downloads
        .download({
          url: blobUrl,
          filename: pending.filename,
        })
        .then((downloadId) => {
          console.log(`[Zoom DL] Download started: ${downloadId}`);
          chrome.tabs.sendMessage(pending.tabId, {
            type: 'DOWNLOAD_STATUS',
            status: 'started',
          });
        })
        .catch((err) => {
          console.error('[Zoom DL] chrome.downloads.download failed:', err);
          chrome.tabs.sendMessage(pending.tabId, {
            type: 'DOWNLOAD_STATUS',
            status: 'error',
            error: String(err),
          });
        })
        .finally(() => {
          pendingDownloads.delete(requestId);
        });

      return false;
    }

    // Offscreen reports fetch error
    if (message.type === 'FETCH_ERROR') {
      const { requestId, error } = message.payload;
      const pending = pendingDownloads.get(requestId);
      removeRefererRule().catch(() => { });
      if (pending) {
        console.error('[Zoom DL] Offscreen fetch error:', error);
        chrome.tabs.sendMessage(pending.tabId, {
          type: 'DOWNLOAD_STATUS',
          status: 'error',
          error,
        });
        pendingDownloads.delete(requestId);
      }
      return false;
    }
  });

  // 4. Monitor download completion
  browser.downloads.onChanged.addListener((delta) => {
    if (delta.state?.current === 'complete') {
      console.log(`[Zoom DL] Download ${delta.id} completed`);
    }
    if (delta.error) {
      console.error(`[Zoom DL] Download ${delta.id} error:`, delta.error);
    }
  });
});
