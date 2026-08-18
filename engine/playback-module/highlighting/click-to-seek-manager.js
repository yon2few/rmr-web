// Click To Seek Manager - word-span creation for the font-fit measurement path
// (audio-input-display.js's measurePageViewHeightForFontSize). Click-to-seek
// itself has moved: word-level clicks are engine-owned
// (CaptionOriginal.attachWordClickToSeek), page-level clicks are host-only
// (reader-playback-adapter.js's attachPageClickToSeek). This class no longer
// handles any clicking, despite the name - kept unrenamed per this repo's
// "don't conflate moving code with improving it" convention.
export class ClickToSeekManager {
    constructor() {
        // Simple utility class - no complex state needed
    }

    // Create word spans with proper data attributes (NO click listeners here)
    createWordSpans(words, audioSystem) {
        if (!words || words.length === 0) {
            return document.createElement('div');
        }

        const textContent = document.createElement('div');
        textContent.className = 'text-content';

        words.forEach((wordData, index) => {
            const span = document.createElement('span');
            span.textContent = wordData.word;
            span.className = 'word';
            span.dataset.index = wordData.originalIndex;
            span.dataset.start = wordData.start;
            span.dataset.end = wordData.end;

            textContent.appendChild(span);
            textContent.appendChild(document.createTextNode(' '));
        });

        return textContent;
    }

    processWords(words, container, audioSystem, useFullWidth) {
        const wordsWithIndices = words.map((word, index) => ({
            ...word,
            originalIndex: index
        }));

        return this.createWordSpans(wordsWithIndices, audioSystem);
    }
}

window.ClickToSeekManager = ClickToSeekManager;
