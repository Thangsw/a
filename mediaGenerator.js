const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Veo3Api } = require('./veo3Api');
const { ConcurrencyManager } = require('./concurrencyManager');

const TOKENS_PATH = path.join(__dirname, '../../data/veo3_tokens.json');

// Simple logger replacement
const log = {
    info: (msg) => console.log(`ℹ️ ${msg}`),
    warn: (msg) => console.warn(`⚠️ ${msg}`),
    error: (msg) => console.error(`❌ ${msg}`),
    success: (msg) => console.log(`✅ ${msg}`)
};

// Helper to sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Update Lane Tokens (persist projectId/sceneId)
 */
function updateLaneInFile(laneName, projectId, sceneId) {
    try {
        if (!fs.existsSync(TOKENS_PATH)) return;
        const lanes = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
        const idx = lanes.findIndex(l => l.name === laneName);
        if (idx !== -1) {
            let changed = false;
            if (projectId && lanes[idx].projectId !== projectId) {
                lanes[idx].projectId = projectId;
                changed = true;
            }
            if (sceneId && lanes[idx].sceneId !== sceneId) {
                lanes[idx].sceneId = sceneId;
                changed = true;
            }
            if (changed) {
                fs.writeFileSync(TOKENS_PATH, JSON.stringify(lanes, null, 2));
                log.info(`💾 [System] Updated Lane ${laneName} with ProjectID/SceneID.`);
            }
        }
    } catch (e) {
        log.error(`Failed to update tokens file: ${e.message}`);
    }
}

/**
 * Check if image exists and is valid for resume
 */
async function checkImageResume(destPath, api) {
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
        log.info(`[Resume] Found image at ${path.basename(destPath)}`);
        try {
            // Read file and convert to base64
            const imageBuffer = fs.readFileSync(destPath);
            const base64Data = imageBuffer.toString('base64');

            // Upload to get fresh ID
            const upRes = await api.uploadImage(base64Data);
            if (upRes && upRes.mediaId) {
                return { mediaId: upRes.mediaId };
            }
        } catch (e) {
            log.warn(`Resume upload failed: ${e.message}`);
        }
    }
    return null;
}

/**
 * Process a Chapter with Continuous Image Gen + Concurrent Video Gen
 */
async function processChapterSequential(chapterData, laneConfig, outputRoot, onLog = null) {
    const chapterId = String(chapterData.chapter_id || 'Unknown_Chapter');
    const picDir = path.join(outputRoot, 'Pic', chapterId);
    const vidDir = path.join(outputRoot, 'Vid', chapterId);
    const vidOptDir = path.join(vidDir, 'Tuy chon');

    [picDir, vidDir, vidOptDir].forEach(d => {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });

    // Create lane-specific video concurrency manager (max 2 videos per lane)
    const laneConcurrency = new ConcurrencyManager(2);

    const api = new Veo3Api(laneConfig);
    const visualPrompts = chapterData.visual_prompts || [];
    const mediaMap = new Array(visualPrompts.length).fill(null);
    const videoPromises = []; // Store video tasks

    // Helper for SSE
    const sendLog = (msg, type = 'info') => {
        const logType = type === 'error' ? 'error' : (type === 'success' ? 'success' : 'info');
        const formattedMsg = `[${laneConfig.name}][Ch ${chapterId}] ${msg}`;
        log[logType](formattedMsg);
        if (onLog) onLog('process_log', formattedMsg);
    };

    // Counters for queue status
    let generatedImages = 0;
    let generatedVideos = 0;
    let failedImages = 0;
    let failedVideos = 0;

    // Emit initial queue state
    if (onLog) {
        onLog('queue_update', {
            chapter: chapterId,
            images: { total: visualPrompts.length, generated: 0 },
            videos: { total: visualPrompts.length - 1, generated: 0 },
            failedImages: 0,
            failedVideos: 0
        });
    }

    // =========================================================================
    // IMAGE GENERATION LOOP (Sequential 1, 2, 3...)
    // =========================================================================
    for (let i = 0; i < visualPrompts.length; i++) {
        const item = visualPrompts[i];
        const sceneNum = i + 1;
        const prompt = item.image_prompt || item.prompt;
        const destPath = path.join(picDir, `${sceneNum}.jpg`);


        sendLog(`Đang tạo ảnh ${sceneNum}/${visualPrompts.length}`);

        // 1. Check Resume
        const existingImage = await checkImageResume(destPath, api);
        let validMediaId = existingImage ? existingImage.mediaId : null;

        // 2. Generate if needed
        if (!validMediaId) {
            try {
                // Determine Mode: Start (New) or Continue (Img-to-Img)
                const isContinue = i > 0 && mediaMap[i - 1]?.mediaId;
                const options = {
                    aspectRatio: 'IMAGE_ASPECT_RATIO_LANDSCAPE',
                    numImages: 1 // Strict 1 image as requested
                };

                // Add Context if Continue mode (optional, based on logic)
                // if (isContinue) options.imageInputs = [{ mediaId: mediaMap[i-1].mediaId }];

                const res = await api.generateImages(prompt, options);

                if (res.success && res.mediaIds.length > 0) {
                    validMediaId = res.mediaIds[0];

                    // Capture ProjectID/SceneID
                    if (res.projectId) {
                        api.projectId = res.projectId;
                        api.sceneId = res.sceneId;
                        updateLaneInFile(laneConfig.name, res.projectId, res.sceneId);
                    }

                    // Save Image
                    if (res.images[0]?.path) {
                        const pathVal = res.images[0].path;
                        if (pathVal && pathVal.startsWith('http')) {
                            const dlRes = await api.downloadMedia(pathVal, destPath);
                            if (!dlRes.success) {
                                sendLog(`⚠️ Ảnh ${sceneNum} download lỗi: ${dlRes.error}`, 'warn');
                            }
                        } else if (pathVal) {
                            // Assume Local Path relative to public
                            const localSrc = path.join(__dirname, '../../public', pathVal.replace(/^\//, ''));
                            if (fs.existsSync(localSrc)) {
                                fs.copyFileSync(localSrc, destPath);
                            }
                        }
                    }
                    sendLog(`Tạo thành công ảnh ${sceneNum}`);

                    // Update queue status
                    generatedImages++;
                    if (onLog) {
                        onLog('queue_update', {
                            chapter: chapterId,
                            images: { generated: generatedImages }
                        });
                    }
                } else {
                    throw new Error(res.error || 'Unknown Gen Error');
                }
            } catch (e) {
                sendLog(`❌ Ảnh ${sceneNum} thất bại: ${e.message}`, 'error');

                // Track failed image
                failedImages++;
                if (onLog) {
                    onLog('queue_update', {
                        chapter: chapterId,
                        failedImages: failedImages
                    });

                    onLog('failed_image', {
                        chapter: chapterId,
                        index: sceneNum,
                        reason: e.message,
                        prompt: prompt.substring(0, 100)
                    });
                }

                continue; // Skip to next image, breaking chain for video
            }
        }

        // 3. Mark & Maps
        if (validMediaId) {
            mediaMap[i] = { mediaId: validMediaId, path: destPath };

            // 4. TRIGGER VIDEO (Concurrent)
            // Condition: We have Current Image (End) AND Previous Image (Start)
            if (i > 0 && mediaMap[i - 1] && !laneConfig.skipVideoPrompt) {
                const prevImg = mediaMap[i - 1];
                const currImg = mediaMap[i];
                const pairIndex = i; // Video 1a is pair (Img1 -> Img2)

                // Trigger Background Video Task
                const videoTask = generateVideoPairConcurrent(
                    api,
                    prevImg,
                    currImg,
                    pairIndex, // 1, 2, 3...
                    visualPrompts[pairIndex].video_prompt, // Prompt for THIS transition
                    vidDir,
                    vidOptDir,
                    sendLog,
                    chapterId,
                    laneConcurrency  // Pass lane-specific concurrency manager
                );
                videoPromises.push(videoTask);
            }
        }
    }

    // Wait for all Videos
    if (videoPromises.length > 0) {
        sendLog(`⏳ Waiting for ${videoPromises.length} video tasks...`);
        await Promise.all(videoPromises);
    }

    sendLog(`🎉 Chapter ${chapterId} Completed!`, 'success');
    return { success: true };
}

/**
 * Handle Single Video Pair Generation (Concurrent)
 */
async function generateVideoPairConcurrent(api, startImg, endImg, pairNum, prompt, vidDir, vidOptDir, sendLog, chapterId, laneConcurrency) {
    const taskName = `Video ${pairNum}`;
    const fileA = path.join(vidDir, `${pairNum}a.mp4`);
    const fileB = path.join(vidOptDir, `${pairNum}b.mp4`);

    // Check Exist
    if (fs.existsSync(fileA)) {
        sendLog(`⏭️ ${taskName} đã tồn tại. Bỏ qua.`);
        return;
    }

    await laneConcurrency.run(async () => {
        sendLog(`Đang tạo video ${pairNum}`);

        let attempts = 0;
        let success = false;
        // Backoff: 5s (default wait), then 15s -> 30s -> 60s
        const backoffs = [15000, 30000, 60000];

        while (!success && attempts <= 3) {
            try {
                // Call High-Level Generate
                // Note: api.generateVideo now returns ABSOLUTE path
                const res = await api.generateVideo(
                    startImg.mediaId,
                    endImg.mediaId,
                    prompt || "Smooth transition"
                );

                if (res.success && res.path) {
                    // res.path is now ABSOLUTE path (e.g., C:\...\public\generated\video.mp4)
                    const srcPath = res.path;

                    if (fs.existsSync(srcPath)) {
                        fs.copyFileSync(srcPath, fileA);
                        sendLog(`Tạo thành công video ${pairNum}`);
                        success = true;
                    } else {
                        throw new Error(`Generated file not found at ${srcPath}`);
                    }

                    // Note: '1b' variant is ignored here because high-level generateVideo only returns one result.
                    // This prevents the 'substring' crash and ensures stability.

                } else {
                    throw new Error(res.error || 'Unknown Video Gen Error');
                }

            } catch (e) {
                attempts++;
                const isRateLimit = e.message.includes('429') || e.message.includes('ResourceExhausted');

                if (isRateLimit && attempts <= 3) {
                    const waitTime = backoffs[attempts - 1];
                    sendLog(`⚠️ Video ${pairNum} giới hạn tốc độ. Chờ ${waitTime / 1000}s...`, 'warn');
                    await sleep(waitTime);
                } else {
                    sendLog(`❌ Video ${pairNum} thất bại: ${e.message}`, 'error');
                    break; // Non-recoverable or max retries
                }
            }
        }

        if (success) {
            // Cool-down after success
            await sleep(5000);
        }
    });
}

module.exports = { processChapterSequential };
