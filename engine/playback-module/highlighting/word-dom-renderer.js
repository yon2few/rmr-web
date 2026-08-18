// Word DOM Renderer - owns word-span creation, canvas-measured line balancing,
// and word-element caching/resolution for the highlighting engine's main
// PageView render path. Moved out of ClickToSeekManager.createWordSpans/
// processWords, PageLineBalancer, and audio-input-display.js's
// cacheWordElements/resolveCurrentWordElements/applyInitialHighlighting so
// CaptionOriginal can resolve its own DOM word elements without depending on
// an external dataDisplay.resolveCurrentWordElements() callback.
//
// ClickToSeekManager.processWords / PageLineBalancer.optimizeLineBalance stay
// in place unchanged and are still used by audio-input-display.js's font-fit
// measurement path (measurePageViewHeightForFontSize) - this class only
// replaces them in the main page-render pipeline.
import { ArtReaderHighlightingConfig } from './config.js';

export class WordDomRenderer {
    constructor() {
        this.canvas = null;
        this.context = null;
        this.container = null;
        this.lastContainerWidth = 0;
        this.resizeHandler = null;
        this.workingWidth = 0;
        this.interWordSeparator = ' ';
        this.wordElements = [];
    }

    createWordSpans(words) {
        if (!words || words.length === 0) {
            return document.createElement('div');
        }

        const textContent = document.createElement('div');
        textContent.className = 'text-content';

        words.forEach((wordData, index) => {
            const span = document.createElement('span');
            span.textContent = wordData.word;
            span.className = 'word';
            span.dataset.index = index;
            span.dataset.start = wordData.start;
            span.dataset.end = wordData.end;

            textContent.appendChild(span);
            textContent.appendChild(document.createTextNode(' '));
        });

        return textContent;
    }

    initializeMeasurement(container, fontFamily, fontSize) {
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.context = this.canvas.getContext('2d');
        }

        this.context.font = `${fontSize * ArtReaderHighlightingConfig.activeScale}px ${fontFamily}`;
        this.container = container;
        this.workingWidth = container.getBoundingClientRect().width;
        this.lastContainerWidth = this.workingWidth;
        this.setupWindowResizeListener();
    }

    measureTextWidth(text) {
        return this.context.measureText(text).width;
    }

    measureSpaceWidth() {
        return this.context.measureText(this.interWordSeparator).width;
    }

    distributeWordSpansIntoLines(wordSpans, wordHorizontalPadding = 0) {
        if (!wordSpans || wordSpans.length === 0) return [];

        const lines = [];
        let currentLine = [];
        let currentLineWidth = 0;
        const spaceWidth = this.measureSpaceWidth();

        for (let i = 0; i < wordSpans.length; i++) {
            const span = wordSpans[i];
            const wordWidth = this.measureTextWidth(span.textContent) + wordHorizontalPadding;
            const totalWidth = wordWidth + (currentLine.length > 0 ? spaceWidth : 0);

            if (currentLineWidth + totalWidth > this.workingWidth && currentLine.length > 0) {
                lines.push([...currentLine]);
                currentLine = [span];
                currentLineWidth = wordWidth;
            } else {
                currentLine.push(span);
                currentLineWidth += totalWidth;
            }
        }

        if (currentLine.length > 0) {
            lines.push(currentLine);
        }

        return lines;
    }

    applyOptimizedLayout(lines, textContent) {
        textContent.innerHTML = '';

        lines.forEach((lineSpans, lineIndex) => {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'text-line';
            lineDiv.dataset.lineIndex = String(lineIndex);

            lineSpans.forEach((span, wordIndex) => {
                lineDiv.appendChild(span);
                // Spacing contract: one ASCII space separator between words.
                if (wordIndex < lineSpans.length - 1) {
                    lineDiv.appendChild(document.createTextNode(this.interWordSeparator));
                }
            });

            textContent.appendChild(lineDiv);
        });
    }

    balanceLines(container, callback) {
        if (!container) return;

        const textContent = container.classList.contains('text-content')
            ? container
            : container.querySelector('.text-content');
        if (!textContent) {
            if (callback) callback();
            return;
        }

        const computedStyle = window.getComputedStyle(textContent);
        const fontFamily = computedStyle.fontFamily;
        const fontSize = Number.parseFloat(computedStyle.fontSize) || 16;
        this.initializeMeasurement(textContent, fontFamily, fontSize);

        const wordSpans = Array.from(textContent.querySelectorAll('.word'));
        if (wordSpans.length === 0) {
            if (callback) callback();
            return;
        }

        const firstWordStyle = window.getComputedStyle(wordSpans[0]);
        const wordHorizontalPadding =
            (Number.parseFloat(firstWordStyle.paddingLeft) || 0) +
            (Number.parseFloat(firstWordStyle.paddingRight) || 0);

        const lines = this.distributeWordSpansIntoLines(wordSpans, wordHorizontalPadding);
        this.applyOptimizedLayout(lines, textContent);

        if (callback) callback();
    }

    handleWindowResize() {
        if (!this.container) return;

        const currentWidth = this.container.getBoundingClientRect().width;
        if (Math.abs(currentWidth - this.lastContainerWidth) < 20) return;

        this.lastContainerWidth = currentWidth;
        this.workingWidth = currentWidth;
        this.balanceLines(this.container);
    }

    setupWindowResizeListener() {
        if (this.resizeHandler) return;
        this.resizeHandler = () => this.handleWindowResize();
        window.addEventListener('resize', this.resizeHandler);
    }

    // --- word-element caching / resolution / initial highlight ---

    cacheWordElements(container) {
        if (!container) {
            this.wordElements = [];
            return;
        }
        this.wordElements = Array.from(container.querySelectorAll('.word, .word-lite'));
    }

    getCurrentWordElements() {
        return this.wordElements;
    }

    takeCachedElements() {
        const previous = this.wordElements;
        this.wordElements = [];
        return previous;
    }

    resolveCurrentWordElements(container, expectedCount = null) {
        if (!container) {
            this.wordElements = [];
            return [];
        }

        const cachedWords = Array.isArray(this.wordElements) ? this.wordElements : [];
        const hasExpectedCount = Number.isInteger(expectedCount) && expectedCount >= 0;
        const cachedWordsAreCurrent = cachedWords.length > 0 &&
            cachedWords.every((word) => word?.isConnected === true && container.contains(word)) &&
            (!hasExpectedCount || cachedWords.length === expectedCount);

        if (cachedWordsAreCurrent) {
            return cachedWords;
        }

        this.cacheWordElements(container);
        const refreshedWords = Array.isArray(this.wordElements) ? this.wordElements : [];
        if (!hasExpectedCount || refreshedWords.length === expectedCount) {
            return refreshedWords;
        }

        throw new Error(
            `[WordDomRenderer] Word-element mismatch. Expected ${expectedCount}, found ${refreshedWords.length}.`
        );
    }

    applyInitialHighlighting() {
        const words = this.getCurrentWordElements();
        if (!words || words.length === 0) return;

        words.forEach((word, index) => {
            word.classList.remove('active', 'lookahead', 'lookback', 'inactive-read', 'inactive-future', 'paused', 'paused-word');
            if (index === 0) {
                word.classList.add('active');
            } else {
                word.classList.add('inactive-future');
            }
        });
    }
}

window.WordDomRenderer = WordDomRenderer;
