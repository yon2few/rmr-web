class AudioStorage {
    constructor(player) {
        if (!player || typeof player !== 'object') {
            throw new Error('[Storage] player is required.');
        }
        this.player = player;
    }

    ensureJsZip() {
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip is required for session save and load.');
        }
    }

    async save() {
        if (!this.player.computeHasCompleteLocalSession()) {
            throw new Error('Save is unavailable until all generated chunks are received locally.');
        }

        this.ensureJsZip();

        const zip = new JSZip();
        const manifest = this.player.localAudio.buildArchiveManifest();
        zip.file('data.json', JSON.stringify(manifest, null, 2));

        const audioFolder = zip.folder('audio');
        if (!audioFolder) {
            throw new Error('Failed to create audio folder in session archive.');
        }

        for (let chunkIndex = 0; chunkIndex < manifest.audioChunks.length; chunkIndex += 1) {
            const audioBlob = this.player.localAudio.getChunkAudioBlobOrThrow(chunkIndex);
            audioFolder.file(`chunk_${chunkIndex}.mp3`, audioBlob);
        }

        const archiveBlob = await zip.generateAsync({ type: 'blob' });
        if (!(archiveBlob instanceof Blob) || archiveBlob.size <= 0) {
            throw new Error('Session archive generation returned an empty blob.');
        }

        const fileBaseName = this.player.buildFileBaseName();
        const objectUrl = URL.createObjectURL(archiveBlob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `${fileBaseName}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }

    async load() {
        this.player.assertIntakeAllowed('load a local session archive');
        this.ensureJsZip();

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';

        input.onchange = async (event) => {
            try {
                const file = event.target?.files?.[0];
                if (!file) {
                    throw new Error('A session archive file is required to load saved audio.');
                }

                const zip = await JSZip.loadAsync(file);
                const dataEntry = zip.file('data.json');
                if (!dataEntry) {
                    throw new Error('Session archive is missing data.json.');
                }

                const dataStr = await dataEntry.async('string');
                const data = JSON.parse(dataStr);
                await this.player.localAudio.restoreFromArchive({ data, zip });

                this.player.sessionId = data.sessionId;
                this.player.setRequestTitle(typeof data.requestTitle === 'string' ? data.requestTitle : '');
                this.player.chunkPages = Array.isArray(data.chunkPages) ? data.chunkPages : [];

                const responseData = {
                    success: true,
                    source: 'archive',
                    sessionId: data.sessionId,
                    chunks: data.audioChunks
                };

                await this.player.input.cloudrun.handleCloudRunResponse(responseData);
                this.player.setAllChunksReady(true);
                this.player.syncOverlayActionState({
                    mode: 'fullchunk',
                    isPlaying: false,
                    hasAudio: true,
                    canSave: true,
                    canExport: true,
                    canShare: true
                });

                this.player.input.showStatus('Loaded local session ZIP.', 'success');

                if (this.player.checkForBookmark) {
                    this.player.checkForBookmark();
                }
            } catch (error) {
                this.player.captureSubsystemFailure('storage', error, {
                    sessionId: this.player.sessionId
                });
            }
        };

        input.click();
    }
}
