import "./App.css";

function App() {
  return (
    <div className="popup">
      <div className="popup-header">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#2D8CFF" />
          <path d="M5.5 8.5a1 1 0 011-1h6a1 1 0 011 1v5a1 1 0 01-1 1h-6a1 1 0 01-1-1v-5z" fill="#fff" />
          <path d="M13.5 10l3.5-2v6l-3.5-2" fill="#fff" />
        </svg>
        <h2>Zoom Downloads</h2>
      </div>
      <div className="popup-body">
        <div className="step">
          <span className="step-num">1</span>
          <p>Open a Zoom shared recording link</p>
        </div>
        <div className="step">
          <span className="step-num">2</span>
          <p>Wait for the download widget to appear</p>
        </div>
        <div className="step">
          <span className="step-num">3</span>
          <p>Click the download button next to any recording</p>
        </div>
      </div>
      <div className="popup-footer">
        <p>The widget appears in the bottom-right corner of Zoom recording pages.</p>
      </div>
    </div>
  );
}

export default App;
