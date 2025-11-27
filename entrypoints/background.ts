import { init } from "@plasmohq/selector/background"

export default defineBackground(() => {
  // Initialize Plasmohq Selector Monitor
  init({
    monitorId: process.env.PLASMO_PUBLIC_ITERO_SELECTOR_MONITOR_ID || ""
  })

  console.log('Hello background!', { id: browser.runtime.id });
});
