export interface CapturedRecording {
  url: string;
  label: string;
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

function extractLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split('/').pop() || '';
    if (filename.toLowerCase().includes('screen')) return 'shared_screen';
    if (filename.toLowerCase().includes('speaker')) return 'speaker_view';
    return 'recording';
  } catch {
    return 'recording';
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

  // 2. Clean up on tab close/navigate
  browser.tabs.onRemoved.addListener((tabId) => {
    capturedRecordings.delete(tabId);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url && !changeInfo.url.includes('.zoom.us/rec/')) {
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
          removeRefererRule().catch(() => {});
        }
      })();

      sendResponse({ ok: true });
      return true;
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

      removeRefererRule().catch(() => {});

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
      removeRefererRule().catch(() => {});
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
