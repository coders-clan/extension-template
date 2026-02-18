interface CapturedRecording {
  url: string;
  label: string;
  resolution: string;
  timestamp: number;
}

type WidgetState = 'waiting' | 'ready' | 'downloading' | 'paused' | 'done' | 'error';

let container: HTMLDivElement | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let recordings: CapturedRecording[] = [];
let currentState: WidgetState = 'waiting';
let activeRequestId: string | null = null;
let lastPct = 0;
let isCollapsed = false;

export default defineContentScript({
  matches: ['*://*.zoom.us/rec/play/*', '*://*.zoom.us/rec/share/*'],

  main() {
    console.log('[Zoom DL] Content script loaded on recording page');
    injectUI();
    startPolling();
    listenForMessages();
  },
});

/* ── SVG Icons ─────────────────────────────────────────────── */

const SVG_DOWNLOAD = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v10M10 13l-4-4M10 13l4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 15v1a2 2 0 002 2h10a2 2 0 002-2v-1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const SVG_CHECK = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" fill="#43a047" opacity="0.15"/><path d="M6 10.5l2.5 2.5 5.5-5.5" stroke="#43a047" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SVG_ERROR = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" fill="#e53935" opacity="0.15"/><path d="M10 6v5M10 13.5v.5" stroke="#e53935" stroke-width="2" stroke-linecap="round"/></svg>`;
const SVG_PAUSE = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="2" width="3" height="10" rx="1" fill="currentColor"/><rect x="8" y="2" width="3" height="10" rx="1" fill="currentColor"/></svg>`;
const SVG_RESUME = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2v10l7.5-5L4 2z" fill="currentColor"/></svg>`;
const SVG_STOP = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor"/></svg>`;
const SVG_SCREEN = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1.5" y="2.5" width="15" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M6 15h6M9 12.5v2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const SVG_CAMERA = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1.5" y="3.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M12.5 7.5l4-2.5v8l-4-2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SVG_FILE = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v10M9 12l-3.5-3.5M9 12l3.5-3.5M3 15h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SVG_MINIMIZE = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const SVG_ZOOM_LOGO = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="#2D8CFF"/><path d="M5.5 8.5a1 1 0 011-1h6a1 1 0 011 1v5a1 1 0 01-1 1h-6a1 1 0 01-1-1v-5z" fill="#fff"/><path d="M13.5 10l3.5-2v6l-3.5-2" fill="#fff"/></svg>`;

/* ── UI Injection ──────────────────────────────────────────── */

function injectUI() {
  if (container) return;

  container = document.createElement('div');
  container.id = 'zoom-dl-root';
  container.innerHTML = `
    <style>
      /* ── Reset & Container ─────────────────────────── */
      #zoom-dl-root {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
        font-size: 13px;
        line-height: 1.4;
        color: #1a1a1a;
      }
      #zoom-dl-root * { box-sizing: border-box; margin: 0; padding: 0; }

      /* ── Collapsed FAB ─────────────────────────────── */
      #zdl-fab {
        display: none;
        width: 52px; height: 52px;
        border-radius: 16px;
        border: none;
        background: #fff;
        box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08);
        cursor: pointer;
        align-items: center; justify-content: center;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        position: relative;
      }
      #zdl-fab:hover { transform: translateY(-2px); box-shadow: 0 6px 28px rgba(0,0,0,0.16), 0 2px 6px rgba(0,0,0,0.1); }
      #zdl-fab.visible { display: flex; }
      #zdl-fab-badge {
        position: absolute; top: -4px; right: -4px;
        background: #2D8CFF; color: #fff;
        font-size: 10px; font-weight: 700;
        width: 20px; height: 20px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        border: 2px solid #fff;
        opacity: 0; transition: opacity 0.2s;
      }
      #zdl-fab-badge.visible { opacity: 1; }
      /* Pulse ring on fab when downloading */
      #zdl-fab.downloading::after {
        content: '';
        position: absolute; inset: -4px;
        border-radius: 20px;
        border: 2px solid #2D8CFF;
        animation: zdl-fab-pulse 1.5s ease-out infinite;
      }
      @keyframes zdl-fab-pulse {
        0% { opacity: 0.6; transform: scale(1); }
        100% { opacity: 0; transform: scale(1.25); }
      }

      /* ── Card Widget ───────────────────────────────── */
      #zdl-card {
        width: 340px;
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
        overflow: hidden;
        animation: zdl-slide-in 0.35s cubic-bezier(0.16,1,0.3,1);
        transform-origin: bottom right;
      }
      #zdl-card.hidden { display: none; }
      @keyframes zdl-slide-in {
        from { opacity: 0; transform: translateY(12px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      /* ── Header ────────────────────────────────────── */
      #zdl-header {
        display: flex; align-items: center; gap: 10px;
        padding: 14px 16px;
        background: linear-gradient(135deg, #f8fbff 0%, #f0f5ff 100%);
        border-bottom: 1px solid #e8eef6;
      }
      #zdl-header-logo { flex-shrink: 0; display: flex; }
      #zdl-header-title {
        flex: 1; font-size: 14px; font-weight: 700; color: #1a2233;
      }
      #zdl-header-subtitle {
        font-size: 11px; font-weight: 400; color: #6b7a8d; margin-top: 1px;
      }
      .zdl-header-btn {
        width: 28px; height: 28px; border-radius: 8px;
        border: none; background: transparent; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        color: #8899aa; transition: all 0.15s;
      }
      .zdl-header-btn:hover { background: rgba(0,0,0,0.06); color: #556677; }

      /* ── Body / Content ────────────────────────────── */
      #zdl-body { padding: 0; }

      /* ── Scanning State ────────────────────────────── */
      #zdl-scanning {
        display: flex; flex-direction: column; align-items: center;
        padding: 28px 20px 24px;
        gap: 14px;
      }
      .zdl-scan-animation {
        width: 48px; height: 48px; position: relative;
      }
      .zdl-scan-ring {
        width: 48px; height: 48px;
        border: 3px solid #e8eef6;
        border-top-color: #2D8CFF;
        border-radius: 50%;
        animation: zdl-spin 1s linear infinite;
      }
      .zdl-scan-dot {
        position: absolute; top: 50%; left: 50%;
        width: 8px; height: 8px;
        margin: -4px 0 0 -4px;
        background: #2D8CFF;
        border-radius: 50%;
        animation: zdl-dot-pulse 1.5s ease-in-out infinite;
      }
      @keyframes zdl-spin { to { transform: rotate(360deg); } }
      @keyframes zdl-dot-pulse {
        0%, 100% { opacity: 0.3; transform: scale(0.8); }
        50% { opacity: 1; transform: scale(1.2); }
      }
      .zdl-scan-text {
        font-size: 13px; color: #6b7a8d; text-align: center;
      }
      .zdl-scan-dots::after {
        content: '';
        animation: zdl-dots 1.5s steps(4, end) infinite;
      }
      @keyframes zdl-dots {
        0% { content: ''; }
        25% { content: '.'; }
        50% { content: '..'; }
        75% { content: '...'; }
      }

      /* ── Recording List ────────────────────────────── */
      .zdl-rec-list { list-style: none; }
      .zdl-rec-item {
        display: flex; align-items: center; gap: 12px;
        padding: 12px 16px;
        border-bottom: 1px solid #f2f4f7;
        transition: background 0.15s;
      }
      .zdl-rec-item:last-child { border-bottom: none; }
      .zdl-rec-item:hover { background: #f8fbff; }
      .zdl-rec-icon {
        width: 38px; height: 38px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
      }
      .zdl-rec-icon.screen { background: #e8f4fd; color: #1976d2; }
      .zdl-rec-icon.speaker { background: #fce8ec; color: #c62828; }
      .zdl-rec-icon.generic { background: #f0e8f8; color: #7b1fa2; }
      .zdl-rec-info { flex: 1; min-width: 0; }
      .zdl-rec-title {
        font-size: 13px; font-weight: 600; color: #1a2233;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .zdl-rec-meta { font-size: 11px; color: #8899aa; margin-top: 2px; }
      .zdl-rec-dl-btn {
        width: 36px; height: 36px; border-radius: 10px;
        border: none;
        background: #2D8CFF; color: #fff;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        transition: all 0.2s;
      }
      .zdl-rec-dl-btn:hover { background: #1a7af0; transform: scale(1.05); }
      .zdl-rec-dl-btn:active { transform: scale(0.95); }

      /* ── Download Progress ─────────────────────────── */
      #zdl-progress {
        display: none; padding: 16px;
      }
      #zdl-progress.active { display: block; }
      .zdl-progress-header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 12px;
      }
      .zdl-progress-label {
        font-size: 13px; font-weight: 600; color: #1a2233;
      }
      .zdl-progress-pct {
        font-size: 13px; font-weight: 700; color: #2D8CFF;
        font-variant-numeric: tabular-nums;
      }
      .zdl-progress-pct.paused { color: #f57c00; }
      .zdl-progress-track {
        width: 100%; height: 8px; 
        background: #e8eef6; border-radius: 4px;
        overflow: hidden; position: relative;
      }
      .zdl-progress-fill {
        height: 100%; width: 0%;
        background: linear-gradient(90deg, #2D8CFF 0%, #5aa8ff 100%);
        border-radius: 4px;
        transition: width 0.4s ease;
        position: relative;
      }
      .zdl-progress-fill.paused {
        background: linear-gradient(90deg, #f57c00 0%, #ffb74d 100%);
      }
      .zdl-progress-fill::after {
        content: '';
        position: absolute; inset: 0;
        background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%);
        animation: zdl-shimmer 1.5s ease-in-out infinite;
      }
      .zdl-progress-fill.paused::after { animation: none; }
      @keyframes zdl-shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }
      .zdl-progress-status {
        display: flex; align-items: center; justify-content: space-between;
        margin-top: 10px;
      }
      .zdl-progress-status-text {
        font-size: 12px; color: #6b7a8d;
      }
      .zdl-progress-controls {
        display: flex; gap: 6px;
      }
      .zdl-ctrl-btn {
        width: 30px; height: 30px; border-radius: 8px;
        border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.15s;
      }
      .zdl-ctrl-pause {
        background: #f0f5ff; color: #2D8CFF;
      }
      .zdl-ctrl-pause:hover { background: #e0edff; }
      .zdl-ctrl-pause.paused { background: #fff3e0; color: #f57c00; }
      .zdl-ctrl-pause.paused:hover { background: #ffe8cc; }
      .zdl-ctrl-cancel {
        background: #fef2f2; color: #e53935;
      }
      .zdl-ctrl-cancel:hover { background: #fde8e8; }

      /* ── Done / Error Banner ───────────────────────── */
      .zdl-banner {
        display: flex; align-items: center; gap: 10px;
        padding: 16px;
      }
      .zdl-banner-icon { flex-shrink: 0; display: flex; }
      .zdl-banner-text { flex: 1; }
      .zdl-banner-title {
        font-size: 13px; font-weight: 600;
      }
      .zdl-banner-title.success { color: #2e7d32; }
      .zdl-banner-title.error { color: #c62828; }
      .zdl-banner-sub {
        font-size: 11px; color: #6b7a8d; margin-top: 2px;
      }
    </style>

    <!-- Collapsed FAB -->
    <button id="zdl-fab" title="Zoom Downloads">
      ${SVG_ZOOM_LOGO}
      <span id="zdl-fab-badge">0</span>
    </button>

    <!-- Expanded Card -->
    <div id="zdl-card">
      <div id="zdl-header">
        <span id="zdl-header-logo">${SVG_ZOOM_LOGO}</span>
        <div>
          <div id="zdl-header-title">Zoom Downloads</div>
          <div id="zdl-header-subtitle">Scanning for recordings<span class="zdl-scan-dots"></span></div>
        </div>
        <button class="zdl-header-btn" id="zdl-minimize" title="Minimize">${SVG_MINIMIZE}</button>
      </div>
      <div id="zdl-body">
        <!-- Scanning state (default) -->
        <div id="zdl-scanning">
          <div class="zdl-scan-animation">
            <div class="zdl-scan-ring"></div>
            <div class="zdl-scan-dot"></div>
          </div>
          <div class="zdl-scan-text">Looking for recordings<span class="zdl-scan-dots"></span></div>
        </div>
        <!-- Recording list (hidden initially) -->
        <div id="zdl-rec-list-wrap" style="display:none;">
          <ul class="zdl-rec-list" id="zdl-rec-list"></ul>
        </div>
        <!-- Download progress (hidden initially) -->
        <div id="zdl-progress">
          <div class="zdl-progress-header">
            <span class="zdl-progress-label">Downloading...</span>
            <span class="zdl-progress-pct" id="zdl-pct">0%</span>
          </div>
          <div class="zdl-progress-track">
            <div class="zdl-progress-fill" id="zdl-fill"></div>
          </div>
          <div class="zdl-progress-status">
            <span class="zdl-progress-status-text" id="zdl-status-text">Preparing download...</span>
            <div class="zdl-progress-controls">
              <button class="zdl-ctrl-btn zdl-ctrl-pause" id="zdl-pause" title="Pause">${SVG_PAUSE}</button>
              <button class="zdl-ctrl-btn zdl-ctrl-cancel" id="zdl-cancel" title="Cancel">${SVG_STOP}</button>
            </div>
          </div>
        </div>
        <!-- Done/Error banners (hidden initially) -->
        <div id="zdl-banner-wrap" style="display:none;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  /* ── Event listeners ── */
  const fab = container.querySelector('#zdl-fab') as HTMLButtonElement;
  const card = container.querySelector('#zdl-card') as HTMLDivElement;
  const minimizeBtn = container.querySelector('#zdl-minimize') as HTMLButtonElement;
  const pauseBtn = container.querySelector('#zdl-pause') as HTMLButtonElement;
  const cancelBtn = container.querySelector('#zdl-cancel') as HTMLButtonElement;

  fab.addEventListener('click', () => {
    isCollapsed = false;
    fab.classList.remove('visible');
    card.classList.remove('hidden');
    card.style.animation = 'none';
    card.offsetHeight; // reflow
    card.style.animation = '';
  });

  minimizeBtn.addEventListener('click', () => {
    isCollapsed = true;
    card.classList.add('hidden');
    fab.classList.add('visible');
    fab.classList.toggle('downloading', currentState === 'downloading');
    const badge = fab.querySelector('#zdl-fab-badge') as HTMLElement;
    if (recordings.length > 0) {
      badge.textContent = String(recordings.length);
      badge.classList.add('visible');
    }
  });

  pauseBtn.addEventListener('click', () => {
    if (!activeRequestId) return;
    if (currentState === 'downloading') {
      browser.runtime.sendMessage({ type: 'PAUSE_DOWNLOAD', payload: { requestId: activeRequestId } });
    } else if (currentState === 'paused') {
      browser.runtime.sendMessage({ type: 'RESUME_DOWNLOAD', payload: { requestId: activeRequestId } });
    }
  });

  cancelBtn.addEventListener('click', () => {
    if (!activeRequestId) return;
    browser.runtime.sendMessage({ type: 'CANCEL_DOWNLOAD', payload: { requestId: activeRequestId } });
  });
}

/* ── State Update ──────────────────────────────────────────── */

function updateWidget(state: WidgetState, extra?: string) {
  currentState = state;

  const scanning = document.querySelector('#zdl-scanning') as HTMLElement | null;
  const recListWrap = document.querySelector('#zdl-rec-list-wrap') as HTMLElement | null;
  const progress = document.querySelector('#zdl-progress') as HTMLElement | null;
  const bannerWrap = document.querySelector('#zdl-banner-wrap') as HTMLElement | null;
  const subtitle = document.querySelector('#zdl-header-subtitle') as HTMLElement | null;
  const fill = document.querySelector('#zdl-fill') as HTMLElement | null;
  const pct = document.querySelector('#zdl-pct') as HTMLElement | null;
  const statusText = document.querySelector('#zdl-status-text') as HTMLElement | null;
  const pauseBtn = document.querySelector('#zdl-pause') as HTMLButtonElement | null;
  const fab = document.querySelector('#zdl-fab') as HTMLElement | null;

  if (!scanning || !recListWrap || !progress || !bannerWrap) return;

  // Hide all sections
  scanning.style.display = 'none';
  recListWrap.style.display = 'none';
  progress.classList.remove('active');
  bannerWrap.style.display = 'none';

  switch (state) {
    case 'waiting':
      scanning.style.display = 'flex';
      if (subtitle) subtitle.innerHTML = 'Scanning for recordings<span class="zdl-scan-dots"></span>';
      break;

    case 'ready':
      activeRequestId = null;
      lastPct = 0;
      recListWrap.style.display = 'block';
      if (subtitle) {
        subtitle.textContent = recordings.length === 1
          ? '1 recording found'
          : `${recordings.length} recordings found`;
      }
      fab?.classList.remove('downloading');
      break;

    case 'downloading': {
      progress.classList.add('active');
      fill?.classList.remove('paused');
      pct?.classList.remove('paused');
      if (pauseBtn) {
        pauseBtn.innerHTML = SVG_PAUSE;
        pauseBtn.title = 'Pause';
        pauseBtn.classList.remove('paused');
      }
      fab?.classList.add('downloading');

      const pctMatch = extra?.match(/(\d+)%/);
      if (pctMatch && fill && pct) {
        lastPct = parseInt(pctMatch[1]);
        fill.style.width = `${lastPct}%`;
        pct.textContent = `${lastPct}%`;
        if (subtitle) subtitle.textContent = `Downloading... ${lastPct}%`;
        if (statusText) statusText.textContent = `Downloading recording...`;
      } else {
        if (fill) fill.style.width = '0%';
        if (pct) pct.textContent = '0%';
        if (subtitle) subtitle.textContent = 'Preparing download...';
        if (statusText) statusText.textContent = extra || 'Preparing download...';
      }
      break;
    }

    case 'paused': {
      progress.classList.add('active');
      fill?.classList.add('paused');
      pct?.classList.add('paused');
      if (pauseBtn) {
        pauseBtn.innerHTML = SVG_RESUME;
        pauseBtn.title = 'Resume';
        pauseBtn.classList.add('paused');
      }
      fab?.classList.remove('downloading');
      if (fill && lastPct > 0) fill.style.width = `${lastPct}%`;
      if (pct) pct.textContent = `${lastPct}%`;
      if (subtitle) subtitle.textContent = `Paused at ${lastPct}%`;
      if (statusText) statusText.textContent = 'Download paused';
      break;
    }

    case 'done':
      activeRequestId = null;
      lastPct = 0;
      fab?.classList.remove('downloading');
      bannerWrap.style.display = 'block';
      bannerWrap.innerHTML = `
        <div class="zdl-banner">
          <span class="zdl-banner-icon">${SVG_CHECK}</span>
          <div class="zdl-banner-text">
            <div class="zdl-banner-title success">Download complete</div>
            <div class="zdl-banner-sub">File saved to your downloads folder</div>
          </div>
        </div>`;
      if (subtitle) subtitle.textContent = 'Download complete';
      setTimeout(() => updateWidget('ready'), 3000);
      break;

    case 'error':
      activeRequestId = null;
      lastPct = 0;
      fab?.classList.remove('downloading');
      bannerWrap.style.display = 'block';
      bannerWrap.innerHTML = `
        <div class="zdl-banner">
          <span class="zdl-banner-icon">${SVG_ERROR}</span>
          <div class="zdl-banner-text">
            <div class="zdl-banner-title error">Download failed</div>
            <div class="zdl-banner-sub">${extra || 'Something went wrong. Try again.'}</div>
          </div>
        </div>`;
      if (subtitle) subtitle.textContent = 'Error occurred';
      setTimeout(() => updateWidget('ready'), 5000);
      break;
  }
}

/* ── Recording helpers ─────────────────────────────────────── */

function getRecordingDisplay(r: CapturedRecording, index: number): { title: string; meta: string; iconClass: string; iconSvg: string } {
  const res = r.resolution || '';

  if (r.label === 'screen_recording') {
    return {
      title: 'Screen Recording',
      meta: res ? `Shared screen \u00B7 ${res}` : 'Shared screen capture',
      iconClass: 'screen',
      iconSvg: SVG_SCREEN,
    };
  }
  if (r.label === 'speaker') {
    return {
      title: 'Speaker Recording',
      meta: res ? `Active speaker \u00B7 ${res}` : 'Active speaker view',
      iconClass: 'speaker',
      iconSvg: SVG_CAMERA,
    };
  }
  return {
    title: `Recording ${index + 1}`,
    meta: res || 'Video file',
    iconClass: 'generic',
    iconSvg: SVG_FILE,
  };
}

function renderRecordingList() {
  const list = document.querySelector('#zdl-rec-list') as HTMLUListElement | null;
  if (!list) return;

  list.innerHTML = recordings
    .map((r, i) => {
      const d = getRecordingDisplay(r, i);
      return `
        <li class="zdl-rec-item" data-index="${i}">
          <div class="zdl-rec-icon ${d.iconClass}">${d.iconSvg}</div>
          <div class="zdl-rec-info">
            <div class="zdl-rec-title">${d.title}</div>
            <div class="zdl-rec-meta">${d.meta}</div>
          </div>
          <button class="zdl-rec-dl-btn" data-index="${i}" title="Download">${SVG_DOWNLOAD}</button>
        </li>`;
    })
    .join('');

  list.querySelectorAll('.zdl-rec-dl-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt((btn as HTMLElement).dataset.index || '0');
      triggerDownload(recordings[index]);
    });
  });
}

function getMeetingName(): string {
  const title = document.title || '';
  return title.replace(/\s*[-–]\s*Zoom.*$/i, '').trim() || 'Zoom_Recording';
}

function triggerDownload(recording: CapturedRecording) {
  updateWidget('downloading', 'Preparing download...');

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
  }).then((response: any) => {
    if (response?.requestId) {
      activeRequestId = response.requestId;
    }
  });
}

function listenForMessages() {
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'DOWNLOAD_STATUS') {
      switch (message.status) {
        case 'progress':
          updateWidget('downloading', `Downloading ${message.pct}%...`);
          break;
        case 'paused':
          updateWidget('paused');
          break;
        case 'resumed':
          updateWidget('downloading', lastPct > 0 ? `Downloading ${lastPct}%...` : 'Resuming...');
          break;
        case 'cancelled':
          updateWidget('ready');
          break;
        case 'started':
          updateWidget('done');
          break;
        case 'error':
          console.error('[Zoom DL] Download error:', message.error);
          updateWidget('error', message.error);
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
        // Don't override downloading/paused/done states with ready
        if (currentState !== 'downloading' && currentState !== 'paused' && currentState !== 'done') {
          updateWidget('ready');
        }
        renderRecordingList();

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
        updateWidget('waiting');
      }
    }
  };

  pollTimer = setInterval(poll, POLL_INTERVAL);
  poll();
}
