class Mp3ExportService {
    constructor(player) {
        if (!player || typeof player !== 'object') {
            throw new Error('[Mp3Export] player is required.');
        }
        this.player = player;
        this.exportSampleRate = 44100;
        this.exportBitrateKbps = 192;
    }

    buildDownloadFileBaseName() {
        const baseName = this.player.buildFileBaseName();
        const exportedAt = new Date();
        const year = exportedAt.getFullYear();
        const month = String(exportedAt.getMonth() + 1).padStart(2, '0');
        const day = String(exportedAt.getDate()).padStart(2, '0');
        const hours = String(exportedAt.getHours()).padStart(2, '0');
        const minutes = String(exportedAt.getMinutes()).padStart(2, '0');
        const seconds = String(exportedAt.getSeconds()).padStart(2, '0');
        return `${baseName} - ${year}-${month}-${day} - ${hours}-${minutes}-${seconds}`;
    }

    setExportButtonsBusy(isBusy) {
        const exportBtns = document.querySelectorAll('#exportBtn');
        exportBtns.forEach((btn) => {
            if (!(btn instanceof HTMLButtonElement)) {
                throw new Error('Export button binding must target button elements.');
            }

            if (!btn.dataset.originalHtml) {
                btn.dataset.originalHtml = btn.innerHTML;
            }

            btn.innerHTML = isBusy ? '⏳' : (btn.dataset.originalHtml || '↑ MP3');
            btn.disabled = isBusy || !this.player.computeHasCompleteLocalSession();
        });
    }

    triggerBrowserDownload(downloadUrl, fileName) {
        if (typeof downloadUrl !== 'string' || !downloadUrl.trim()) {
            throw new Error('downloadUrl is required.');
        }
        if (typeof fileName !== 'string' || !fileName.trim()) {
            throw new Error('fileName is required.');
        }

        const anchor = document.createElement('a');
        anchor.style.display = 'none';
        anchor.href = downloadUrl;
        anchor.download = fileName;
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
    }

    getAudioContextConstructor() {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (typeof AudioContextCtor !== 'function') {
            throw new Error('Web Audio AudioContext is unavailable in this browser.');
        }
        return AudioContextCtor;
    }

    getOfflineAudioContextConstructor() {
        const OfflineAudioContextCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (typeof OfflineAudioContextCtor !== 'function') {
            throw new Error('Web Audio OfflineAudioContext is unavailable in this browser.');
        }
        return OfflineAudioContextCtor;
    }

    getLameJsOrThrow() {
        if (!window.lamejs || typeof window.lamejs.Mp3Encoder !== 'function') {
            throw new Error('lamejs is required for local MP3 export.');
        }
        return window.lamejs;
    }

    async decodeChunkBuffers() {
        const AudioContextCtor = this.getAudioContextConstructor();
        const decodeContext = new AudioContextCtor();
        try {
            const decodedBuffers = [];
            for (let chunkIndex = 0; chunkIndex < this.player.totalChunks; chunkIndex += 1) {
                const audioBlob = this.player.localAudio.getChunkAudioBlobOrThrow(chunkIndex);
                const arrayBuffer = await audioBlob.arrayBuffer();
                const decodeInput = arrayBuffer.slice(0);
                const decodedBuffer = await decodeContext.decodeAudioData(decodeInput);
                if (!(decodedBuffer instanceof AudioBuffer) || decodedBuffer.length === 0) {
                    throw new Error(`Decoded audio buffer is invalid for chunk ${formatChunkOrdinal(chunkIndex)}.`);
                }
                decodedBuffers.push(decodedBuffer);
            }
            return decodedBuffers;
        } finally {
            if (typeof decodeContext.close === 'function') {
                await decodeContext.close();
            }
        }
    }

    async renderStitchedAudioBuffer(decodedBuffers, gapDurationsSeconds) {
        if (!Array.isArray(decodedBuffers) || decodedBuffers.length === 0) {
            throw new Error('Decoded chunk buffers are required for stitched MP3 export.');
        }
        if (!Array.isArray(gapDurationsSeconds)) {
            throw new Error('gapDurationsSeconds must be an array for stitched MP3 export.');
        }
        if (gapDurationsSeconds.length !== Math.max(0, decodedBuffers.length - 1)) {
            throw new Error('gapDurationsSeconds length must match the number of chunk boundaries.');
        }

        const totalDurationSeconds = decodedBuffers.reduce((duration, buffer, index) => {
            const nextDuration = duration + buffer.duration;
            const gapDuration = gapDurationsSeconds[index] ?? 0;
            return nextDuration + gapDuration;
        }, 0);

        const totalFrameCount = Math.ceil(totalDurationSeconds * this.exportSampleRate);
        if (!Number.isInteger(totalFrameCount) || totalFrameCount < 1) {
            throw new Error('Rendered MP3 frame count is invalid.');
        }

        const OfflineAudioContextCtor = this.getOfflineAudioContextConstructor();
        const offlineContext = new OfflineAudioContextCtor(2, totalFrameCount, this.exportSampleRate);
        let cursorSeconds = 0;

        decodedBuffers.forEach((decodedBuffer, index) => {
            const source = offlineContext.createBufferSource();
            source.buffer = decodedBuffer;
            source.connect(offlineContext.destination);
            source.start(cursorSeconds);
            cursorSeconds += decodedBuffer.duration;
            if (index < gapDurationsSeconds.length) {
                cursorSeconds += gapDurationsSeconds[index];
            }
        });

        const renderedBuffer = await offlineContext.startRendering();
        if (!(renderedBuffer instanceof AudioBuffer) || renderedBuffer.length === 0) {
            throw new Error('Rendered stitched audio buffer is invalid.');
        }
        return renderedBuffer;
    }

    convertFloat32ToInt16(float32Array) {
        if (!(float32Array instanceof Float32Array)) {
            throw new Error('Float32Array is required for PCM conversion.');
        }

        const int16Array = new Int16Array(float32Array.length);
        for (let index = 0; index < float32Array.length; index += 1) {
            const sample = Math.max(-1, Math.min(1, float32Array[index]));
            int16Array[index] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
        return int16Array;
    }

    encodeRenderedBufferToMp3(renderedBuffer) {
        if (!(renderedBuffer instanceof AudioBuffer)) {
            throw new Error('AudioBuffer is required for MP3 encoding.');
        }

        const lamejs = this.getLameJsOrThrow();
        const leftChannel = renderedBuffer.getChannelData(0);
        const rightChannel = renderedBuffer.numberOfChannels > 1
            ? renderedBuffer.getChannelData(1)
            : renderedBuffer.getChannelData(0);

        const encoder = new lamejs.Mp3Encoder(2, renderedBuffer.sampleRate, this.exportBitrateKbps);
        const blockSize = 1152;
        const encodedParts = [];

        for (let offset = 0; offset < leftChannel.length; offset += blockSize) {
            const leftBlock = this.convertFloat32ToInt16(leftChannel.subarray(offset, offset + blockSize));
            const rightBlock = this.convertFloat32ToInt16(rightChannel.subarray(offset, offset + blockSize));
            const encodedBlock = encoder.encodeBuffer(leftBlock, rightBlock);
            if (encodedBlock.length > 0) {
                encodedParts.push(new Uint8Array(encodedBlock));
            }
        }

        const finalBlock = encoder.flush();
        if (finalBlock.length > 0) {
            encodedParts.push(new Uint8Array(finalBlock));
        }

        const outputBlob = new Blob(encodedParts, { type: 'audio/mpeg' });
        if (outputBlob.size <= 0) {
            throw new Error('MP3 encoder produced an empty output blob.');
        }
        return outputBlob;
    }

    async buildLocalMp3Blob() {
        const decodedBuffers = await this.decodeChunkBuffers();
        const gapDurationsSeconds = this.player.localAudio.getOrCreateGapPlan();
        const renderedBuffer = await this.renderStitchedAudioBuffer(decodedBuffers, gapDurationsSeconds);
        return this.encodeRenderedBufferToMp3(renderedBuffer);
    }

    async exportMP3() {
        if (!this.player.computeHasCompleteLocalSession()) {
            return;
        }

        this.setExportButtonsBusy(true);

        try {
            const outputBlob = await this.buildLocalMp3Blob();
            const objectUrl = URL.createObjectURL(outputBlob);
            const fileName = `${this.buildDownloadFileBaseName()}.mp3`;
            this.triggerBrowserDownload(objectUrl, fileName);
            setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        } catch (error) {
            throw new Error(`Export failed: ${error.message || error}`);
        } finally {
            this.setExportButtonsBusy(false);
        }
    }
}
