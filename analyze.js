const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/files");
const path = require('path');
const fs = require('fs');
const pLimit = require('p-limit');
const { HttpsProxyAgent } = require('https-proxy-agent');
const ytDlp = require('yt-dlp-exec');
const crypto = require('crypto');

const log = require('./colors').log;
const db = require('./database');
const keyManager = require('./keyManager');
const audioKeyManager = require('./audioKeyManager');
const nicheManager = require('./nicheManager');
const modulePlanner = require('./modulePlanner');
const checkpointEngine = require('./checkpointEngine');
const scriptGenerator = require('./scriptGenerator');
const scriptAssembler = require('./scriptAssembler');
const keywordEngine = require('./keywordEngine');
const descriptionEngine = require('./descriptionEngine');
const ctrEngine = require('./ctrEngine');
const pipeline = require('./pipeline');
const microTopicGenerator = require('./microTopicGenerator');
const compilationAssembler = require('./compilationAssembler');
const { parseAIJSON } = require('./json_helper');

async function analyzeContent(req, res) {
    try {
        log.info(`[DEBUG] analyzeContent input body: ${JSON.stringify(req.body)}`);
        let { projectId, audioPath, url, niche, targetLanguage, word_count, profileId, output_dir, legoMode, isManual, manualScriptText, voice_service, voiceService } = req.body;

        // 1. EXTRACT VOICE SERVICE (Multi-source detection)
        let activeVoiceService = voice_service || voiceService;

        // Check depth if nested in body
        if ((!activeVoiceService || activeVoiceService === 'none') && req.body.voice_settings?.voice_service) {
            activeVoiceService = req.body.voice_settings.voice_service;
        }

        // Check Profile Fallback
        if (!activeVoiceService || activeVoiceService === 'none') {
            if (profileId) {
                const profileData = require('./profiles').getProfileData(profileId);
                if (profileData) {
                    activeVoiceService = profileData.voice_service || profileData.voice_settings?.voice_service || profileData.voice_settings?.voiceService;
                    if (activeVoiceService) log.info(`📋 [Analyze] Recovered voice_service from profile: ${activeVoiceService}`);
                }
            }
        }

        // final Niche Fallback (Last resort for dark_psychology_de)
        if ((!activeVoiceService || activeVoiceService === 'none') && niche === 'dark_psychology_de') {
            activeVoiceService = 'ai84'; // Default for this niche
            log.info(`🛠️ [Analyze] Force-default voice_service to 'ai84' for Dark Psychology niche.`);
        }

        if (!activeVoiceService || activeVoiceService === 'none') {
            throw new Error("❌ Error: Voice Service is MANDATORY. Please select AI84 or AI33 before running.");
        }

        // 2. AUTO-PROJECT CREATION (If missing)
        if (!projectId || projectId === 'null') {
            try {
                log.info("🔍 Đang tự động tạo Dự án mới...");
                let projectTitle = `Project_${new Date().getTime()}`;
                if (url) {
                    try {
                        const info = await ytDlp(url, { dumpJson: true, noWarnings: true, quiet: true });
                        const jsonInfo = JSON.parse(info.stdout);
                        if (jsonInfo.title) projectTitle = jsonInfo.title;
                    } catch (e) { log.warn("⚠️ Không lấy được tiêu đề video, dùng tên mặc định."); }
                }
                const newId = await db.createProject(profileId || 1, projectTitle, 'GENERAL');
                projectId = newId;
                log.success(`✨ Đã tự động tạo Dự án: ${projectTitle} (ID: ${projectId})`);
            } catch (dbErr) {
                log.error("❌ Lỗi tự động tạo Project:", dbErr.message);
            }
        }

        // 3. YOUTUBE DOWNLOAD & CACHING
        if (!isManual && url && !audioPath) {
            const urlHash = crypto.createHash('md5').update(url).digest('hex');
            const cacheDir = path.join(__dirname, '../../temp/cache_audio');
            if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

            const extensions = ['.webm', '.m4a', '.mp3', '.opus', '.wav'];
            for (const ext of extensions) {
                const checkPath = path.join(cacheDir, `${urlHash}${ext}`);
                if (fs.existsSync(checkPath)) {
                    audioPath = checkPath;
                    log.success(`📦 [Cache] Sử dụng âm thanh đã có sẵn: ${audioPath}`);
                    break;
                }
            }

            if (!audioPath) {
                const outputTemplate = path.join(cacheDir, `${urlHash}.%(ext)s`);
                log.progress(`⬇️ Đang tải âm thanh mới từ ${url}...`);
                try {
                    await ytDlp(url, { format: 'bestaudio', output: outputTemplate, noPlaylist: true, quiet: true, noWarnings: true });
                    for (const ext of extensions) {
                        const checkPath = path.join(cacheDir, `${urlHash}${ext}`);
                        if (fs.existsSync(checkPath)) {
                            audioPath = checkPath;
                            break;
                        }
                    }
                } catch (dlErr) {
                    throw new Error(`Tải âm thanh thất bại: ${dlErr.message}`);
                }
            }
            if (!audioPath) throw new Error("Không thể tải hoặc tìm thấy tệp âm thanh.");
        }

        log.info(`🚀 [Analyze] Pipeline Start: Project ${projectId} | Mode: ${legoMode ? 'LEGO' : 'SHU'} | Niche: ${niche} | Voice: ${activeVoiceService}`);

        const promptStep1 = `
Phân tích nội dung và trích xuất thông tin theo cấu trúc JSON. 
Niche: ${niche}
Language: ${targetLanguage}
- Output ONLY JSON
EXTRACT: core_keyword, dominant_trigger, hook_candidates (top 3), repeated_phrases, emotion_triggers, narrative_structure, self_evaluation.
`;

        const promptStep15 = `
You are a YouTube hook evaluator. Evaluate hook strength (1-10).
OUTPUT JSON: { "hook_score": 0.0, "dominant_trigger": "...", "ctr_potential": "high/med/low", "recommendation": "proceed/rewrite/reject" }
`;

        const finalResult = await executeAIAnalysis(projectId, promptStep1, promptStep15, isManual, manualScriptText, audioPath, niche, targetLanguage, word_count, profileId, output_dir, legoMode, activeVoiceService);
        res.json({ success: true, data: finalResult, projectId });

    } catch (err) {
        log.error(`❌ Lỗi SHU Analyzer: ${err.message}`);
        res.json({ success: false, error: err.message });
    }
}

async function executeAIAnalysis(projectId, prompt1, prompt15, isManual, manualScript, audioPath, niche, targetLanguage, word_count, profileId, outputDir, legoMode, voice_service) {
    // PRE-CHECK: Validate audio path before rotation to avoid 110x retry loop
    if (!isManual && (!audioPath || typeof audioPath !== 'string')) {
        throw new Error(`❌ Error: audioPath is missing or invalid (${audioPath}). Please upload/select an audio file first or use Manual Script mode.`);
    }

    return await audioKeyManager.executeWithRotation(async (apiKey, modelName, proxy) => {
        const MODEL_PRIORITY = ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
        let lastErr = null;

        for (const mName of MODEL_PRIORITY) {
            try {
                const pxUrl = keyManager.formatProxyUrl(proxy);
                const agent = pxUrl ? new HttpsProxyAgent(pxUrl) : null;
                const genAI = new GoogleGenerativeAI(apiKey);
                let generationContent = [];

                if (isManual) {
                    generationContent = [{ text: `SCRIPT:\n${manualScript}\n\nINSTRUCTIONS:\n${prompt1}` }];
                } else {
                    log.info(`🤖 Đang phân tích nội dung [Model: ${mName}]...`);
                    const fileManager = new GoogleAIFileManager(apiKey);
                    const audioExt = path.extname(audioPath);
                    const uploadResult = await fileManager.uploadFile(audioPath, {
                        mimeType: getAudioMimeType(audioExt),
                        displayName: "YouTube Analysis",
                    });
                    await waitForFilesActive(fileManager, [uploadResult.file]);
                    generationContent = [
                        { fileData: { mimeType: getAudioMimeType(audioExt), fileUri: uploadResult.file.uri } },
                        { text: prompt1 }
                    ];
                }

                const model = genAI.getGenerativeModel({ model: mName, apiVersion: 'v1beta', generationConfig: { maxOutputTokens: 8192, temperature: 0.7 } }, { httpOptions: agent ? { agent } : undefined });
                const result = await model.generateContent(generationContent);
                const step1Json = parseAIResponse(result.response.text());
                if (!step1Json) throw new Error("Phân tích Bước 1 lỗi.");

                const scoringPrompt = `${prompt15}\n\nINPUT:\n${JSON.stringify(step1Json)}`;
                const scoringResult = await model.generateContent(scoringPrompt);
                const step15Json = parseAIResponse(scoringResult.response.text());

                let finalResult = { ...step1Json, ...step15Json };
                if (finalResult.recommendation !== 'reject') {
                    finalResult = await runDownstreamPipeline(projectId, finalResult, niche, targetLanguage, word_count, profileId, outputDir, legoMode, voice_service);
                }

                if (projectId) {
                    await db.db.run('UPDATE projects SET analysis_result = ?, status = ? WHERE id = ?', [JSON.stringify(finalResult), finalResult.recommendation === 'reject' ? 'rejected' : 'planned', projectId]);
                }
                return finalResult;
            } catch (e) {
                lastErr = e;
                log.warn(`⚠️ Model ${mName} gặp sự cố: ${e.message}`);
                continue;
            }
        }
        throw lastErr;
    });
}

async function runDownstreamPipeline(projectId, finalResult, niche, targetLanguage, word_count, profileId, outputDir, legoMode, voice_service) {
    const nicheProfile = nicheManager.getNicheConfig(niche);
    const isLego = legoMode && niche === 'dark_psychology_de';

    if (isLego) {
        log.info("🧱 [LEGO Mode] Đang kích hoạt quy trình Micro-Topic (3 Arcs)...");
        const microTopics = await microTopicGenerator.generateMicroTopics(projectId, finalResult.core_keyword, finalResult.dominant_trigger, niche);
        const arcLimit = pLimit(3); // Xử lý song song 3 Arcs

        const arcPromises = microTopics.map((topic, i) => arcLimit(async () => {
            const arcId = i + 1;
            const arcOutputDir = path.join(outputDir, `Arc_${arcId}`);
            if (!fs.existsSync(arcOutputDir)) fs.mkdirSync(arcOutputDir, { recursive: true });

            let checkpointPassed = false, checkpointRetries = 0, checkpointFeedback = null;
            let topicResult = { ...finalResult, ...topic, modules: [] };

            // 1. Script Generation for this Arc
            while (!checkpointPassed && checkpointRetries < 3) {
                checkpointRetries++;
                try {
                    const targetArcWords = word_count || nicheProfile.pipeline_settings?.target_words_per_block || 1500;
                    const planData = await modulePlanner.planModules(projectId, topicResult, checkpointFeedback?.feedback, niche, targetArcWords, 'LEGO_MICRO');
                    topicResult = { ...topicResult, ...planData };
                    const checkpointResult = await checkpointEngine.evaluatePlan(projectId, topicResult, niche, arcOutputDir, targetArcWords, 'LEGO_MICRO');
                    if (checkpointResult && checkpointResult.ready) checkpointPassed = true;
                    else checkpointFeedback = checkpointResult;
                } catch (e) { if (checkpointRetries === 3) throw e; await sleep(2000); }
            }
            const scriptData = await scriptGenerator.processAllModules(projectId, topicResult, niche, targetLanguage, arcOutputDir);
            const assembledData = await scriptAssembler.assembleScript(projectId, { ...topicResult, ...scriptData }, niche, targetLanguage);

            // 2. Voice & SRT Generation for this Arc (Standalone)
            log.info(`🎤 [LEGO] Đang tạo Voice cho Arc ${arcId}...`);
            const voiceData = await pipeline.executeFullPipeline({
                chapters: assembledData.modules_data, profileId, projectId, niche,
                unified_voice: true, voice_service, voice_id: finalResult.voice_id, output_dir: arcOutputDir,
                skip_media_gen: true // Chỉ gen Voice/SRT trước
            });

            // 3. Skeleton Visual Prompts from SRT
            log.info(`🖼️ [LEGO] Đang phân tích Skeleton Prompt cho Arc ${arcId}...`);
            const visualSpecs = pipeline.calculateVisualSpecs(voiceData.duration, nicheProfile.pipeline_settings?.scene_duration || 8, voiceData.srt_path, '1:1', 'text', null, nicheProfile);

            // Parallelism check: generateVisualPrompts uses model rotation and batching internally
            const visualPrompts = await pipeline.generateVisualPrompts(visualSpecs.scenes, { visual_style: nicheProfile.visual_style, visual_rules: nicheProfile.visual_rules, mapping_mode: '1:1' }, "Visual Narrative", `Arc_${arcId}`, projectId, arcOutputDir, true);

            return {
                id: arcId,
                title: topic.topic_title,
                audio_path: voiceData.audio_path,
                srt_path: voiceData.srt_path,
                duration: voiceData.duration,
                visual_prompts: visualPrompts,
                modules: assembledData.modules_data
            };
        }));

        const arcResults = await Promise.all(arcPromises);
        finalResult.legoBlocks = arcResults;
        finalResult.isLego = true;

        // Mega Compilation (Optional summary)
        const megaRes = await compilationAssembler.assembleMegaVideo(projectId, arcResults, niche, outputDir);
        return { ...finalResult, mega: { ...megaRes } };

    } else {
        // Standard SHU Mode
        let checkpointPassed = false, checkpointRetries = 0, checkpointFeedback = null;
        const targetWords = nicheProfile.pipeline_settings?.target_words_per_block || word_count || 4000;

        while (!checkpointPassed && checkpointRetries < 3) {
            checkpointRetries++;
            try {
                if (!checkpointFeedback || checkpointFeedback.recommendation === 'adjust_keywords') {
                    const kwData = await keywordEngine.processKeywords(projectId, finalResult, profileId, checkpointFeedback?.feedback, niche, targetLanguage);
                    finalResult = { ...finalResult, ...kwData };
                }
                const planData = await modulePlanner.planModules(projectId, finalResult, checkpointFeedback?.feedback, niche, targetWords, 'SHU');
                finalResult = { ...finalResult, ...planData };
                const checkpointResult = await checkpointEngine.evaluatePlan(projectId, finalResult, niche, outputDir, targetWords, 'SHU');
                if (checkpointResult && checkpointResult.ready) checkpointPassed = true;
                else checkpointFeedback = checkpointResult;
            } catch (e) { if (checkpointRetries === 3) throw e; await sleep(2000); }
        }
        const scriptData = await scriptGenerator.processAllModules(projectId, finalResult, niche, targetLanguage, outputDir);
        finalResult = { ...finalResult, ...scriptData };
        const assemblyData = await scriptAssembler.assembleScript(projectId, finalResult, niche, targetLanguage);
        finalResult = { ...finalResult, ...assemblyData };

        const ctrData = await ctrEngine.generateCTRBundle(projectId, finalResult.full_script, niche, targetLanguage);
        finalResult = { ...finalResult, ...ctrData };

        const pipelineData = await pipeline.executeFullPipeline({
            chapters: finalResult.modules, profileId, projectId, niche,
            unified_voice: true, voice_service, voice_id: finalResult.voice_id, output_dir: outputDir
        });
        return { ...finalResult, ...pipelineData };
    }
}

function parseAIResponse(text) {
    const results = parseAIJSON(text, "Analysis");
    if (!results) return null;
    return Array.isArray(results) ? results[0] : results;
}

function getAudioMimeType(ext) {
    if (!ext) return 'audio/mpeg';
    const map = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.webm': 'audio/webm',
        '.opus': 'audio/opus'
    };
    return map[ext.toLowerCase()] || 'audio/mpeg';
}

async function waitForFilesActive(fileManager, files) {
    for (const file of files) {
        let currentFile = await fileManager.getFile(file.name);
        while (currentFile.state === "PROCESSING") {
            await sleep(2000);
            currentFile = await fileManager.getFile(file.name);
        }
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { analyzeContent };
