import { useState } from "react";
import "./App.css";

function App() {
  const [buttonText, setButtonText] = useState("Copy Cookies");

  const handleCopyCookies = async () => {
    try {
      // Get the current active tab
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tabs || tabs.length === 0 || !tabs[0].url) {
        setButtonText("Error");
        setTimeout(() => setButtonText("Copy Cookies"), 2000);
        return;
      }

      const currentTab = tabs[0];
      const tabUrl = currentTab.url;

      // Get all cookies for the current tab's URL
      const cookies = await browser.cookies.getAll({ url: tabUrl });

      if (!cookies || cookies.length === 0) {
        setButtonText("No Cookies");
        setTimeout(() => setButtonText("Copy Cookies"), 2000);
        return;
      }

      // Format cookies as JSON with proper indentation
      const cookiesJson = JSON.stringify(cookies, null, 2);

      // Copy to clipboard
      await navigator.clipboard.writeText(cookiesJson);

      // Show success feedback
      setButtonText("Copied!");
      setTimeout(() => setButtonText("Copy Cookies"), 2000);
    } catch (error) {
      console.error("Error copying cookies:", error);
      setButtonText("Error");
      setTimeout(() => setButtonText("Copy Cookies"), 2000);
    }
  };

  return (
    <>
      <button onClick={handleCopyCookies}>{buttonText}</button>
    </>
  );
}

export default App;
