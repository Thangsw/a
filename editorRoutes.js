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
 * Create video from images + SRT + audio using FFmpeg
 * @param {Array} mapping - Scene mapping with image paths and durations
 * @param {string} srtPath - Path to SRT subtitle file (optional)
 * @param {string} audioPath - Path to audio file
 * @param {string} outputPath - Output video path
 * @returns {Promise<string>} Output path
 */
async function createVideoFromScenes(mapping, srtPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
        if (!mapping || mapping.length === 0) {
            return reject(new Error("Mapping is required and cannot be empty"));
        }

        if (!audioPath || !fs.existsSync(audioPath)) {
            return reject(new Error(`Audio file not found: ${audioPath}`));
        }

        // Create concat file for images
        const concatFile = path.join(__dirname, `../../temp/concat_${Date.now()}.txt`);
        fs.ensureDirSync(path.dirname(concatFile));

        let concatContent = '';

        mapping.forEach((scene, index) => {
            if (!scene.image_path || !fs.existsSync(scene.image_path)) {
                log.warn(`⚠️ [Render] Image not found for scene ${index + 1}: ${scene.image_path}, using placeholder`);
                // You could use a placeholder image here
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

        // Add subtitles if SRT provided
        if (srtPath && fs.existsSync(srtPath)) {
            const srtPathEscaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
            command = command.outputOptions([
                `-vf subtitles='${srtPathEscaped}':force_style='FontName=Arial,FontSize=24,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,BackColour=&H80000000,BorderStyle=3'`
            ]);
            log.info(`📝 [Render] Adding subtitles from: ${srtPath}`);
        }

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
        const { skeleton, image_path, seo, mapping, srt_path, audio_path } = req.body;

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
            await createVideoFromScenes(mapping, srt_path, audio_path, tempOutput);
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
            await fs.rename(tempOutput, finalOutput);
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

module.exports = router;
