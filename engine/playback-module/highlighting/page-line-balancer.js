// Page Line Balancer - Intelligent line balancing within CSS constraints
import { ArtReaderHighlightingConfig } from './config.js';

export class PageLineBalancer {
    constructor() {
        this.canvas = null;
        this.context = null;
        this.container = null;
        this.lastContainerWidth = 0;
        this.resizeHandler = null;
        this.workingWidth = 0;
        this.interWordSeparator = ' ';
    }

    initializeMeasurement(container, fontFamily, fontSize) {
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.context = this.canvas.getContext('2d');
        }

        // Measure with active-word scaling applied so line math matches highlight geometry.
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

    optimizeLineBalance(container, callback) {
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
        this.optimizeLineBalance(this.container);
    }

    setupWindowResizeListener() {
        if (this.resizeHandler) return;
        this.resizeHandler = () => this.handleWindowResize();
        window.addEventListener('resize', this.resizeHandler);
    }

}

window.PageLineBalancer = PageLineBalancer;
