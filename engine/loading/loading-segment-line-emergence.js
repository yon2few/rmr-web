window.SegmentLineEmergence = (function () {
    'use strict';

    const TAIL_LENGTH = 26;

    function deriveTail(source, tailLength) {
        const length = tailLength ?? TAIL_LENGTH;
        if (typeof source !== 'string' || source.length === 0) {
            throw new Error('[SegmentLineEmergence] Source must be a non-empty string.');
        }
        if (source.length < length) {
            throw new Error(
                `[SegmentLineEmergence] Source must be at least ${length} characters (got ${source.length}).`
            );
        }
        return source.slice(-length);
    }

    function buildAtomicRanges(tail) {
        const ranges = [];

        if (/^[A-Za-z]/.test(tail)) {
            let wordEnd = 0;
            while (wordEnd < tail.length && tail[wordEnd] !== ' ') {
                wordEnd += 1;
            }
            const spanEnd = wordEnd < tail.length ? wordEnd + 1 : wordEnd;
            if (spanEnd > 0) {
                ranges.push({ start: 0, end: spanEnd });
            }
        }

        let searchFrom = 0;
        while (searchFrom < tail.length) {
            const artIndex = tail.indexOf('ArT', searchFrom);
            if (artIndex === -1) {
                break;
            }
            ranges.push({ start: artIndex, end: artIndex + 3 });
            searchFrom = artIndex + 3;
        }

        return ranges;
    }

    function getVisibleSuffix(elapsedSecs, tail, atomicRanges) {
        const total = tail.length;
        if (total === 0 || elapsedSecs <= 0) {
            return '';
        }
        const charsToShow = Math.min(total, elapsedSecs);
        if (charsToShow <= 0) {
            return '';
        }
        let start = total - charsToShow;
        for (const range of atomicRanges) {
            if (start > range.start && start < range.end) {
                start = range.start;
            }
        }
        return tail.slice(start);
    }

    function configure(source, tailLength) {
        const length = tailLength ?? TAIL_LENGTH;
        const tail = deriveTail(source, length);
        return Object.freeze({
            tail,
            tailLength: length,
            atomicRanges: buildAtomicRanges(tail)
        });
    }

    function apply(elapsedSecs, root, tailConfig) {
        const sentenceEl = root.querySelector('[data-role="segment-line-sentence"]');
        if (!sentenceEl) {
            throw new Error('[SegmentLineEmergence] Missing [data-role="segment-line-sentence"] element.');
        }
        sentenceEl.textContent = getVisibleSuffix(elapsedSecs, tailConfig.tail, tailConfig.atomicRanges);
    }

    return Object.freeze({
        TAIL_LENGTH,
        deriveTail,
        buildAtomicRanges,
        getVisibleSuffix,
        configure,
        apply
    });
})();
