(function () {
    function readRequiredObject(value, fieldName) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`[ArtReaderBackendTransport] ${fieldName} must be an object.`);
        }
        return value;
    }

    function readRequiredEndpoint(endpoint) {
        if (typeof endpoint !== 'string' || !endpoint.trim()) {
            throw new Error('[ArtReaderBackendTransport] endpoint is required.');
        }
        return endpoint.trim();
    }

    function readHeaders(headers) {
        if (headers === undefined) {
            return {};
        }
        if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
            throw new Error('[ArtReaderBackendTransport] headers must be an object.');
        }
        return headers;
    }

    function parseErrorPayload(rawText, status) {
        let message = `Backend request failed: ${status}`;
        try {
            const payload = JSON.parse(rawText);
            if (typeof payload?.error === 'string' && payload.error.trim()) {
                message = payload.error.trim();
                if (typeof payload?.details === 'string' && payload.details.trim()) {
                    message += ` - ${payload.details.trim()}`;
                }
                return message;
            }
            if (typeof payload?.details === 'string' && payload.details.trim()) {
                return `${message} - ${payload.details.trim()}`;
            }
        } catch (error) {}

        const normalizedText = typeof rawText === 'string' ? rawText.trim() : '';
        if (normalizedText) {
            return `${message} ${normalizedText}`;
        }
        return message;
    }

    function parseStreamEvent(line) {
        try {
            return JSON.parse(line);
        } catch (error) {
            throw new Error(`[ArtReaderBackendTransport] Invalid streamed JSON event: ${line}`);
        }
    }

    function buildStreamErrorMessage(event) {
        if (!event || typeof event !== 'object' || Array.isArray(event)) {
            return 'Backend stream failed.';
        }

        const parts = [];

        if (typeof event.error === 'string' && event.error.trim()) {
            parts.push(event.error.trim());
        }
        if (typeof event.message === 'string' && event.message.trim()) {
            parts.push(event.message.trim());
        }
        if (typeof event.details === 'string' && event.details.trim()) {
            parts.push(event.details.trim());
        }

        const diagnostic = event.diagnostic;
        if (diagnostic && typeof diagnostic === 'object' && !Array.isArray(diagnostic)) {
            if (typeof diagnostic.message === 'string' && diagnostic.message.trim()) {
                parts.push(diagnostic.message.trim());
            }
            if (typeof diagnostic.subsystem === 'string' && diagnostic.subsystem.trim()) {
                parts.push(`subsystem: ${diagnostic.subsystem.trim()}`);
            }
            if (typeof diagnostic.stage === 'string' && diagnostic.stage.trim()) {
                parts.push(`stage: ${diagnostic.stage.trim()}`);
            }
            if (Number.isInteger(diagnostic.chunkIndex)) {
                parts.push(`chunk: ${diagnostic.chunkIndex + 1}`);
            }
        }

        if (typeof event.jobId === 'string' && event.jobId.trim()) {
            parts.push(`jobId: ${event.jobId.trim()}`);
        }

        const uniqueParts = [...new Set(parts.filter(Boolean))];
        return uniqueParts.length > 0 ? uniqueParts.join(' — ') : 'Backend stream failed.';
    }

    function throwStreamErrorEvent(event) {
        throw new Error(buildStreamErrorMessage(event));
    }

    function normalizeChunk(chunk, chunkIndex) {
        if (!chunk || typeof chunk !== 'object') {
            throw new Error(`[ArtReaderBackendTransport] Chunk ${chunkIndex} must be an object.`);
        }
        if (!Array.isArray(chunk.pages) || chunk.pages.length === 0) {
            throw new Error(`[ArtReaderBackendTransport] Chunk ${chunkIndex} is missing pages.`);
        }
        if (!chunk.fullChunkDisplay?.displayElements) {
            throw new Error(`[ArtReaderBackendTransport] Chunk ${chunkIndex} is missing fullChunkDisplay.displayElements.`);
        }

        const audioUrl = chunk.moduleAudioUrl || chunk.localAudioUrl || chunk.remoteAudioUrl || chunk.audioUrl;
        if (!audioUrl || typeof audioUrl !== 'string') {
            throw new Error(`[ArtReaderBackendTransport] Chunk ${chunkIndex} is missing an audio URL.`);
        }

        return {
            ...chunk,
            chunkIndex,
            moduleAudioUrl: audioUrl
        };
    }

    const transport = {
        async postJsonStream({ endpoint, headers = {}, payload }) {
            const normalizedEndpoint = readRequiredEndpoint(endpoint);
            const normalizedHeaders = readHeaders(headers);
            const normalizedPayload = readRequiredObject(payload, 'payload');

            const response = await fetch(normalizedEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...normalizedHeaders
                },
                body: JSON.stringify(normalizedPayload)
            });

            if (!response.ok) {
                const rawText = await response.text();
                throw new Error(parseErrorPayload(rawText, response.status));
            }

            if (!response.body || typeof response.body.getReader !== 'function') {
                return response.json();
            }

            return response.body;
        },

        async consumeNdjsonStream(stream, hooks = {}) {
            if (!stream || typeof stream.getReader !== 'function') {
                throw new Error('[ArtReaderBackendTransport] stream must be a readable stream.');
            }
            if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
                throw new Error('[ArtReaderBackendTransport] hooks must be an object.');
            }

            const reader = stream.getReader();
            const decoder = new TextDecoder();
            const chunks = [];
            let bufferedText = '';
            let requestTitle = '';
            let sessionId = '';
            let totalChunks = null;

            while (true) {
                const { value, done } = await reader.read();
                bufferedText += decoder.decode(value || new Uint8Array(), { stream: !done });

                const lines = bufferedText.split('\n');
                bufferedText = lines.pop() || '';

                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line) {
                        continue;
                    }

                    const event = parseStreamEvent(line);
                    if (!event || typeof event !== 'object') {
                        throw new Error('[ArtReaderBackendTransport] Stream event must be an object.');
                    }

                    if (hooks.onEvent) {
                        await hooks.onEvent(event);
                    }

                    switch (event.type) {
                        case 'progress':
                            if (hooks.onProgress) {
                                await hooks.onProgress(event);
                            }
                            break;
                        case 'job-start':
                            if (!Number.isInteger(event.totalChunks) || event.totalChunks < 1) {
                                throw new Error('[ArtReaderBackendTransport] job-start missing valid totalChunks.');
                            }
                            totalChunks = event.totalChunks;
                            requestTitle = typeof event.title === 'string' ? event.title : requestTitle;
                            sessionId = typeof event.jobId === 'string' && event.jobId.trim() ? event.jobId : sessionId;
                            if (hooks.onJobStart) {
                                await hooks.onJobStart(event);
                            }
                            break;
                        case 'chunk-ready':
                            if (!Number.isInteger(event.chunkIndex)) {
                                throw new Error('[ArtReaderBackendTransport] chunk-ready missing valid chunkIndex.');
                            }
                            event.chunk = normalizeChunk(event.chunk, event.chunkIndex);
                            chunks[event.chunkIndex] = event.chunk;
                            if (hooks.onChunkReady) {
                                await hooks.onChunkReady(event);
                            }
                            break;
                        case 'complete':
                            if (hooks.onComplete) {
                                await hooks.onComplete(event);
                            }
                            break;
                        case 'error':
                            throwStreamErrorEvent(event);
                            break;
                        default:
                            throw new Error(`[ArtReaderBackendTransport] Unsupported stream event type: ${event.type}`);
                    }
                }

                if (done) {
                    break;
                }
            }

            if (bufferedText.trim()) {
                const event = parseStreamEvent(bufferedText.trim());
                if (!event || typeof event !== 'object') {
                    throw new Error('[ArtReaderBackendTransport] Stream event must be an object.');
                }
                if (hooks.onEvent) {
                    await hooks.onEvent(event);
                }
                switch (event.type) {
                    case 'progress':
                        if (hooks.onProgress) {
                            await hooks.onProgress(event);
                        }
                        break;
                    case 'job-start':
                        if (!Number.isInteger(event.totalChunks) || event.totalChunks < 1) {
                            throw new Error('[ArtReaderBackendTransport] job-start missing valid totalChunks.');
                        }
                        totalChunks = event.totalChunks;
                        requestTitle = typeof event.title === 'string' ? event.title : requestTitle;
                        sessionId = typeof event.jobId === 'string' && event.jobId.trim() ? event.jobId : sessionId;
                        if (hooks.onJobStart) {
                            await hooks.onJobStart(event);
                        }
                        break;
                    case 'chunk-ready':
                        if (!Number.isInteger(event.chunkIndex)) {
                            throw new Error('[ArtReaderBackendTransport] chunk-ready missing valid chunkIndex.');
                        }
                        event.chunk = normalizeChunk(event.chunk, event.chunkIndex);
                        chunks[event.chunkIndex] = event.chunk;
                        if (hooks.onChunkReady) {
                            await hooks.onChunkReady(event);
                        }
                        break;
                    case 'complete':
                        if (hooks.onComplete) {
                            await hooks.onComplete(event);
                        }
                        break;
                    case 'error':
                        throwStreamErrorEvent(event);
                        break;
                    default:
                        throw new Error(`[ArtReaderBackendTransport] Unsupported stream event type: ${event.type}`);
                }
            }

            if (!Number.isInteger(totalChunks) || totalChunks < 1) {
                throw new Error('[ArtReaderBackendTransport] Stream completed without job-start.');
            }
            if (chunks.length !== totalChunks || chunks.some((chunk) => !chunk)) {
                throw new Error('[ArtReaderBackendTransport] Stream completed before all chunks were returned.');
            }

            return {
                sessionId,
                requestTitle,
                audioChunks: chunks,
                totalChunks
            };
        },

    };

    window.ArtReaderBackendTransport = transport;
}());
