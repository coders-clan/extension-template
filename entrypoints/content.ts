interface CapturedRecording {
  url: string;
  label: string;
  timestamp: number;
}

type ButtonState = 'waiting' | 'ready' | 'downloading' | 'done' | 'error';

let container: HTMLDivElement | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let recordings: CapturedRecording[] = [];

export default defineContentScript({
  matches: ['*://*.zoom.us/rec/play/*', '*://*.zoom.us/rec/share/*'],

  main() {
    console.log('[Zoom DL] Content script loaded on recording page');
    injectUI();
    startPolling();
    listenForMessages();
  },
});

function injectUI() {
  if (container) return;

  container = document.createElement('div');
  container.id = 'zoom-dl-container';
  container.innerHTML = `
    <style>
      #zoom-dl-container {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #zoom-dl-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 20px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        color: #fff;
        background: #2D8CFF;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        transition: all 0.2s;
      }
      #zoom-dl-btn:hover:not(:disabled) {
        background: #1a7af0;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transform: translateY(-1px);
      }
      #zoom-dl-btn:disabled { background: #8c8c8c; cursor: not-allowed; }
      #zoom-dl-btn.waiting { background: #666; }
      #zoom-dl-btn.error { background: #e53935; }
      #zoom-dl-btn.done { background: #43a047; }
      #zoom-dl-dropdown {
        position: absolute; top: 100%; right: 0; margin-top: 4px;
        background: #fff; border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        overflow: hidden; display: none; min-width: 200px;
      }
      #zoom-dl-dropdown.show { display: block; }
      .zoom-dl-item {
        padding: 10px 16px; cursor: pointer; font-size: 13px;
        color: #333; border-bottom: 1px solid #eee; transition: background 0.15s;
      }
      .zoom-dl-item:hover { background: #f0f7ff; }
      .zoom-dl-item:last-child { border-bottom: none; }
    </style>
    <button id="zoom-dl-btn" class="waiting" disabled>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 1v9M8 10l-3-3M8 10l3-3M2 13h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span id="zoom-dl-text">Waiting for video...</span>
    </button>
    <div id="zoom-dl-dropdown"></div>
  `;
  document.body.appendChild(container);

  const btn = container.querySelector('#zoom-dl-btn') as HTMLButtonElement;
  const dropdown = container.querySelector('#zoom-dl-dropdown') as HTMLDivElement;

  btn.addEventListener('click', () => {
    if (recordings.length === 0) return;
    if (recordings.length === 1) {
      triggerDownload(recordings[0]);
    } else {
      dropdown.classList.toggle('show');
    }
  });

  document.addEventListener('click', (e) => {
    if (!container?.contains(e.target as Node)) {
      dropdown.classList.remove('show');
    }
  });
}

function updateButton(state: ButtonState, extra?: string) {
  const btn = document.querySelector('#zoom-dl-btn') as HTMLButtonElement | null;
  const text = document.querySelector('#zoom-dl-text') as HTMLSpanElement | null;
  if (!btn || !text) return;

  btn.className = state;

  switch (state) {
    case 'waiting':
      btn.disabled = true;
      text.textContent = 'Waiting for video...';
      break;
    case 'ready':
      btn.disabled = false;
      text.textContent =
        recordings.length > 1
          ? `Download ${recordings.length} Recordings`
          : 'Download Recording';
      break;
    case 'downloading':
      btn.disabled = true;
      text.textContent = extra || 'Downloading...';
      break;
    case 'done':
      btn.disabled = false;
      text.textContent = 'Downloaded!';
      setTimeout(() => updateButton('ready'), 3000);
      break;
    case 'error':
      btn.disabled = false;
      text.textContent = extra || 'Error - Click to retry';
      setTimeout(() => updateButton('ready'), 5000);
      break;
  }
}

function renderDropdown() {
  const dropdown = document.querySelector('#zoom-dl-dropdown') as HTMLDivElement | null;
  if (!dropdown) return;

  dropdown.innerHTML = recordings
    .map(
      (r, i) => `
    <div class="zoom-dl-item" data-index="${i}">
      ${r.label === 'shared_screen' ? 'Shared Screen' : r.label === 'speaker_view' ? 'Speaker View' : `Recording ${i + 1}`}
    </div>
  `
    )
    .join('');

  dropdown.querySelectorAll('.zoom-dl-item').forEach((item) => {
    item.addEventListener('click', () => {
      const index = parseInt((item as HTMLElement).dataset.index || '0');
      triggerDownload(recordings[index]);
      dropdown.classList.remove('show');
    });
  });
}

function getMeetingName(): string {
  const title = document.title || '';
  return title.replace(/\s*[-–]\s*Zoom.*$/i, '').trim() || 'Zoom_Recording';
}

function triggerDownload(recording: CapturedRecording) {
  updateButton('downloading', 'Preparing download...');

  const meetingName = getMeetingName();
  const suffix = recordings.length > 1 ? `_${recording.label}` : '';
  const filename = `${meetingName}${suffix}`;

  console.log('[Zoom DL] Requesting download:', filename);

  browser.runtime.sendMessage({
    type: 'DOWNLOAD_RECORDING',
    payload: {
      url: recording.url,
      filename,
      pageUrl: window.location.href,
    },
  });
}

function listenForMessages() {
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'DOWNLOAD_STATUS') {
      switch (message.status) {
        case 'progress':
          updateButton('downloading', `Downloading ${message.pct}%...`);
          break;
        case 'started':
          updateButton('done');
          break;
        case 'error':
          console.error('[Zoom DL] Download error:', message.error);
          updateButton('error', `Error: ${message.error}`);
          break;
      }
    }
  });
}

function startPolling() {
  const POLL_INTERVAL = 2000;
  const MAX_POLL_TIME = 60000;
  const startTime = Date.now();

  const poll = async () => {
    try {
      const response = await browser.runtime.sendMessage({ type: 'GET_RECORDINGS' });
      if (response?.recordings?.length > 0) {
        recordings = response.recordings;
        updateButton('ready');
        renderDropdown();

        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(poll, 10000);
        return;
      }
    } catch (err) {
      console.log('[Zoom DL] Polling error:', err);
    }

    if (Date.now() - startTime > MAX_POLL_TIME) {
      if (pollTimer) clearInterval(pollTimer);
      if (recordings.length === 0) {
        updateButton('waiting');
      }
    }
  };

  pollTimer = setInterval(poll, POLL_INTERVAL);
  poll();
}
