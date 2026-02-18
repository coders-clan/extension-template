import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Coders Clan - Zoom Recording Downloader',
    description: 'Download Zoom cloud recordings from shared links',
    permissions: ['webRequest', 'activeTab', 'offscreen', 'downloads', 'declarativeNetRequest'],
    host_permissions: ['*://*.zoom.us/*', '*://ssrweb.zoom.us/*'],
  },
});
