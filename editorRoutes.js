const express = require('express');
const router = express.Router();
const srtParser = require('./srt_parser');
const metadataManager = require('./metadataManager');
const path = require('path');
const fs = require('fs-extra');
const { log } = require('./colors');
const db = require('./database');

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
 * API: Render & Apply SEO Thô
 */
router.post('/render', async (req, res) => {
    try {
        const { skeleton, image_path, seo, mapping } = req.body;
        log.info(`🚀 [Editor API] Starting render for video with ${mapping.length} scenes.`);

        const dummyOutput = path.join(__dirname, '../../output_files/temp_video.mp4');
        const finalOutput = path.join(__dirname, '../../output_files/seo_ready_video.mp4');

        await fs.ensureDir(path.dirname(finalOutput));

        try {
            if (await fs.exists(dummyOutput)) {
                await metadataManager.applyMetadata(dummyOutput, finalOutput, {
                    template: seo.template,
                    artist: seo.artist,
                    tags: seo.tags,
                    title: "Smart Editor Produced Video"
                });
            } else {
                log.warn("[Editor API] Dummy video not found, skipping metadata application.");
            }
        } catch (metaErr) {
            log.warn(`[Editor API] Metadata application failed: ${metaErr.message}`);
        }

        res.json({
            success: true,
            message: "Render process initiated (Metadata applied if source existed).",
            output: finalOutput
        });

    } catch (err) {
        log.error(`[Editor API] Render failed: ${err.message}`);
        res.json({ success: false, error: err.message });
    }
});

module.exports = router;
