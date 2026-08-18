import {
    PAGE_START_EPSILON,
    resolvePageFlipTimes,
    lookupPageIndexForTime
} from './playback-module/highlighting/page-turn-timing.js';

const cfg = {
    timings: {
        pageTurnHoldMs: 300,
        pageTurnLeadMs: 500,
        pageTurnSwitchBudgetMs: 200
    }
};

function pagesFrom(prevEnd, nextStart) {
    return [
        { start: 0, end: prevEnd },
        { start: nextStart, end: nextStart + 1 }
    ];
}

const rows = [
    { name: 'abutting', prevEnd: 4.0, T: 4.0, land: 4.0, flip: 4.0 },
    { name: 'under 200ms', prevEnd: 4.0, T: 4.2, land: 4.0, flip: 4.0 },
    { name: 'under 300ms', prevEnd: 4.0, T: 4.3, land: 4.0, flip: 4.0 },
    { name: 'under 400ms', prevEnd: 4.0, T: 4.4, land: 4.0, flip: 4.0 },
    { name: 'exactly 500ms', prevEnd: 4.0, T: 4.5, land: 4.0, flip: 4.0 },
    { name: 'over 800ms', prevEnd: 4.0, T: 4.8, land: 4.3, flip: 4.1 },
    { name: 'over 2.0s', prevEnd: 4.0, T: 6.0, land: 5.5, flip: 5.3 }
];

let failed = 0;
for (const row of rows) {
    const pages = pagesFrom(row.prevEnd, row.T);
    const flips = resolvePageFlipTimes(pages, cfg);
    const flip = flips[1];
    if (Math.abs(flip - row.flip) > 1e-9) {
        console.error(`FAIL ${row.name}: flip ${flip} expected ${row.flip}`);
        failed += 1;
    }
}

const longPages = pagesFrom(4.0, 6.0);
const longFlips = resolvePageFlipTimes(longPages, cfg);

const sequentialBeforeEnd = lookupPageIndexForTime(3.99, longPages, longFlips, {
    allowSeekUndershoot: false
});
if (sequentialBeforeEnd !== 0) {
    console.error(`FAIL sequential prev.end-0.01: page ${sequentialBeforeEnd} expected 0`);
    failed += 1;
}

const sequentialAtEnd = lookupPageIndexForTime(4.0, longPages, longFlips, {
    allowSeekUndershoot: false
});
if (sequentialAtEnd !== 0) {
    // flip for 2s gap is 5.3; at 4.0 we are still sitting on page 0
    console.error(`FAIL sequential at prev.end during long gap: page ${sequentialAtEnd} expected 0`);
    failed += 1;
}

const sequentialAtFlip = lookupPageIndexForTime(5.3, longPages, longFlips, {
    allowSeekUndershoot: false
});
if (sequentialAtFlip !== 1) {
    console.error(`FAIL sequential at flip: page ${sequentialAtFlip} expected 1`);
    failed += 1;
}

const abutPages = pagesFrom(4.0, 4.0);
const abutFlips = resolvePageFlipTimes(abutPages, cfg);
const sequentialDuringLastWord = lookupPageIndexForTime(3.99, abutPages, abutFlips, {
    allowSeekUndershoot: false
});
if (sequentialDuringLastWord !== 0) {
    console.error(`FAIL sequential during last word: page ${sequentialDuringLastWord} expected 0`);
    failed += 1;
}

const seekUndershoot = lookupPageIndexForTime(5.98, longPages, longFlips, {
    allowSeekUndershoot: true
});
// T=6.0, flip=5.3; 5.98 + 0.03 > 5.3 → page 1
if (seekUndershoot !== 1) {
    console.error(`FAIL seek undershoot: page ${seekUndershoot} expected 1`);
    failed += 1;
}

if (Math.abs(PAGE_START_EPSILON - 0.03) > 1e-12) {
    console.error('FAIL epsilon constant');
    failed += 1;
}

if (failed > 0) {
    process.exit(1);
}
console.log(`ok ${rows.length} gap rows + lookup guards`);
