/**
 * SRT Parser & Scene Mapper Module
 * Parse SRT files and map content to scenes based on actual audio timestamps
 */

const fs = require('fs');

/**
 * Parse SRT file content into structured array
 * @param {string} srtContent - Raw SRT file content
 * @returns {Array} Array of {index, startTime, endTime, startMs, endMs, text}
 */
function parseSRT(srtContent) {
    if (!srtContent) return [];

    const entries = [];
    const blocks = srtContent.trim().split(/\n\s*\n/);

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 3) continue;

        const index = parseInt(lines[0], 10);
        const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);

        if (!timeMatch) continue;

        const startTime = timeMatch[1];
        const endTime = timeMatch[2];
        const text = lines.slice(2).join(' ').trim();

        entries.push({
            index,
            startTime,
            endTime,
            startMs: timeToMs(startTime),
            endMs: timeToMs(endTime),
            text
        });
    }

    return entries;
}

/**
 * Convert SRT timestamp to milliseconds
 * @param {string} time - Format: "00:00:05,230"
 * @returns {number} Milliseconds
 */
function timeToMs(time) {
    const [hms, ms] = time.split(',');
    const [h, m, s] = hms.split(':').map(Number);
    return (h * 3600 + m * 60 + s) * 1000 + parseInt(ms, 10);
}

/**
 * Convert milliseconds to seconds
 */
function msToSeconds(ms) {
    return ms / 1000;
}

/**
 * Group SRT entries into scenes based on target scene duration
 * @param {Array} srtEntries - Parsed SRT entries
 * @param {number} sceneDuration - Target duration per scene (seconds)
 * @returns {Array} Array of scenes with grouped entries
 */
/**
 * Group SRT entries into scenes based on target scene duration and semantic boundaries.
 * @param {Array} srtEntries - Parsed SRT entries
 * @param {number} sceneDuration - Target duration per scene (seconds)
 * @param {number} minDuration - Minimum duration per scene (seconds)
 * @returns {Array} Array of scenes with grouped entries
 */
function groupIntoScenes(srtEntries, sceneDuration = 8, minDuration = 3) {
    if (!srtEntries || srtEntries.length === 0) return [];

    const scenes = [];
    let currentScene = {
        id: 1,
        entries: [],
        startMs: srtEntries[0].startMs,
        endMs: 0,
        text: ''
    };

    const targetDurationMs = sceneDuration * 1000;
    const minDurationMs = minDuration * 1000;

    for (let i = 0; i < srtEntries.length; i++) {
        const entry = srtEntries[i];
        currentScene.entries.push(entry);

        const currentDurationMs = entry.endMs - currentScene.startMs;
        const entryText = entry.text.trim();
        const isSentenceEnd = /[.!?]$/.test(entryText);
        const isLastEntry = (i === srtEntries.length - 1);

        // Logic: 
        // 1. Nếu chưa đủ minDuration -> Phải cộng dồn tiếp.
        // 2. Nếu đã đủ minDuration VÀ là kết thúc câu -> Cắt scene.
        // 3. Nếu đã vượt quá targetDuration -> Cắt scene dù chưa hết câu.

        let shouldCut = false;
        if (isLastEntry) {
            shouldCut = true;
        } else if (currentDurationMs >= minDurationMs) {
            if (isSentenceEnd) {
                shouldCut = true;
            } else if (currentDurationMs >= targetDurationMs) {
                shouldCut = true;
            }
        }

        if (shouldCut) {
            // Finalize current scene
            currentScene.endMs = currentScene.entries[currentScene.entries.length - 1].endMs;
            currentScene.text = currentScene.entries.map(e => e.text).join(' ');
            currentScene.duration = msToSeconds(currentScene.endMs - currentScene.startMs);
            scenes.push(currentScene);

            // Start new scene if not last
            if (!isLastEntry) {
                const nextEntry = srtEntries[i + 1];
                currentScene = {
                    id: scenes.length + 1,
                    entries: [],
                    startMs: nextEntry.startMs,
                    endMs: 0,
                    text: ''
                };
            }
        }
    }

    return scenes;
}

/**
 * Calculate visual specs from SRT-based scenes
 * @param {Array} scenes - Grouped scenes from SRT
 * @param {number} totalDuration - Total audio duration (seconds)
 * @returns {Object} Visual specs with scenes
 */
function calculateVisualSpecsFromSRT(scenes, totalDuration, mappingMode = 'N+1') {
    const totalVideos = scenes.length;
    let totalImages = totalVideos;
    let nPlusOne = false;

    if (mappingMode === 'N+1') {
        totalImages = totalVideos + 1;
        nPlusOne = true;
    }

    console.log(`📊 [SRT Visual Logic] Total Duration: ${totalDuration.toFixed(1)}s`);
    console.log(`   → ${totalVideos} scenes from SRT → ${totalImages} images (${mappingMode})`);

    return {
        total_videos: totalVideos,
        total_images: totalImages,
        n_plus_one: nPlusOne,
        mapping_mode: mappingMode,
        srt_based: true,
        scenes: scenes.map(s => ({
            id: s.id,
            start_time: msToSeconds(s.startMs),
            end_time: msToSeconds(s.endMs),
            duration: s.duration,
            text_segment: s.text,
            entry_count: s.entries.length
        }))
    };
}

/**
 * Load and parse SRT file, then generate visual specs
 * @param {string} srtPath - Path to SRT file
 * @param {number} audioDuration - Total audio duration
 * @param {number} targetSceneDuration - Target duration per scene (default 8s)
 * @returns {Object} Visual specs with SRT-based scenes
 */
function processAudioWithSRT(srtPath, audioDuration, targetSceneDuration = 8, mappingMode = 'N+1') {
    try {
        if (!fs.existsSync(srtPath)) {
            console.log(`⚠️ [SRT] File not found: ${srtPath}`);
            return null;
        }

        const srtContent = fs.readFileSync(srtPath, 'utf8');
        const entries = parseSRT(srtContent);

        if (entries.length === 0) {
            console.log(`⚠️ [SRT] No entries parsed from file`);
            return null;
        }

        console.log(`📝 [SRT] Parsed ${entries.length} subtitle entries`);

        const scenes = groupIntoScenes(entries, targetSceneDuration);
        console.log(`🎬 [SRT] Grouped into ${scenes.length} scenes`);

        return calculateVisualSpecsFromSRT(scenes, audioDuration, mappingMode);

    } catch (e) {
        console.error(`❌ [SRT] Error processing:`, e.message);
        return null;
    }
}

/**
 * Generate visual specs directly from SRT content string
 */
function processContentWithSRT(srtContent, audioDuration, targetSceneDuration = 8, mappingMode = 'N+1') {
    try {
        if (!srtContent) return null;
        const entries = parseSRT(srtContent);
        if (entries.length === 0) return null;

        const scenes = groupIntoScenes(entries, targetSceneDuration);
        return calculateVisualSpecsFromSRT(scenes, audioDuration, mappingMode);
    } catch (e) {
        console.error(`❌ [SRT Content] Error:`, e.message);
        return null;
    }
}

/**
 * Get scene text for a specific scene ID
 * Useful for generating targeted prompts
 */
function getSceneText(visualSpecs, sceneId) {
    if (!visualSpecs || !visualSpecs.scenes) return '';
    const scene = visualSpecs.scenes.find(s => s.id === sceneId);
    return scene ? scene.text_segment : '';
}

/**
 * Generate detailed scene info for prompt generation
 */
function generateSceneContext(visualSpecs) {
    if (!visualSpecs || !visualSpecs.scenes) return [];

    return visualSpecs.scenes.map((scene, index) => ({
        scene_id: scene.id,
        position: index === 0 ? 'opening' : index === visualSpecs.scenes.length - 1 ? 'closing' : 'middle',
        start_time: `${scene.start_time.toFixed(1)}s`,
        end_time: `${scene.end_time.toFixed(1)}s`,
        duration: `${scene.duration.toFixed(1)}s`,
        content_preview: scene.text_segment.substring(0, 100) + (scene.text_segment.length > 100 ? '...' : ''),
        word_count: scene.text_segment.split(/\s+/).length
    }));
}

module.exports = {
    parseSRT,
    timeToMs,
    msToSeconds,
    groupIntoScenes,
    calculateVisualSpecsFromSRT,
    processAudioWithSRT,
    processContentWithSRT,
    getSceneText,
    generateSceneContext
};
