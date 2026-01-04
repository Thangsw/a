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
const voiceMerger = require('./voiceMerger');

function sendMessage(event, data) {
    if (global.sendSSE) global.sendSSE(event, data);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateVisualSpecs(audioDuration, sceneDuration = 8, srtPath = null, mappingMode = 'N+1', promptFormat = 'text', srtContent = null, nicheConfig = null) {
    const audioDur = (typeof audioDuration === 'number' && !isNaN(audioDuration)) ? audioDuration : 60;

    if (nicheConfig && nicheConfig.visual_mapping_strategy === 'per_dialogue') {
        const sentences = 20; // fallback
        return {
            scene_duration: sceneDuration,
            strategy: 'per_dialogue',
            mapping_mode: '1:1',
            prompt_format: promptFormat,
            srt_based: false,
            audio_duration: audioDur,
            total_images: sentences
        };
    }

    if (srtContent || (srtPath && fs.existsSync(srtPath))) {
        const specs = srtContent ?
            srtParser.processContentWithSRT(srtContent, audioDur, sceneDuration, mappingMode) :
            srtParser.processAudioWithSRT(srtPath, audioDur, sceneDuration, mappingMode);
        if (specs) return specs;
    }

    const totalVideos = Math.floor(audioDur / sceneDuration);
    let totalImages = (mappingMode === 'N+1') ? totalVideos + 1 : totalVideos;
    return { scene_duration: sceneDuration, total_videos: totalVideos, total_images: totalImages, n_plus_one: (mappingMode === 'N+1'), mapping_mode: mappingMode, prompt_format: promptFormat, srt_based: false };
}

function mapContentToScenes(content, visualSpecs) {
    const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 5);
    const scenes = [];

    if (visualSpecs.strategy === 'per_dialogue') {
        sentences.forEach((s, i) => {
            const estTime = (visualSpecs.audio_duration || 60) * (i / sentences.length);
            scenes.push({ id: i + 1, text_segment: s + '.', start_time: estTime });
        });
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
Create a cohesive VISUAL STORYBOARD (Skeleton) summary for these scenes to maintain consistency.
INPUT: ${JSON.stringify(chunk.map(s => ({ id: s.id, text_segment: s.text_segment })))}
OUTPUT FORMAT: Return JSON Array ONLY: [{ "id": N, "summary": "Directorial instruction for scene N" }]
`;
        try {
            const result = await executeAI(projectId, skeletonPrompt, "CREATE_SKELETON_CHUNK");
            const parsed = Array.isArray(result) ? result : [result];
            allParsed.push(...parsed);
        } catch (e) {
            allParsed.push(...chunk.map(s => ({ id: s.id, summary: s.text_segment.substring(0, 100) })));
        }
    }
    return allParsed;
}

async function generateVisualPrompts(scenes, visualSettings, baseVisualPrompt, chapterId, projectId, outputDir, skipVideoPrompt = false) {
    log.info(`🧠 [Visual] Phân tích Skeleton cho ${scenes.length} phân cảnh...`);
    const skeleton = await createVisualSkeleton(scenes, baseVisualPrompt, projectId);

    const BATCH_SIZE = 5;
    const limit = pLimit(10); // PARALLELISM: 10 luồng API song song
    const batchPromises = [];

    for (let i = 0; i < skeleton.length; i += BATCH_SIZE) {
        const batch = skeleton.slice(i, i + BATCH_SIZE).map(s => ({
            ...s, text_segment: scenes.find(orig => orig.id === s.id)?.text_segment || s.summary
        }));

        batchPromises.push(limit(async () => {
            const startIndex = i + 1;
            const batchCounter = Math.floor(i / BATCH_SIZE) + 1;
            const previousPrompt = i === 0 ? "Start of chapter" : "Connect with previous visual style";
            const imageRules = promptEngine.buildImageRules(visualSettings);

            try {
                const batchResults = await generateImagePrompts(batch, startIndex, previousPrompt, imageRules, null, '', visualSettings.aspect_ratio || '16:9', projectId, chapterId, outputDir);
                return batchResults;
            } catch (e) {
                log.warn(`⚠️ [Batch ${batchCounter}] Fallback triggered: ${e.message}`);
                return batch.map(scene => ({
                    image_id: scene.id,
                    scene_id: scene.id,
                    type: 'fallback',
                    prompt: `Cinematic shot, ${scene.summary || scene.text_segment.substring(0, 100)}, 8k, photorealistic`,
                    timestamp: `${scene.start_time || 0}s`
                }));
            }
        }));
    }

    const results = await Promise.all(batchPromises);
    const imagePrompts = results.flat().sort((a, b) => a.image_id - b.image_id);

    if (skipVideoPrompt) {
        return imagePrompts.map(p => ({ ...p, video_prompt: 'Static shot, slow zoom in' }));
    }

    // (Video Gen logic trimmed as requested for Skeleton mode)
    const finalPrompts = imagePrompts.map(p => ({ ...p, video_prompt: 'Static shot, slow zoom in' }));

    // EXPORT SKELETON MAPPING FOR EDITOR
    try {
        const mappingPath = path.join(outputDir, 'skeleton_mapping.json');
        fs.writeFileSync(mappingPath, JSON.stringify(finalPrompts, null, 2), 'utf8');
        log.success(`📄 [Visual] Đã lưu Skeleton Mapping: ${mappingPath}`);
    } catch (e) {
        log.warn(`⚠️ [Visual] Không thể lưu skeleton_mapping.json: ${e.message}`);
    }

    return finalPrompts;
}

async function generateImagePrompts(batchScenes, startIndex, previousPrompt, imageRules, dedicatedKey, consistency, aspectRatio, projectId, chapterId, outputDir) {
    const processedScenes = batchScenes.map(s => ({
        id: s.id,
        summary: s.summary || 'Cinematic scene description requested.',
        narration: s.text_segment || '.',
        start_time: s.start_time
    }));

    const batchPrompt = promptEngine.buildImageBatchPrompt(processedScenes, previousPrompt, imageRules, aspectRatio);
    const result = await executeAI(projectId, batchPrompt, "GENERATE_IMAGE_BATCH");

    if (Array.isArray(result) && result.length > 0) {
        return result.map((item, i) => ({
            image_id: item.id || batchScenes[i].id,
            scene_id: item.id || batchScenes[i].id,
            type: 'detailed',
            prompt: (item.p || item.image_prompt || 'Cinematic shot').replace(/\n/g, ' ').trim(),
            timestamp: `${batchScenes[i]?.start_time || 0}s`
        }));
    }
    throw new Error('Parse failed or empty image results');
}

async function executeFullPipeline(params) {
    let { chapters, profileId, output_dir, skip_gen_voice, skip_media_gen, voice_service = 'ai84', projectId, niche, unified_voice = true } = params;

    let profile = profileId ? (getProfileManager().getProfileData(profileId) || {}) : { visual_settings: {} };
    if (output_dir) profile.output_dir = output_dir;
    const outDir = profile.output_dir || 'output_files';
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const ttsConfig = getTTSConfig();
    const nicheConfig = nicheManager.getNicheConfig(niche || profile.niche || 'self_help');

    if (unified_voice && !skip_gen_voice) {
        const fullText = (chapters || []).map(ch => ch.chapter_content || ch.content_for_tts || ch.content || ch.content_display).join("\n\n");
        if (fullText.trim().length > 0) {
            const voiceRes = await voiceMerger.processUnifiedVoice(fullText, profile, ttsConfig, outDir, voice_service, projectId);
            if (voiceRes.success) {
                if (skip_media_gen) return voiceRes; // Trả về nếu chỉ yêu cầu Voice

                const visualSpecs = calculateVisualSpecs(voiceRes.duration, profile.pipeline_settings?.scene_duration || 8, voiceRes.srt_path, profile.visual_settings?.mapping_mode || '1:1', 'text', null, nicheConfig);
                const visualPrompts = await generateVisualPrompts(visualSpecs.scenes, { ...(profile.visual_settings || {}), visual_style: nicheConfig.visual_style || '', visual_rules: nicheConfig.visual_rules || '' }, "Visual Narrative", "FINAL", projectId, outDir, true);

                return { ...voiceRes, visual_prompts: visualPrompts };
            }
        }
    }

    // Fallback logic for per-chapter processing
    return { success: false, error: "Unified Voice is mandatory for this mode." };
}

function getTTSConfig() {
    const configPath = path.join(__dirname, '../../api-config.json');
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath)).TTS_CONFIG || {};
    return {};
}

function getProfileManager() { return require('./profiles'); }

async function runFullPipeline(req, res) {
    try {
        const result = await executeFullPipeline(req.body);
        res.json({ success: true, data: result });
    } catch (e) {
        log.error("❌ [Pipeline Error]", e.message);
        res.json({ success: false, error: e.message });
    }
}

async function executeAI(projectId, prompt, actionName) {
    return await keyManager.executeWithRetry(async (apiKey) => {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: 'gemma-3-27b-it',
            apiVersion: 'v1beta',
            generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
        });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const json = parseAIJSON(text, actionName);
        if (json) return Array.isArray(json) ? json[0] : json;
        throw new Error("AI Response invalid");
    });
}

module.exports = { router, runFullPipeline, executeFullPipeline, calculateVisualSpecs, generateVisualPrompts };
