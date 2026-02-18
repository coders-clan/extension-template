# Zoom Cloud Recording Downloader - Chrome Extension

## Project Overview

Build a Chrome extension that detects and downloads Zoom cloud recordings from shared links. The extension monitors network requests on Zoom domains, captures direct `.mp4` video URLs with their required headers, and injects a download button into Zoom recording pages.

**Framework**: WXT + React 19 + TypeScript (existing project scaffold)
**Scope**: Replace existing cookie copier extension entirely
**Target**: Shared recording links only (`*.zoom.us/rec/play/*`, `*.zoom.us/rec/share/*`)
**Download method**: Direct `.mp4` URL capture (no HLS/chunked stream reassembly)
**UI**: Injected download button on Zoom pages only (no popup UI redesign needed)

### Real URL Pattern (from network capture)

```
https://ssrweb.zoom.us/replay03/2026/02/15/{UUID}/{filename}.mp4?response-content-type=video%2Fmp4&...&Policy=...&Signature=...&Key-Pair-Id=...
```

- **Host**: `ssrweb.zoom.us` (CloudFront CDN)
- **Path pattern**: `/replay*/YYYY/MM/DD/{UUID}/{recording_name}.mp4`
- **Auth**: CloudFront signed URL (Policy + Signature + Key-Pair-Id in query params)
- **Required headers**: `cookie` (Zoom session cookies), `referer` (subdomain e.g. `https://digitalculture-co-il.zoom.us/`)
- **Recording page**: on subdomain like `digitalculture-co-il.zoom.us/rec/play/*`
- **Content delivery**: `ssrweb.zoom.us` serves the actual video via Range requests (206 Partial Content)

---

## Phase 1: Project Cleanup & Manifest Configuration

**Assigned to**: frontend-engineer
**Date Started**:
**Status**: [ ] Not Started | [ ] In Progress | [ ] Completed

- [ ] Remove existing cookie copier code from `entrypoints/popup/App.tsx`
- [ ] Remove `@plasmohq/selector` dependency and its imports from `entrypoints/background.ts` and `entrypoints/content.ts`
- [ ] Remove `.env` / `.env.example` references to `PLASMO_PUBLIC_ITERO_SELECTOR_MONITOR_ID`
- [ ] Update `wxt.config.ts` manifest permissions: add `webRequest`, `webRequestAuthProvider`, `downloads`, remove `clipboardWrite`; set `host_permissions` to `*://*.zoom.us/*`
- [ ] Update extension name/description in `wxt.config.ts` to "Zoom Recording Downloader"
- [ ] Update `entrypoints/content.ts` to target only Zoom recording pages: `matches: ['*://*.zoom.us/rec/play/*', '*://*.zoom.us/rec/share/*']`
- [ ] Verify clean build with `pnpm build` after cleanup

#### Phase 1 Completion Report

| Question                                 | Response |
| ---------------------------------------- | -------- |
| What was implemented?                    |          |
| Were there any deviations from the plan? |          |
| Issues/blockers encountered?             |          |
| How were issues resolved?                |          |
| Any technical debt introduced?           |          |
| Recommendations for next phase?          |          |

**Completed by**:
**Date Completed**:

#### Notes for Future Phases

- **Config changes**: Permissions changed to `webRequest`, `downloads`, `activeTab`; host_permissions set to `*://*.zoom.us/*`
- **New dependencies**: None added, `@plasmohq/selector` removed
- **Removed files**: `.env`, `.env.example` (no longer needed)

---

## Phase 2: Background Script - Network Request Monitoring & URL Capture

**Assigned to**: frontend-engineer
**Date Started**:
**Status**: [ ] Not Started | [ ] In Progress | [ ] Completed

- [ ] Implement `chrome.webRequest.onBeforeRequest` listener filtered to `*://ssrweb.zoom.us/*` to detect `.mp4` URLs in network requests
- [ ] Implement URL pattern matching: detect CloudFront signed `.mp4` URLs matching `ssrweb.zoom.us/replay*/*.mp4?*` (contains Policy, Signature, Key-Pair-Id query params)
- [ ] Implement `chrome.webRequest.onBeforeSendHeaders` listener to capture request headers (specifically `referer`, `cookie`) for detected video URLs - these are required even though the URL is self-signed
- [ ] Create a `Map<tabId, CapturedRecording[]>` data structure to store captured URLs and their headers per tab
- [ ] Define `CapturedRecording` type: `{ url: string, headers: Record<string, string>, label: string, timestamp: number }`
- [ ] Handle multiple video streams per page (speaker view vs shared screen) by storing all detected `.mp4` URLs
- [ ] Implement tab cleanup: listen to `chrome.tabs.onRemoved` and `chrome.tabs.onUpdated` (URL change) to clear stale data
- [ ] Implement `chrome.action.setBadgeText` to show recording count when downloads are available for a tab
- [ ] Set up message listener for content script communication (`chrome.runtime.onMessage`)
- [ ] Handle message type `GET_RECORDINGS` - return captured recordings for requesting tab
- [ ] Handle message type `DOWNLOAD_RECORDING` - trigger `chrome.downloads.download()` with captured URL and headers

#### Phase 2 Completion Report

| Question                                 | Response |
| ---------------------------------------- | -------- |
| What was implemented?                    |          |
| Were there any deviations from the plan? |          |
| Issues/blockers encountered?             |          |
| How were issues resolved?                |          |
| Any technical debt introduced?           |          |
| Recommendations for next phase?          |          |

**Completed by**:
**Date Completed**:

#### Notes for Future Phases

- **Message API**: Content script should use `chrome.runtime.sendMessage({ type: 'GET_RECORDINGS' })` and `chrome.runtime.sendMessage({ type: 'DOWNLOAD_RECORDING', payload: { url, headers, filename } })`
- **Badge**: Badge is set per-tab, content script can check badge or query recordings to know if downloads are ready
- **Headers format**: `chrome.downloads.download()` expects headers as `[{ name: string, value: string }]`

---

## Phase 3: Content Script - UI Injection & Download Button

**Assigned to**: frontend-engineer
**Date Started**:
**Status**: [ ] Not Started | [ ] In Progress | [ ] Completed

- [ ] Create content script that runs on `*://*.zoom.us/rec/play/*` and `*://*.zoom.us/rec/share/*`
- [ ] Implement page observation logic: use `MutationObserver` to wait for the video player container to appear in the DOM
- [ ] Extract meeting name from `document.title` (Zoom typically formats it as "Meeting Name - Zoom") for use as filename
- [ ] Implement download button injection: create a styled button element and insert it near the video player
- [ ] Style the download button to match Zoom's UI (blue theme, rounded corners, appropriate sizing)
- [ ] Add retry/polling logic: periodically send `GET_RECORDINGS` message to background to check if `.mp4` URLs have been captured
- [ ] When recordings are available, enable the button and show count (e.g., "Download Recording" or "Download 2 Recordings")
- [ ] On button click: if single recording, send `DOWNLOAD_RECORDING` message directly; if multiple, show a dropdown to pick speaker view / shared screen
- [ ] Handle password-protected recordings: detect the password form on the page, wait for it to be submitted/removed before showing the download button
- [ ] Add visual feedback: button states for "Waiting for video...", "Download Ready", "Downloading...", "Downloaded"
- [ ] Clean up injected elements on page navigation (SPA-aware cleanup)

#### Phase 3 Completion Report

| Question                                 | Response |
| ---------------------------------------- | -------- |
| What was implemented?                    |          |
| Were there any deviations from the plan? |          |
| Issues/blockers encountered?             |          |
| How were issues resolved?                |          |
| Any technical debt introduced?           |          |
| Recommendations for next phase?          |          |

**Completed by**:
**Date Completed**:

#### Notes for Future Phases

- **Filename format**: `{MeetingName}_{label}.mp4` where label is "speaker" or "screen" if multiple streams
- **CSS**: Styles are injected via shadow DOM or scoped class prefixes to avoid conflicts with Zoom's CSS
- **Password detection**: Look for `#passcode` input or `.recording-passcode-form` selector

---

## Phase 4: Download Execution & Edge Case Handling

**Assigned to**: frontend-engineer
**Date Started**:
**Status**: [ ] Not Started | [ ] In Progress | [ ] Completed

- [ ] Implement `chrome.downloads.download()` call in background script with captured URL and headers array
- [ ] Sanitize filename: strip illegal characters from meeting name, ensure `.mp4` extension
- [ ] Handle download errors: listen to `chrome.downloads.onChanged` for failure states and report back to content script
- [ ] Handle expired URLs: if download fails with 403/401, notify content script to show "URL expired, please refresh page"
- [ ] Handle case where video hasn't loaded yet: content script retry logic with exponential backoff (check every 2s, max 30s)
- [ ] Handle edge case where Zoom redirects from `/rec/share/` to `/rec/play/` after password entry
- [ ] Test with various Zoom recording scenarios: single video, dual streams, password-protected
- [ ] Ensure badge clears after successful download or tab navigation away

#### Phase 4 Completion Report

| Question                                 | Response |
| ---------------------------------------- | -------- |
| What was implemented?                    |          |
| Were there any deviations from the plan? |          |
| Issues/blockers encountered?             |          |
| How were issues resolved?                |          |
| Any technical debt introduced?           |          |
| Recommendations for next phase?          |          |

**Completed by**:
**Date Completed**:

#### Notes for Future Phases

- **Error messages**: Sent from background to content script via `chrome.tabs.sendMessage(tabId, { type: 'DOWNLOAD_STATUS', status, error })`
- **Retry strategy**: 2s, 4s, 8s, 16s, 30s (capped) polling interval

---

## Phase 5: Polish, Build & Package

**Assigned to**: frontend-engineer
**Date Started**:
**Status**: [ ] Not Started | [ ] In Progress | [ ] Completed

- [ ] Update extension icons (`public/icon/`) to Zoom-download themed icons (or keep generic)
- [ ] Update popup to show minimal info/instructions (since main UI is injected button)
- [ ] Test full flow end-to-end: navigate to shared Zoom link -> video loads -> button appears -> click download -> file saves with correct name
- [ ] Verify `pnpm build` produces clean Chrome MV3 output
- [ ] Verify extension loads in Chrome via `chrome://extensions` developer mode
- [ ] Create `pnpm zip` package for distribution
- [ ] Update README.md with extension description, installation steps, and usage instructions

#### Phase 5 Completion Report

| Question                                 | Response |
| ---------------------------------------- | -------- |
| What was implemented?                    |          |
| Were there any deviations from the plan? |          |
| Issues/blockers encountered?             |          |
| How were issues resolved?                |          |
| Any technical debt introduced?           |          |
| Recommendations for next phase?          |          |

**Completed by**:
**Date Completed**:

---

## Architecture Summary

```
entrypoints/
  background.ts     - Network request monitoring, URL/header capture, download execution
  content.ts        - DOM injection of download button on Zoom recording pages
  popup/
    App.tsx          - Minimal info/instructions page
    index.html       - Popup HTML shell
    main.tsx         - React mount

Types:
  CapturedRecording { url, headers, label, timestamp }

Message Protocol (content <-> background):
  GET_RECORDINGS       -> returns CapturedRecording[]
  DOWNLOAD_RECORDING   -> triggers chrome.downloads.download()
  DOWNLOAD_STATUS      <- sent to content script with progress/error
```

## Key Technical Decisions

1. **Direct `.mp4` only** - No HLS/m3u8 stream reassembly. Captures Zoom's direct download URLs.
2. **WXT framework** - Leverages existing project setup for build tooling and manifest generation.
3. **No popup interaction** - All user interaction happens via injected button on Zoom pages.
4. **Per-tab state** - Recordings stored per tab ID in background script Map, cleaned up on tab close/navigate.
5. **Header forwarding** - Critical for Zoom downloads; `Referer` and `Cookie` headers must be forwarded via `chrome.downloads.download()`.
