class LocalAudioArtifactStore {
    constructor(player) {
        if (!player || typeof player !== 'object') {
            throw new Error('[LocalAudio] player is required.');
        }
        this.player = player;
        this.reset();
    }

    reset() {
        this.revokeAllObjectUrls();
        this.chunkAudioEntries = new Map();
        this.stitchGapDurationsSeconds = null;
    }

    revokeAllObjectUrls() {
        if (!(this.chunkAudioEntries instanceof Map)) {
            return;
        }

        for (const entry of this.chunkAudioEntries.values()) {
            if (typeof entry?.audioObjectUrl === 'string' && entry.audioObjectUrl.startsWith('blob:')) {
                URL.revokeObjectURL(entry.audioObjectUrl);
            }
        }
    }

    invalidateGapPlan() {
        this.stitchGapDurationsSeconds = null;
    }

    normalizeChunkIndex(chunkIndex) {
        if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
            throw new Error(`[LocalAudioArtifactStore] Invalid chunk index: ${chunkIndex}`);
        }
        return chunkIndex;
    }

    getExpectedChunkCount() {
        const totalChunks = this.player.totalChunks;
        if (!Number.isInteger(totalChunks) || totalChunks < 1) {
            return 0;
        }
        return totalChunks;
    }

    getLocalAudioReadyChunkCount() {
        return this.chunkAudioEntries.size;
    }

    hasCompleteLocalAudio() {
        const expectedChunkCount = this.getExpectedChunkCount();
        return expectedChunkCount > 0 && this.getLocalAudioReadyChunkCount() === expectedChunkCount;
    }

    getChunkAudioEntryOrThrow(chunkIndex) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        const entry = this.chunkAudioEntries.get(normalizedChunkIndex);
        if (!entry) {
            throw new Error(`Local audio is missing for chunk ${formatChunkOrdinal(normalizedChunkIndex)}.`);
        }
        return entry;
    }

    getChunkAudioBlobOrThrow(chunkIndex) {
        return this.getChunkAudioEntryOrThrow(chunkIndex).audioBlob;
    }

    async fetchAudioBlobOrThrow(audioUrl, chunkIndex, fetchOptions = {}) {
        if (typeof audioUrl !== 'string' || !audioUrl.trim()) {
            throw new Error(`Chunk ${formatChunkOrdinal(chunkIndex)} audioUrl is required for local audio capture.`);
        }

        const response = await fetch(audioUrl, fetchOptions);
        if (!response.ok) {
            throw new Error(`Chunk ${formatChunkOrdinal(chunkIndex)} audio fetch failed with status ${response.status}.`);
        }

        const audioBlob = await response.blob();
        if (!(audioBlob instanceof Blob) || audioBlob.size <= 0) {
            throw new Error(`Chunk ${formatChunkOrdinal(chunkIndex)} audio fetch returned an empty blob.`);
        }

        return audioBlob;
    }

    storeChunkAudioBlob(chunkIndex, chunk, audioBlob) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        if (!chunk || typeof chunk !== 'object') {
            throw new Error(`Chunk ${formatChunkOrdinal(normalizedChunkIndex)} payload is required for local audio storage.`);
        }
        if (!(audioBlob instanceof Blob) || audioBlob.size <= 0) {
            throw new Error(`Chunk ${formatChunkOrdinal(normalizedChunkIndex)} audio blob is invalid.`);
        }

        const existingEntry = this.chunkAudioEntries.get(normalizedChunkIndex);
        if (existingEntry?.audioObjectUrl) {
            URL.revokeObjectURL(existingEntry.audioObjectUrl);
        }

        const audioObjectUrl = URL.createObjectURL(audioBlob);
        const remoteAudioUrl = typeof chunk.remoteAudioUrl === 'string' && chunk.remoteAudioUrl.trim()
            ? chunk.remoteAudioUrl.trim()
            : (typeof chunk.audioUrl === 'string' ? chunk.audioUrl.trim() : '');

        chunk.remoteAudioUrl = remoteAudioUrl;
        chunk.audioUrl = audioObjectUrl;
        chunk.playbackAudioUrl = audioObjectUrl;

        this.chunkAudioEntries.set(normalizedChunkIndex, {
            chunkIndex: normalizedChunkIndex,
            audioBlob,
            audioObjectUrl,
            remoteAudioUrl
        });
        this.invalidateGapPlan();
        return audioObjectUrl;
    }

    async materializeChunkAudio(chunkIndex, chunk) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        if (!chunk || typeof chunk !== 'object') {
            throw new Error(`Chunk ${formatChunkOrdinal(normalizedChunkIndex)} is required for local audio materialization.`);
        }

        if (this.chunkAudioEntries.has(normalizedChunkIndex)) {
            const existingEntry = this.chunkAudioEntries.get(normalizedChunkIndex);
            chunk.audioUrl = existingEntry.audioObjectUrl;
            chunk.playbackAudioUrl = existingEntry.audioObjectUrl;
            return existingEntry.audioObjectUrl;
        }

        const sourceAudioUrl = typeof chunk.audioUrl === 'string' ? chunk.audioUrl.trim() : '';
        if (!sourceAudioUrl) {
            throw new Error(`Chunk ${formatChunkOrdinal(normalizedChunkIndex)} audioUrl is missing.`);
        }

        const audioBlob = await this.fetchAudioBlobOrThrow(sourceAudioUrl, normalizedChunkIndex);
        return this.storeChunkAudioBlob(normalizedChunkIndex, chunk, audioBlob);
    }

    // Approved exception (2026-07-31) to this repo's "no fallback behavior:
    // throw clear errors" rule (AGENTS.md). A chunk's fetched audio blob can
    // decode-fail in the browser (MEDIA_ERR_DECODE) despite a successful,
    // non-empty fetch — most plausibly a truncated transfer on a flaky mobile
    // connection. Re-fetches the chunk's original remote URL fresh (bypassing
    // HTTP cache) and replaces the stored blob. Caller is responsible for
    // logging the retry visibly and limiting it to one attempt per chunk.
    async retryMaterializeChunkAudio(chunkIndex, chunk) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        if (!chunk || typeof chunk !== 'object') {
            throw new Error(`Chunk ${formatChunkOrdinal(normalizedChunkIndex)} is required for local audio materialization.`);
        }

        const existingEntry = this.chunkAudioEntries.get(normalizedChunkIndex);
        const remoteAudioUrl = (existingEntry?.remoteAudioUrl || chunk.remoteAudioUrl || '').trim();
        if (!remoteAudioUrl) {
            throw new Error(`Chunk ${formatChunkOrdinal(normalizedChunkIndex)} has no remote source URL to retry from.`);
        }

        if (existingEntry?.audioObjectUrl) {
            URL.revokeObjectURL(existingEntry.audioObjectUrl);
        }
        this.chunkAudioEntries.delete(normalizedChunkIndex);

        const audioBlob = await this.fetchAudioBlobOrThrow(remoteAudioUrl, normalizedChunkIndex, { cache: 'reload' });
        return this.storeChunkAudioBlob(normalizedChunkIndex, chunk, audioBlob);
    }

    async materializeAllChunks(chunks) {
        if (!Array.isArray(chunks) || chunks.length === 0) {
            throw new Error('A non-empty chunk array is required for local audio materialization.');
        }

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
            await this.materializeChunkAudio(chunkIndex, chunks[chunkIndex]);
        }
    }

    getOrCreateGapPlan() {
        if (Array.isArray(this.stitchGapDurationsSeconds)) {
            return [...this.stitchGapDurationsSeconds];
        }

        const expectedChunkCount = this.getExpectedChunkCount();
        if (expectedChunkCount < 1) {
            throw new Error('A completed local chunk set is required before creating a stitch gap plan.');
        }

        if (!this.hasCompleteLocalAudio()) {
            throw new Error('A stitch gap plan cannot be created until every chunk audio blob is available locally.');
        }

        const gapDurationsSeconds = [];
        for (let index = 0; index < expectedChunkCount - 1; index += 1) {
            const randomUnit = Math.random();
            gapDurationsSeconds.push(Number((0.5 + (0.6 * randomUnit)).toFixed(3)));
        }

        this.stitchGapDurationsSeconds = gapDurationsSeconds;
        return [...gapDurationsSeconds];
    }

    buildArchiveManifest() {
        if (!this.player.computeHasCompleteLocalSession()) {
            throw new Error('A complete local session is required before saving.');
        }

        if (!Array.isArray(this.player.audioChunks) || this.player.audioChunks.length === 0) {
            throw new Error('Audio chunks are required for archive generation.');
        }

        const serializedChunks = this.player.audioChunks.map((chunk, chunkIndex) => {
            if (!chunk || typeof chunk !== 'object') {
                throw new Error(`Chunk ${formatChunkOrdinal(chunkIndex)} is missing from the current session.`);
            }

            const { audioUrl, playbackAudioUrl, remoteAudioUrl, ...persistedChunk } = chunk;

            return {
                ...persistedChunk,
                savedAudioPath: `audio/chunk_${chunkIndex}.mp3`,
                remoteAudioUrl: typeof remoteAudioUrl === 'string' ? remoteAudioUrl : ''
            };
        });

        return {
            sessionId: this.player.sessionId,
            requestTitle: this.player.getRequestTitle(),
            audioChunks: serializedChunks,
            chunkPages: this.player.chunkPages,
            totalChunks: this.player.totalChunks,
            stitchGapDurationsSeconds: Array.isArray(this.stitchGapDurationsSeconds)
                ? [...this.stitchGapDurationsSeconds]
                : null
        };
    }

    async restoreFromArchive({ data, zip }) {
        if (!data || typeof data !== 'object') {
            throw new Error('Archive data is required for local audio restoration.');
        }
        if (!zip || typeof zip.file !== 'function') {
            throw new Error('A JSZip archive is required for local audio restoration.');
        }
        if (!Array.isArray(data.audioChunks) || data.audioChunks.length === 0) {
            throw new Error('Archived audioChunks are required for local audio restoration.');
        }

        this.reset();

        for (let chunkIndex = 0; chunkIndex < data.audioChunks.length; chunkIndex += 1) {
            const chunk = data.audioChunks[chunkIndex];
            if (!chunk || typeof chunk !== 'object') {
                throw new Error(`Archived chunk ${formatChunkOrdinal(chunkIndex)} is invalid.`);
            }
            if (typeof chunk.savedAudioPath !== 'string' || !chunk.savedAudioPath.trim()) {
                throw new Error(`Archived chunk ${formatChunkOrdinal(chunkIndex)} is missing savedAudioPath.`);
            }

            const archiveEntry = zip.file(chunk.savedAudioPath);
            if (!archiveEntry) {
                throw new Error(`Archived audio file not found: ${chunk.savedAudioPath}`);
            }

            const audioBlob = await archiveEntry.async('blob');
            this.storeChunkAudioBlob(chunkIndex, chunk, audioBlob);
        }

        if (data.stitchGapDurationsSeconds !== null && data.stitchGapDurationsSeconds !== undefined) {
            if (!Array.isArray(data.stitchGapDurationsSeconds)) {
                throw new Error('Archived stitchGapDurationsSeconds must be an array or null.');
            }
            this.stitchGapDurationsSeconds = data.stitchGapDurationsSeconds.map((value, index) => {
                if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
                    throw new Error(`Archived stitch gap duration ${index + 1} is invalid.`);
                }
                return value;
            });
        }
    }
}
