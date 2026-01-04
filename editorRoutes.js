const express = require('express');
const router = express.Router();
const srtParser = require('./srt_parser');
const metadataManager = require('./metadataManager');
const path = require('path');
const fs = require('fs-extra');
const { log } = require('./colors');
const db = require('./database');
const ffmpeg = require('fluent-ffmpeg');

/**
 * API: List Channels
 */
router.get('/channels', async (req, res) => {
    try {
        const channels = await db.db.all('SELECT * FROM channels ORDER BY name');
        res.json({ success: true, data: channels });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

/**
 * API: List Projects for Channel
 */
router.get('/projects', async (req, res) => {
    try {
        const { channelId } = req.query;
        const projects = await db.db.all('SELECT * FROM projects WHERE channel_id = ? ORDER BY created_at DESC', [channelId]);
        res.json({ success: true, data: projects });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

/**
 * API: Get Project Data (Mapping/Analysis)
 */
router.get('/projects/:id', async (req, res) => {
    try {
        const project = await db.db.get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
        if (!project) return res.json({ success: false, error: "Project not found" });

        // Get modules for skeleton, join with scripts if available
        const modules = await db.db.all(`
            SELECT m.*, s.content_text, s.cliff_text 
            FROM modules m 
            LEFT JOIN module_scripts s ON m.id = s.module_id 
            WHERE m.project_id = ? 
            ORDER BY m.module_index
        `, [req.params.id]);

        res.json({ success: true, data: { project, modules } });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

/**
 * API: Browse Folders in C:\Kênh
 */
router.get('/browse-folders', async (req, res) => {
    try {
        const baseDir = 'C:\\Kênh';
        if (!fs.existsSync(baseDir)) {
            await fs.ensureDir(baseDir);
        }

        const files = await fs.readdir(baseDir, { withFileTypes: true });
        const folders = files
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        res.json({ success: true, folders });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

/**
 * API: Parse Smart Skeleton from SRT
 */
router.post('/parse-skeleton', (req, res) => {
    try {
        const { srt } = req.body;
        if (!srt) return res.json({ success: false, error: "SRT content is required" });

        const entries = srtParser.parseSRT(srt);
        // Smart Grouping: Default 8s target, 3s min duration
        const skeleton = srtParser.calculateVisualSpecsFromSRT(
            srtParser.groupIntoScenes(entries, 8, 3),
            300 // dummy total duration
        );

        res.json({ success: true, skeleton: skeleton.scenes });
    } catch (err) {
        log.error(`[Editor API] Parse failed: ${err.message}`);
        res.json({ success: false, error: err.message });
    }
});

/**
 * Helper: Get Scale and Pad filter for standardized resolution
 */
function getScalePadFilter(aspectRatio = '16:9') {
    const width = aspectRatio === '9:16' ? 1080 : 1920;
    const height = aspectRatio === '9:16' ? 1920 : 1080;
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}

/**
 * Create video from images + SRT + audio using FFmpeg
 * @param {Array} mapping - Scene mapping with image paths and durations
 * @param {string} srtPath - Path to SRT subtitle file (optional)
 * @param {string} audioPath - Path to audio file
 * @param {string} outputPath - Output video path
 * @param {Object} options - Additional options like aspectRatio
 * @returns {Promise<string>} Output path
 */
async function createVideoFromScenes(mapping, srtPath, audioPath, outputPath, options = {}) {
    return new Promise((resolve, reject) => {
        if (!mapping || mapping.length === 0) {
            return reject(new Error("Mapping is required and cannot be empty"));
        }

        if (!audioPath || !fs.existsSync(audioPath)) {
            return reject(new Error(`Audio file not found: ${audioPath}`));
        }

        const aspectRatio = options.aspectRatio || '16:9';

        // Create concat file for images
        const concatFile = path.join(__dirname, `../../temp/concat_${Date.now()}.txt`);
        fs.ensureDirSync(path.dirname(concatFile));

        let concatContent = '';

        mapping.forEach((scene, index) => {
            if (!scene.image_path || !fs.existsSync(scene.image_path)) {
                log.warn(`⚠️ [Render] Image not found for scene ${index + 1}: ${scene.image_path}, using placeholder`);
                return;
            }
            concatContent += `file '${scene.image_path.replace(/\\/g, '/')}'\n`;
            concatContent += `duration ${scene.duration || 8}\n`;
        });

        // Add last image again (FFmpeg concat requirement)
        if (mapping.length > 0 && mapping[mapping.length - 1].image_path) {
            concatContent += `file '${mapping[mapping.length - 1].image_path.replace(/\\/g, '/')}'\n`;
        }

        fs.writeFileSync(concatFile, concatContent);
        log.info(`📝 [Render] Created concat file with ${mapping.length} scenes`);

        // Build FFmpeg command
        let command = ffmpeg()
            .input(concatFile)
            .inputOptions(['-f concat', '-safe 0', '-r 30'])
            .input(audioPath)
            .outputOptions([
                '-c:v libx264',
                '-pix_fmt yuv420p',
                '-preset medium',
                '-crf 23',
                '-c:a aac',
                '-b:a 192k',
                '-shortest'
            ]);

        // Build video filters
        const videoFilters = [getScalePadFilter(aspectRatio)];

        // Add subtitles if SRT provided
        if (srtPath && fs.existsSync(srtPath)) {
            const srtPathEscaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
            // Improved styling: Font Arial, size 24, Primary yellow, black thin outline
            const style = "FontName=Arial,FontSize=24,PrimaryColour=&H00FFFF,OutlineColour=&H000000,Outline=1,BackColour=&H80000000,BorderStyle=3,Alignment=2";
            videoFilters.push(`subtitles='${srtPathEscaped}':force_style='${style}'`);
            log.info(`📝 [Render] Adding subtitles from: ${srtPath}`);
        }

        command = command.videoFilters(videoFilters);

        command
            .on('start', (cmdLine) => {
                log.info(`🎬 [Render] FFmpeg started: ${cmdLine.substring(0, 200)}...`);
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    log.info(`📊 [Render] Progress: ${Math.round(progress.percent)}%`);
                }
            })
            .on('end', () => {
                log.success(`✅ [Render] Video created successfully: ${outputPath}`);
                // Clean up concat file
                try {
                    fs.unlinkSync(concatFile);
                } catch (e) {
                    log.warn(`⚠️ [Render] Failed to clean up concat file: ${e.message}`);
                }
                resolve(outputPath);
            })
            .on('error', (err) => {
                log.error(`❌ [Render] FFmpeg error: ${err.message}`);
                // Clean up concat file
                try {
                    fs.unlinkSync(concatFile);
                } catch (e) {
                    // Ignore cleanup errors
                }
                reject(new Error(`Video rendering failed: ${err.message}`));
            })
            .save(outputPath);
    });
}

/**
 * API: Render & Apply SEO Metadata
 */
router.post('/render', async (req, res) => {
    try {
        const { skeleton, image_path, seo, mapping, srt_path, audio_path, options } = req.body;

        // Validate inputs
        if (!mapping || mapping.length === 0) {
            return res.json({
                success: false,
                error: "Mapping is required. Please provide scene mapping with image paths and durations."
            });
        }

        if (!audio_path) {
            return res.json({
                success: false,
                error: "Audio path is required for video rendering."
            });
        }

        if (!fs.existsSync(audio_path)) {
            return res.json({
                success: false,
                error: `Audio file not found at: ${audio_path}`
            });
        }

        log.info(`🚀 [Editor API] Starting render for video with ${mapping.length} scenes.`);

        const timestamp = Date.now();
        const outputDir = path.join(__dirname, '../../output_files');
        await fs.ensureDir(outputDir);

        const tempOutput = path.join(outputDir, `temp_${timestamp}.mp4`);
        const finalOutput = path.join(outputDir, `video_${timestamp}.mp4`);

        // STEP 1: Create video from scenes
        try {
            log.info(`🎬 [Render] Creating video from ${mapping.length} scenes...`);
            await createVideoFromScenes(mapping, srt_path, audio_path, tempOutput, options);
            log.success(`✅ [Render] Video created: ${tempOutput}`);
        } catch (renderErr) {
            log.error(`❌ [Render] Video creation failed: ${renderErr.message}`);
            return res.json({
                success: false,
                error: `Video rendering failed: ${renderErr.message}`,
                details: "Please check that all image paths are valid and FFmpeg is installed."
            });
        }

        // STEP 2: Apply SEO metadata (optional)
        try {
            if (seo && (seo.template || seo.artist || seo.tags || seo.title)) {
                log.info(`🏷️ [Render] Applying SEO metadata...`);
                await metadataManager.applyMetadata(tempOutput, finalOutput, {
                    template: seo.template,
                    artist: seo.artist,
                    tags: seo.tags,
                    title: seo.title || "Smart Editor Produced Video",
                    album: seo.album,
                    comment: seo.comment
                });

                // Clean up temp file
                await fs.unlink(tempOutput);
                log.success(`✅ [Render] Metadata applied: ${finalOutput}`);
            } else {
                // No metadata, just rename temp to final
                await fs.rename(tempOutput, finalOutput);
                log.info(`ℹ️ [Render] No SEO metadata to apply, using video as-is.`);
            }
        } catch (metaErr) {
            log.warn(`⚠️ [Render] Metadata application failed: ${metaErr.message}`);
            // Still return success with temp video
            if (fs.existsSync(tempOutput)) await fs.rename(tempOutput, finalOutput);
        }

        // STEP 3: Get file stats and return success
        const fileStats = await fs.stat(finalOutput);
        const totalDuration = mapping.reduce((sum, m) => sum + (m.duration || 8), 0);

        res.json({
            success: true,
            message: "Video rendered successfully! ✅",
            output: finalOutput,
            file_size: `${(fileStats.size / 1024 / 1024).toFixed(2)} MB`,
            duration: `~${Math.round(totalDuration)}s`,
            scenes: mapping.length,
            timestamp: timestamp
        });

    } catch (err) {
        log.error(`[Editor API] Render failed: ${err.message}`);
        res.json({
            success: false,
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

/**
 * Helper: Concatenate multiple MP4 videos into one using FFmpeg concat demuxer
 * Fast and no re-encoding (requires identical video parameters)
 */
async function concatenateVideos(videoPaths, outputPath) {
    return new Promise((resolve, reject) => {
        if (!videoPaths || videoPaths.length === 0) return reject(new Error("No videos to concatenate"));

        // Filter out non-existent files
        const validPaths = videoPaths.filter(p => fs.existsSync(p));
        if (validPaths.length === 0) return reject(new Error("None of the specified video files exist"));

        log.info(`🔗 [Concat] Merging ${validPaths.length} videos into ${outputPath}`);

        const listFile = path.join(__dirname, `../../temp/concat_list_${Date.now()}.txt`);
        fs.ensureDirSync(path.dirname(listFile));

        const listContent = validPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listFile, listContent);

        ffmpeg()
            .input(listFile)
            .inputOptions(['-f concat', '-safe 0'])
            .outputOptions('-c copy') // Fast copy, no re-encoding
            .on('start', (cmd) => log.info(`🎬 [Concat] FFmpeg: ${cmd.substring(0, 100)}...`))
            .on('end', () => {
                log.success(`✅ [Concat] Merge complete: ${outputPath}`);
                try { fs.unlinkSync(listFile); } catch (e) { }
                resolve(outputPath);
            })
            .on('error', (err) => {
                log.error(`❌ [Concat] Error: ${err.message}`);
                try { fs.unlinkSync(listFile); } catch (e) { }
                reject(err);
            })
            .save(outputPath);
    });
}

/**
 * API: Batch Render (3 Micro Clips + 1 Master Video)
 */
router.post('/batch-render', async (req, res) => {
    try {
        const { projectRoot, batches, seo, options } = req.body;
        // projectRoot: e.g. "C:\\Automation Ex\\11testAuto\\data\\projects\\MyProject_2026-01-03"
        // batches: Array of { folder, srt, audio, name }

        if (!batches || batches.length === 0) {
            return res.json({ success: false, error: "No batches provided for rendering." });
        }

        log.info(`🚀 [Batch Render] Starting processing for ${batches.length} batches.`);
        const results = [];
        const renderedVideoPaths = [];

        for (const batch of batches) {
            log.info(`📦 [Batch] Processing: ${batch.name || batch.folder}`);

            // Auto-detect image mapping from folder if path is directory
            let mapping = batch.mapping;
            if (!mapping && batch.folder && fs.existsSync(batch.folder)) {
                const imgFiles = (await fs.readdir(batch.folder))
                    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
                    .sort((a, b) => {
                        // Numeric sort for files like 1.jpg, 2.jpg
                        const numA = parseInt(a.replace(/\D/g, '')) || 0;
                        const numB = parseInt(b.replace(/\D/g, '')) || 0;
                        return numA - numB;
                    });

                mapping = imgFiles.map(img => ({
                    image_path: path.join(batch.folder, img),
                    duration: 8 // default duration
                }));
            }

            if (!mapping || mapping.length === 0) {
                log.warn(`⚠️ [Batch] Skipping ${batch.folder}: No images found.`);
                continue;
            }

            const timestamp = Date.now();
            const outputDir = path.join(__dirname, '../../output_files');
            await fs.ensureDir(outputDir);
            const microOutput = path.join(outputDir, `micro_${batch.name || timestamp}.mp4`);

            try {
                await createVideoFromScenes(mapping, batch.srt, batch.audio, microOutput, options);
                results.push({ name: batch.name, status: 'success', path: microOutput });
                renderedVideoPaths.push(microOutput);
            } catch (err) {
                log.error(`❌ [Batch] Failed: ${batch.name} - ${err.message}`);
                results.push({ name: batch.name, status: 'error', error: err.message });
            }
        }

        // STEP 4: Concatenate all successful micro clips into a Master video
        let masterPath = null;
        if (renderedVideoPaths.length > 1) {
            log.info(`👑 [Batch] Creating Master Video From ${renderedVideoPaths.length} clips...`);
            const timestamp = Date.now();
            masterPath = path.join(__dirname, `../../output_files/master_video_${timestamp}.mp4`);
            try {
                await concatenateVideos(renderedVideoPaths, masterPath);
            } catch (mergeErr) {
                log.error(`❌ [Batch] Master merge failed: ${mergeErr.message}`);
            }
        }

        res.json({
            success: true,
            batches: results,
            master_video: masterPath,
            message: "Batch rendering process completed! 🎬"
        });

    } catch (err) {
        log.error(`[Batch API] Error: ${err.message}`);
        res.json({ success: false, error: err.message });
    }
});

module.exports = router;
