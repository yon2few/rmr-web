// Pause State Handler - Manages viewport fitting and pause highlighting
export class PauseStateHandler {
    constructor(captionSystem) {
        this.captionSystem = captionSystem;
        this.originalFontSize = null;
    }
    
    showPauseState() {
        // Store current active word time for pause highlighting
        const audioEl = this.captionSystem.getAudioElement();
        const currentTime = audioEl ? audioEl.currentTime : 0;

        // Keep the current view intact; only apply paused-word styling.
        this.highlightPausedWord(currentTime);
    }

    highlightPausedWord(currentTime) {
        const pageWords = this.captionSystem.getCurrentPageWords();
        if (!pageWords || pageWords.length === 0) return;

        const textDisplay = this.captionSystem.getContainer();
        if (!textDisplay) return;

        const domWords = this.captionSystem.getCurrentDomWords();
        if (!domWords || domWords.length === 0) return;

        domWords.forEach((wordEl) => {
            wordEl.classList.remove('paused-word');
        });
        
        // Find the word that was active when paused
        let activeWordIndex = -1;
        for (let i = 0; i < pageWords.length; i++) {
            const word = pageWords[i];
            if (currentTime >= word.start && currentTime <= word.end) {
                activeWordIndex = i;
                break;
            }
        }
        
        // If no exact match, find closest word
        if (activeWordIndex === -1) {
            let closestDistance = Infinity;
            for (let i = 0; i < pageWords.length; i++) {
                const word = pageWords[i];
                const distance = Math.min(Math.abs(currentTime - word.start), Math.abs(currentTime - word.end));
                if (distance < closestDistance) {
                    closestDistance = distance;
                    activeWordIndex = i;
                }
            }
        }
        
        // Highlight the paused word with bold white text (same font size).
        if (activeWordIndex >= 0 && domWords[activeWordIndex]) {
            domWords[activeWordIndex].classList.add('paused-word');
        }
    }
}

window.PauseStateHandler = PauseStateHandler;
