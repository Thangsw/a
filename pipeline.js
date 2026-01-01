const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pLimit = require('p-limit');
const { HttpsProxyAgent } = require('https-proxy-agent');
const keyManager = require('./keyManager');
const mediaGenerator = require('./mediaGenerator');
const { processTextToSpeech } = require('./voice_generator');
const genaiVoice = require('./genai_voice');
const ai84Voice = require('./ai84_voice');
const srtParser = require('./srt_parser');
const excelExporter = require('./excelExporter');
const { sendTelegramMessage } = require('./notifier');
const db = require('./database');
const profileManager = require('./profiles');
const promptEngine = require('./promptEngine');
const nicheManager = require('./nicheManager');
const { parseAIJSON } = require('./json_helper');
const { log } = require('./colors');

function sendMessage(event, data) {
    if (global.sendSSE) global.sendSSE(event, data);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatProxyUrl(proxy) {
    if (!proxy) return null;
    const parts = proxy.split(':');
    if (parts.length === 4) {
        return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
    }
    return proxy.includes('://') ? proxy : `http://${proxy}`;
}

function getProfileData(profileId) {
    return profileManager.getProfileData(profileId);
}

function getTTSConfig() {
    const configPath = path.join(__dirname, '../../api-config.json');
    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath));
        return config.TTS_CONFIG || {};
    }
    return {};
}

function calculateVisualSpecs(audioDuration, sceneDuration = 8, srtPath = null, mappingMode = 'N+1', promptFormat = 'text', srtContent = null, nicheConfig = null) {
    const audioDur = (typeof audioDuration === 'number' && !isNaN(audioDuration)) ? audioDuration : 60;

    if (nicheConfig && nicheConfig.visual_mapping_strategy === 'per_dialogue') {
        return {
            scene_duration: sceneDuration,
            strategy: 'per_dialogue',
            mapping_mode: '1:1',
            prompt_format: promptFormat,
            srt_based: false,
            audio_duration: audioDur
        };
    }

    if (srtContent) {
        const srtSpecs = srtParser.processContentWithSRT(srtContent, audioDur, sceneDuration, mappingMode);
        if (srtSpecs) return srtSpecs;
    }
    if (srtPath && fs.existsSync(srtPath)) {
        const srtSpecs = srtParser.processAudioWithSRT(srtPath, audioDur, sceneDuration, mappingMode);
        if (srtSpecs) return srtSpecs;
    }
    const totalVideos = Math.floor(audioDur / sceneDuration);
    let totalImages = (mappingMode === 'N+1') ? totalVideos + 1 : totalVideos;
    console.log(`📊 [Logic Hình ảnh] Âm thanh: ${audioDur.toFixed(1)}s -> ${totalVideos} video + ${totalImages} ảnh (${mappingMode})`);
    return { scene_duration: sceneDuration, total_videos: totalVideos, total_images: totalImages, n_plus_one: (mappingMode === 'N+1'), mapping_mode: mappingMode, prompt_format: promptFormat, srt_based: false };
}

function mapContentToScenes(content, visualSpecs) {
    const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 5);
    const scenes = [];

    if (visualSpecs.strategy === 'per_dialogue') {
        console.log(`🧠 [Logic Hình ảnh] Chiến lược: THEO HỘI THOẠI -> Tạo ${sentences.length} phân cảnh.`);
        sentences.forEach((s, i) => {
            const estTime = (visualSpecs.audio_duration || 60) * (i / sentences.length);
            scenes.push({ id: i + 1, text_segment: s + '.', start_time: estTime });
        });
        visualSpecs.total_images = scenes.length;
        visualSpecs.total_videos = scenes.length;
        return scenes;
    }

    const sceneCount = visualSpecs.total_images;
    const sentencesPerScene = Math.max(1, Math.floor(sentences.length / sceneCount));
    for (let i = 0; i < sceneCount; i++) {
        const start = i * sentencesPerScene;
        const end = (i === sceneCount - 1) ? sentences.length : start + sentencesPerScene;
        const segment = sentences.slice(start, end).join('. ') + '.';
        scenes.push({ id: i + 1, text_segment: segment, start_time: i * visualSpecs.scene_duration });
    }
    return scenes;
}

async function createVisualSkeleton(scenes, basePrompt, projectId) {
    const CHUNK_SIZE = 25;
    const allParsed = [];
    for (let i = 0; i < scenes.length; i += CHUNK_SIZE) {
        const chunk = scenes.slice(i, i + CHUNK_SIZE);
        const skeletonPrompt = `
You are an Expert Visual Director specialized in "${basePrompt}".
Task: Create a cohesive VISUAL STORYBOARD (Skeleton) for scenes ${i + 1} to ${Math.min(i + CHUNK_SIZE, scenes.length)}.
INPUT: ${JSON.stringify(chunk.map(s => ({ id: s.id, text_segment: s.text_segment })))}
OUTPUT FORMAT: Return raw JSON Array ONLY: [{ "id": N, "summary": "Directorial instruction" }]
`;
        try {
            const result = await executeAI(projectId, skeletonPrompt, "CREATE_SKELETON_CHUNK");
            allParsed.push(...result);
        } catch (e) {
            console.error(`      ⚠️ [Skeleton] Lỗi chunk:`, e.message);
            allParsed.push(...chunk.map(s => ({ id: s.id, summary: s.text_segment.substring(0, 50) })));
        }
    }
    return allParsed;
}

async function generateImagePrompts(batchScenes, startIndex, previousPrompt, imageRules, dedicatedKey, consistency, aspectRatio, projectId, chapterId, outputDir) {
    const processedScenes = batchScenes.map(s => ({
        id: s.id, summary: s.summary || 'Cinematic scene description requested.',
        narration: s.text_segment || '.', start_time: s.start_time
    }));

    const batchPrompt = promptEngine.buildImageBatchPrompt(processedScenes, previousPrompt, imageRules, aspectRatio);

    try {
        const result = await executeAI(projectId, batchPrompt, "GENERATE_IMAGE_BATCH");
        if (Array.isArray(result) && result.length > 0) {
            return result.map((item, i) => ({
                image_id: item.id || startIndex + i,
                scene_id: item.id || startIndex + i,
                type: 'detailed',
                prompt: (item.p || item.image_prompt || 'Cinematic shot').replace(/\n/g, ' ').trim(),
                timestamp: `${batchScenes[i]?.start_time || 0}s`
            }));
        }
        throw new Error('Parse failed or empty image results');
    } catch (err) {
        throw err;
    }
}

async function generateVideoPrompts(videoContexts, videoRules, projectId, chapterId, outputDir, batchNum = 1, mappingMode = 'N+1') {
    const isNPlusOne = mappingMode === 'N+1';
    const batchPrompt = promptEngine.buildVideoBatchPrompt(videoContexts, videoRules, isNPlusOne);

    try {
        return await executeAI(projectId, batchPrompt, "GENERATE_VIDEO_BATCH");
    } catch (e) {
        console.error(`      ⚠️ [VideoPrompts] Lỗi:`, e.message);
        return [];
    }
}

async function generateVisualPrompts(scenes, visualSettings, baseVisualPrompt, chapterId, projectId, outputDir, skipVideoPrompt = false) {
    const skeleton = await createVisualSkeleton(scenes, baseVisualPrompt, projectId);
    const BATCH_SIZE = 5;
    const imagePrompts = [];
    let previousScenePrompt = "Đây là cảnh đầu tiên của chương. YÊU CẦU: Hãy viết cực kỳ chi tiết...";
    let batchCounter = 1;

    for (let i = 0; i < skeleton.length;) {
        const batch = skeleton.slice(i, i + BATCH_SIZE).map(s => ({
            ...s, text_segment: scenes.find(orig => orig.id === s.id)?.text_segment || s.summary
        }));
        try {
            const batchResults = await generateImagePrompts(batch, batchCounter, previousScenePrompt, promptEngine.buildImageRules(visualSettings), null, '', visualSettings.aspect_ratio || '16:9', projectId, chapterId, outputDir);
            if (Array.isArray(batchResults) && batchResults.length > 0) {
                imagePrompts.push(...batchResults);
                previousScenePrompt = batchResults[batchResults.length - 1].prompt;
                i += batchResults.length;
            } else { throw new Error("Empty batch results"); }
            batchCounter++;
        } catch (e) {
            batch.forEach(scene => imagePrompts.push({ image_id: scene.id, scene_id: scene.id, type: 'fallback', prompt: `Cinematic shot, ${scene.summary}, 8k`, timestamp: `${scene.start_time}s` }));
            i += batch.length;
            batchCounter++;
        }
    }

    const mappingMode = visualSettings.mapping_mode || 'N+1';
    const videoContexts = [];
    if (mappingMode === 'N+1') {
        for (let k = 0; k < imagePrompts.length - 1; k++) {
            videoContexts.push({ id: imagePrompts[k].scene_id, start_image_prompt: imagePrompts[k].prompt, end_image_prompt: imagePrompts[k + 1].prompt });
        }
    } else {
        for (let k = 0; k < imagePrompts.length; k++) {
            videoContexts.push({ id: imagePrompts[k].scene_id, image_prompt: imagePrompts[k].prompt });
        }
    }

    if (skipVideoPrompt) return imagePrompts.map(p => ({ ...p, video_prompt: 'Static shot, slow zoom in' }));

    const VIDEO_BATCH_SIZE = 5;
    const videoResults = [];
    for (let k = 0; k < videoContexts.length; k += VIDEO_BATCH_SIZE) {
        const videoBatch = videoContexts.slice(k, k + VIDEO_BATCH_SIZE);
        const batchVideoResults = await generateVideoPrompts(videoBatch, promptEngine.buildVideoRules(visualSettings), projectId, chapterId, outputDir, Math.floor(k / VIDEO_BATCH_SIZE) + 1, mappingMode);
        if (Array.isArray(batchVideoResults)) videoResults.push(...batchVideoResults);
    }

    return imagePrompts.map(p => {
        const v = videoResults.find(vr => vr.id === p.scene_id);
        let finalVideoPrompt = 'Static shot, slow zoom in';
        if (v) {
            const specs = v.video_specs || {};
            const techInfo = `CAMERA: ${specs.camera_move || ''} | MOTION: ${specs.subject_motion || ''} | LIGHT: ${specs.lighting_time || ''} | PHYSICS: ${specs.physics_focus || ''} | CONTINUITY: ${specs.continuity || ''}`;
            finalVideoPrompt = `[TECHNICAL SPECS]\n${techInfo}\n\n[ARTISTIC PROSE]\n${v.artistic_prose || ''}\n\n[CLIFFHANGER]\n${v.cliffhanger_note || ''}`;
        }
        return { ...p, video_prompt: finalVideoPrompt };
    });
}

async function processChapter(chapter, profileConfig, ttsConfig, chapterIndex, skipVoice = false, totalChapters = 1, voiceService = 'ai33', projectId, skipVideoPrompt = false, nicheOverride = null) {
    const textContent = chapter.content_for_tts || chapter.content_display || chapter.chapter_content || "";
    let visualSpecs = chapter.visual_specs;
    if (!visualSpecs && chapter.use_srt && chapter.srt_content) {
        visualSpecs = srtParser.processContentWithSRT(chapter.srt_content, 300, 8, 'N+1');
    }
    const outDir = profileConfig.output_dir || 'output_files';
    let voiceResult = { success: true, duration: (chapter.content_display?.split(/\s+/).length || 100) / 2.5 };
    if (!skipVoice) {
        if (voiceService === 'ai84') {
            const ai84Data = ai84Voice.loadAI84Data();
            const currentKey = (ai84Data.api_keys || [])[chapterIndex % (ai84Data.api_keys?.length || 1)];
            const targetVoice = ai84Data.default_voice_id || 'qAZH0aMXY8tw1QufPN0D';
            const result = await ai84Voice.generateVoice(textContent, `Chapter_${chapter.chapter_id}`, outDir, targetVoice, {}, null, currentKey);
            voiceResult = { success: result.success, audio_path: result.mp3_path, srt_path: result.srt_path, duration: result.duration || 60 };
        } else {
            voiceResult = await processTextToSpeech(textContent, ttsConfig, outDir, `Chapter_${chapter.chapter_id}`, { chapterNum: chapterIndex + 1, totalChapters });
        }
    }
    const nicheName = nicheOverride || profileConfig.niche || global.currentNiche || 'self_help';
    const nicheConfig = nicheManager.getNicheConfig(nicheName);
    if (!visualSpecs) {
        visualSpecs = calculateVisualSpecs(voiceResult.duration, profileConfig.pipeline_settings?.scene_duration || 8, voiceResult.srt_path, profileConfig.visual_settings?.mapping_mode || 'N+1', 'text', chapter.srt_content, nicheConfig);
    }
    let scenes = visualSpecs.srt_based ? visualSpecs.scenes : mapContentToScenes(chapter.content_for_tts || chapter.content_display || '', visualSpecs);
    const visualPrompts = await generateVisualPrompts(scenes, { ...(profileConfig.visual_settings || {}), visual_style: nicheConfig.visual_style || '', visual_rules: nicheConfig.visual_rules || '' }, chapter.visual_prompt, chapter.chapter_id, projectId, outDir, skipVideoPrompt);
    return { chapter_id: chapter.chapter_id, audio: voiceResult, visual_specs: visualSpecs, visual_prompts: visualPrompts, breakdown: Array.from({ length: visualSpecs.total_images }, (_, i) => ({ id: i + 1, type: 'image', duration: visualSpecs.scene_duration })), clean_text: (chapter.content_for_tts || '').replace(/\[.*?\]/g, '').trim() };
}

async function runFullPipeline(req, res) {
    try {
        let { chapters, profileId, output_dir, skip_gen_voice, skip_media_gen, voice_service, projectId, srt_batch, skip_video_prompt, niche } = req.body;
        if ((!chapters || chapters.length === 0) && srt_batch) {
            chapters = srt_batch.map((item, idx) => {
                const specs = srtParser.processContentWithSRT(item.content, 300, 8, 'N+1');
                const display = specs?.scenes?.map(s => s.text_segment).join('\n') || item.content;
                return { chapter_id: item.order || (idx + 1), chapter_content: item.content, content_display: display, content_for_tts: display, visual_specs: specs, use_srt: true, srt_content: item.content };
            });
        }
        if (!chapters) return res.json({ success: false, error: 'Chapters missing' });
        let profile = profileId ? (getProfileData(profileId) || {}) : { visual_settings: {} };
        if (output_dir) profile.output_dir = output_dir;
        const limitChapters = pLimit(parseInt(req.body.chapter_concurrency || "10"));
        sendMessage('voice_start', { total: chapters.length, projectId });
        const results = await Promise.all(chapters.map((chapter, idx) => limitChapters(async () => {
            await sleep(idx * 2000);
            const r = await processChapter(chapter, profile, getTTSConfig(), idx, skip_gen_voice, chapters.length, voice_service, projectId, skip_video_prompt, niche);
            sendMessage('voice_item_complete', { chapter_id: chapter.chapter_id, audio_path: r.audio?.audio_path, projectId });
            return r;
        })));
        results.sort((a, b) => a.chapter_id - b.chapter_id);
        const outDir = profile.output_dir || 'output_files';
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        excelExporter.exportPromptsToExcel(results, path.join(outDir, 'storyboard_prompts.xlsx'), path.join(__dirname, '../../storyboard_prompts.xlsx'));
        if (skip_media_gen) return res.json({ success: true, data: { chapters: results } });
        await Promise.all(results.map(result => mediaGenerator.processChapterSequential(result, { name: 'default', skipVideoPrompt: skip_video_prompt }, outDir, (type, data) => sendMessage(type, data))));
        res.json({ success: true, data: { chapters: results } });
    } catch (e) { res.json({ success: false, error: e.message }); }
}

async function executeAI(projectId, prompt, actionName) {
    const MODEL_PRIORITY = ['gemini-3-flash-preview', 'gemma-3-27b-it', 'gemma-3-12b-it'];
    let lastError = null;
    for (const modelName of MODEL_PRIORITY) {
        try {
            return await keyManager.executeWithRetry(async (apiKey) => {
                const genAI = new GoogleGenerativeAI(apiKey);
                log.info(`🤖 Đang xử lý Visual [Model: ${modelName}] bằng một API Key khả dụng...`);
                const model = genAI.getGenerativeModel({ model: modelName, apiVersion: 'v1beta', generationConfig: { maxOutputTokens: 8192, temperature: 0.7 } });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                const json = parseAIJSON(text, actionName);
                if (json) {
                    if (projectId) await db.logAIAction(projectId, actionName, modelName, response.usageMetadata?.totalTokenCount || 0, text);
                    return json;
                }
                throw new Error("Phản hồi AI không hợp lệ");
            });
        } catch (err) {
            lastError = err;
            const errMsg = err.message.toLowerCase();
            const isRetryable = errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('503') ||
                errMsg.includes('overloaded') || errMsg.includes('exhausted') ||
                errMsg.includes('econnreset') || errMsg.includes('etimedout') ||
                errMsg.includes('socket') || errMsg.includes('network');

            if (isRetryable) {
                log.warn(`⚠️ Model ${modelName} gặp lỗi tạm thời: ${err.message}. Đang thử lại hoặc model tiếp theo...`);
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}

router.post('/run-pipeline', runFullPipeline);
module.exports = { router, runFullPipeline, processChapter, calculateVisualSpecs, generateVisualPrompts, generateImagePrompts };
