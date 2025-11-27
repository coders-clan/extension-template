import { querySelector } from "@plasmohq/selector"

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // Use querySelector from plasmohq instead of document.querySelector
    const body = querySelector("body")
    
    if (body) {
      // Create and inject demo button
      const button = document.createElement("button")
      button.textContent = "Demo Button"
      button.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 10000;
        padding: 10px 20px;
        background-color: #4CAF50;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      `.trim()
      
      // Add hover effect
      button.onmouseenter = () => {
        button.style.backgroundColor = "#45a049"
      }
      button.onmouseleave = () => {
        button.style.backgroundColor = "#4CAF50"
      }
      
      // Button click handler
      button.onclick = () => {
        console.log("Demo button clicked!")
        button.textContent = "Clicked!"
        setTimeout(() => {
          button.textContent = "Demo Button"
        }, 1000)
      }
      
      body.appendChild(button)
    }
  }
})

