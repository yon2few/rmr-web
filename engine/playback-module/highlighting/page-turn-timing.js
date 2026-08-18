// Page-turn land/flip schedule. Pure functions so Node can test gap classes
// without a browser. Display and getCurrentPageForTime call these.
// Do not import config.js here — it writes document CSS vars on load.

export const PAGE_START_EPSILON = 0.03;

export function getPageTurnTimingSeconds(cfg) {
    const timings = cfg?.timings || {};
    const holdMs = Number(timings.pageTurnHoldMs);
    const leadMs = Number(timings.pageTurnLeadMs);
    const switchMs = Number(timings.pageTurnSwitchBudgetMs);
    return {
        hold: (Number.isFinite(holdMs) && holdMs > 0 ? holdMs : 300) / 1000,
        lead: (Number.isFinite(leadMs) && leadMs > 0 ? leadMs : 500) / 1000,
        switchBudget: (Number.isFinite(switchMs) && switchMs > 0 ? switchMs : 200) / 1000
    };
}

export function resolvePageFlipTimes(pages, cfg) {
    if (!Array.isArray(pages) || pages.length === 0) {
        return [];
    }

    const { lead, switchBudget } = getPageTurnTimingSeconds(cfg);
    const flipTimes = [];

    for (let i = 0; i < pages.length; i++) {
        const start = typeof pages[i]?.start === 'number' ? pages[i].start : 0;
        if (i === 0) {
            flipTimes.push(start);
            continue;
        }

        const prevEnd = typeof pages[i - 1]?.end === 'number' ? pages[i - 1].end : start;
        const spokenAt = start;
        const land = Math.max(prevEnd, spokenAt - lead);
        const flip = Math.max(prevEnd, land - switchBudget);
        flipTimes.push(flip);
    }

    return flipTimes;
}

export function lookupPageIndexForTime(rawTime, pages, flipTimes, options = {}) {
    if (!Array.isArray(pages) || pages.length === 0) {
        return 0;
    }
    if (!Array.isArray(flipTimes) || flipTimes.length !== pages.length) {
        throw new Error('[PageTurnTiming] flipTimes must match pages length.');
    }

    const allowSeekUndershoot = options.allowSeekUndershoot === true;
    const time = allowSeekUndershoot
        ? rawTime + PAGE_START_EPSILON
        : rawTime;

    let low = 0;
    let high = flipTimes.length - 1;
    let resultIndex = 0;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (time >= flipTimes[mid]) {
            resultIndex = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    if (!allowSeekUndershoot && resultIndex > 0) {
        const prevEnd = pages[resultIndex - 1]?.end;
        if (Number.isFinite(prevEnd) && rawTime < prevEnd) {
            return resultIndex - 1;
        }
    }

    return resultIndex;
}

if (typeof window !== 'undefined') {
    window.ArtReaderPageTurnTiming = {
        PAGE_START_EPSILON,
        getPageTurnTimingSeconds,
        resolvePageFlipTimes,
        lookupPageIndexForTime
    };
}
