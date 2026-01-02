const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager, FileState } = require('@google/generative-ai/files');
const ytDlp = require('yt-dlp-exec');
const audioKeyManager = require('./audioKeyManager');
const { getProfileData } = require('./profiles');
const { log } = require('./colors');
const db = require('./database');
const { sendTelegramMessage } = require('./notifier');
const nicheManager = require('./nicheManager');
const keyManager = require('./keyManager'); // Use standard keyManager for non-audio parts if needed

// Helper for Audio Mime Types
function getAudioMimeType(ext) {
    if (ext === '.webm') return 'audio/webm';
    if (ext === '.m4a') return 'audio/mp4';
    if (ext === '.mp3') return 'audio/mp3';
    if (ext === '.wav') return 'audio/wav';
    return 'audio/mpeg';
}

// Helper to wait for file active state
async function waitForFilesActive(fileManager, files) {
    log.progress("⏳ Đang chờ Gemini xử lý file...");
    for (const file of files) {
        let fileStatus = await fileManager.getFile(file.name);
        while (fileStatus.state === FileState.PROCESSING) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            fileStatus = await fileManager.getFile(file.name);
        }
        if (fileStatus.state === FileState.FAILED) {
            throw new Error("File processing failed on Gemini.");
        }
    }
    log.success("✅ File đã sẵn sàng để phân tích.");
}

const keywordEngine = require('./keywordEngine');
const modulePlanner = require('./modulePlanner');
const checkpointEngine = require('./checkpointEngine');
const scriptGenerator = require('./scriptGenerator');
const scriptAssembler = require('./scriptAssembler');
const ctrEngine = require('./ctrEngine');
const descriptionEngine = require('./descriptionEngine');
const pipeline = require('./pipeline');
const microTopicGenerator = require('./microTopicGenerator');
const compilationAssembler = require('./compilationAssembler');

const crypto = require('crypto');

/**
 * Step 1 & 1.5: Content Analyzer & Hook scoring
 */
async function analyzeContent(req, res) {
    let { url, modelName, manualScript, projectId, profileId, niche = 'dark_psychology_de', targetLanguage, word_count, output_dir = 'output', legoMode = true } = req.body;

    const nicheProfile = nicheManager.getProfile(niche);

    // Auto-detect defaults from niche if missing
    if (!targetLanguage) targetLanguage = nicheProfile.language || 'English';
    if (!word_count) {
        if (legoMode && niche === 'dark_psychology_de') {
            word_count = 4500; // 3 units x 1500
        } else {
            word_count = nicheProfile.pipeline_settings?.target_words_per_block || 1500;
        }
    }

    if (!profileId || profileId === 'null') return res.json({ success: false, error: 'Vui lòng chọn Kênh (Profile) trước khi chạy!' });

    // Auto-Project Creation if missing
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

            const newId = await db.createProject(profileId, projectTitle, 'GENERAL');
            projectId = newId;
            log.success(`✨ Đã tự động tạo Dự án: ${projectTitle} (ID: ${projectId})`);
        } catch (dbErr) {
            log.error("❌ Lỗi tự động tạo Project:", dbErr.message);
        }
    }

    if (!url && !manualScript) return res.json({ success: false, error: 'URL or Manual Script is required' });

    let audioPath = null;

    try {
        const isManual = !!manualScript;
        const manualScriptText = manualScript;

        if (!isManual) {
            // AUDIO CACHING LOGIC
            const urlHash = crypto.createHash('md5').update(url).digest('hex');
            const cacheDir = path.join(__dirname, '../../temp/cache_audio');
            if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

            // Check if cached file exists
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
                const tempId = Date.now();
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
                    console.error(`❌ Lỗi YT-DLP:`, dlErr.message);
                    throw new Error(`Tải âm thanh thất bại. Kiểm tra URL hoặc mạng.`);
                }
            }

            if (!audioPath) throw new Error("Tải âm thanh thất bại.");
        }

        const promptStep1 = `
You are a content analyst specialized in YouTube psychology and explainer-style videos.
STRICT RULES:
- Do NOT rewrite or paraphrase
- hooks and phrases must be copied EXACTLY
- Output ONLY JSON
EXTRACT: hook_candidates (top 3), repeated_phrases, emotion_triggers, narrative_structure, self_evaluation.
`;

        const promptStep15 = `
You are a YouTube hook evaluator. Evaluate hook strength (1-10).
OUTPUT JSON: { "hook_score": 0.0, "dominant_trigger": "...", "ctr_potential": "high/med/low", "recommendation": "proceed/rewrite/reject" }
`;

        // Pass legoMode and output_dir explicitly
        const finalResult = await executeAIAnalysis(projectId, promptStep1, promptStep15, isManual, manualScriptText, audioPath, niche, targetLanguage, word_count, profileId, output_dir, legoMode);

        res.json({ success: true, data: finalResult, projectId });

    } catch (err) {
        log.error(`❌ Lỗi SHU Analyzer: ${err.message}`);
        res.json({ success: false, error: err.message });
    }
    // Note: We NO LONGER delete the audioPath here because it's cached.
}

async function executeAIAnalysis(projectId, prompt1, prompt15, isManual, manualScript, audioPath, niche, targetLanguage, word_count, profileId, outputDir = 'output') {
    const MODEL_PRIORITY = ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
    let lastError = null;

    for (const modelName of MODEL_PRIORITY) {
        try {
            // Wait, audioKeyManager usually rotates automatically via executeWithRotation.
            // Let's use it:
            return await audioKeyManager.executeWithRotation(async (apiKey) => {
                const genAI = new GoogleGenerativeAI(apiKey);
                const fileManager = new GoogleAIFileManager(apiKey);
                let generationContent = [];

                if (isManual) {
                    generationContent = [{ text: `SCRIPT:\n${manualScript}\n\nINSTRUCTIONS:\n${prompt1}` }];
                } else {
                    log.info(`🤖 Đang phân tích âm thanh [Model: ${modelName}] bằng Key: ...${apiKey.slice(-4)}`);
                    const uploadResult = await fileManager.uploadFile(audioPath, {
                        mimeType: getAudioMimeType(path.extname(audioPath)),
                        displayName: "YouTube Analysis",
                    });
                    await waitForFilesActive(fileManager, [uploadResult.file]);

                    generationContent = [
                        { fileData: { mimeType: getAudioMimeType(path.extname(audioPath)), fileUri: uploadResult.file.uri } },
                        { text: prompt1 }
                    ];
                }

                const model = genAI.getGenerativeModel({
                    model: modelName,
                    apiVersion: 'v1beta',
                    generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
                });

                const result = await model.generateContent(generationContent);
                const step1Json = parseAIResponse(result.response.text());
                if (!step1Json) throw new Error("Phân tích Bước 1 không trả về JSON.");

                // Scoring Phase
                const nicheConfig = nicheManager.getNicheConfig(niche);
                let fullPrompt15 = prompt15;
                if (targetLanguage === 'German' || nicheConfig.market === 'DE') {
                    fullPrompt15 += `\nGERMAN RULES: Focus on logic, behavioral observation, no American hype.`;
                }
                const scoringPrompt = `${fullPrompt15}\n\nINPUT:\n${JSON.stringify(step1Json)}`;
                const scoringResult = await model.generateContent(scoringPrompt);
                const step15Json = parseAIResponse(scoringResult.response.text());
                if (!step15Json) throw new Error("Bước 1.5 Scoring không trả về JSON.");

                let finalResult = { ...step1Json, ...step15Json };

                // Downstream Pipeline
                if (finalResult.recommendation !== 'reject') {
                    finalResult = await runDownstreamPipeline(projectId, finalResult, niche, targetLanguage, word_count, profileId, outputDir, legoMode);
                }

                // Persistence
                if (projectId) {
                    await db.db.run('UPDATE projects SET analysis_result = ?, status = ? WHERE id = ?',
                        [JSON.stringify(finalResult), finalResult.recommendation === 'reject' ? 'rejected' : 'planned', projectId]);

                    if (finalResult.recommendation === 'reject') {
                        await sendTelegramMessage(`🚫 [SHU REJECTED] Score: ${finalResult.hook_score}/10. Niche: ${niche}`);
                    }
                }

                return finalResult;
            }, modelName); // Pass modelName to instruction rotation

        } catch (err) {
            lastError = err;
            const errMsg = err.message.toLowerCase();
            if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('503') || errMsg.includes('overloaded') || errMsg.includes('exhausted')) {
                log.warn(`⚠️ Model ${modelName} thất bại trên TẤT CẢ các Keys. Đang thử model tiếp theo...`);
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}

async function runDownstreamPipeline(projectId, finalResult, niche, targetLanguage, word_count, profileId, outputDir = 'output', legoMode = true) {
    let microTopics = [];
    if (legoMode && niche === 'dark_psychology_de') {
        log.info("🧱 [LEGO Mode] Đang kích hoạt quy trình Micro-Topic (3 Arcs)...");

        // SSE: Initialize LEGO Queue
        if (global.sendSSE) {
            global.sendSSE('queue_update', {
                isLego: true,
                items: [
                    { id: 'block_1', name: 'Micro Clip 1', status: 'processing', progress: 10, type: 'micro' },
                    { id: 'block_2', name: 'Micro Clip 2', status: 'pending', progress: 0, type: 'micro' },
                    { id: 'block_3', name: 'Micro Clip 3', status: 'pending', progress: 0, type: 'micro' },
                    { id: 'mega', name: 'Mega Compilation', status: 'pending', progress: 0, type: 'mega' }
                ]
            });
        }

        microTopics = await microTopicGenerator.generateMicroTopics(projectId, finalResult.core_keyword, finalResult.dominant_trigger, niche);
    }

    // Nếu có microTopics, chúng ta sẽ chạy generation cho từng topic (hiện tại đơn giản hóa là gộp meta)
    // Trong tương lai, có thể lặp qua từng topic để tạo 3 bộ script/audio riêng biệt.
    // Hiện tại: Module Planner sẽ được báo là có microTopics để nó lên kế hoạch 3 blocks.

    let checkpointPassed = false;
    let checkpointRetries = 0;
    let checkpointFeedback = null;

    while (!checkpointPassed && checkpointRetries < 3) {
        checkpointRetries++;
        try {
            if (!checkpointFeedback || checkpointFeedback.recommendation === 'adjust_keywords') {
                const keywordData = await keywordEngine.processKeywords(projectId, finalResult, profileId, checkpointFeedback?.feedback, niche, targetLanguage);
                finalResult = { ...finalResult, ...keywordData };
            }

            if (!checkpointPassed && (!checkpointFeedback || checkpointFeedback.recommendation === 'replan_modules' || checkpointFeedback.recommendation === 'adjust_keywords')) {
                // Pass microTopics to planner if available
                const planData = await modulePlanner.planModules(projectId, { ...finalResult, micro_topics: microTopics }, checkpointFeedback?.feedback, niche, word_count);
                finalResult = { ...finalResult, ...planData };
            }

            const checkpointResult = await checkpointEngine.evaluatePlan(projectId, finalResult, niche, outputDir, word_count);
            if (checkpointResult && checkpointResult.ready) {
                checkpointPassed = true;
            } else {
                checkpointFeedback = checkpointResult;
            }
        } catch (loopErr) {
            log.error(`⚠️ Lỗi Pipeline: ${loopErr.message}`);
            if (checkpointRetries === 3) throw loopErr;
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    // Generator Steps
    try {
        const scriptData = await scriptGenerator.processAllModules(projectId, finalResult, niche, targetLanguage);
        finalResult = { ...finalResult, ...scriptData };

        const assemblyData = await scriptAssembler.assembleScript(projectId, finalResult, niche, targetLanguage);
        finalResult = { ...finalResult, ...assemblyData };

        const ctrData = await ctrEngine.generateCTRBundle(projectId, finalResult.full_script, niche, targetLanguage);
        finalResult = { ...finalResult, ...ctrData };

        const descData = await descriptionEngine.generateDescriptionBundle(projectId, finalResult, niche, targetLanguage);
        finalResult = { ...finalResult, description_bundle: descData };

        // --- STEP 7: AUTO-PILOT TO VIDEO (VOICE & ASSETS) ---
        log.info("🚁 [SHU Pipeline] Đang tạo Voice & Assets cho kịch bản...");
        const pipelineData = await pipeline.executeFullPipeline({
            chapters: finalResult.modules || [],
            profileId: profileId,
            projectId: projectId,
            niche: niche,
            unified_voice: true,
            voice_service: 'ai84',
            output_dir: outputDir
        });

        // Merge results
        finalResult = { ...finalResult, ...pipelineData };

        // --- STEP 8: LEGO FINAL ASSEMBLY (Compilation) ---
        if (legoMode && niche === 'dark_psychology_de') {
            log.info("🧩 [LEGO Final] Đang ghép nối 3 micro-outputs thành Mega-Video...");

            // SSE: Update Mega in Queue
            if (global.sendSSE) {
                global.sendSSE('queue_update', {
                    isLego: true,
                    items: [
                        { id: 'block_1', name: 'Micro Clip 1', status: 'completed', progress: 100, type: 'micro' },
                        { id: 'block_2', name: 'Micro Clip 2', status: 'completed', progress: 100, type: 'micro' },
                        { id: 'block_3', name: 'Micro Clip 3', status: 'completed', progress: 100, type: 'micro' },
                        { id: 'mega', name: 'Mega Compilation', status: 'processing', progress: 50, type: 'mega' }
                    ]
                });
            }

            const megaResult = await compilationAssembler.assembleMegaVideo(projectId, finalResult.modules || [], niche, outputDir);

            // SSE: Finish Mega
            if (global.sendSSE) {
                global.sendSSE('queue_update', {
                    isLego: true,
                    items: [
                        { id: 'block_1', name: 'Micro Clip 1', status: 'completed', progress: 100, type: 'micro' },
                        { id: 'block_2', name: 'Micro Clip 2', status: 'completed', progress: 100, type: 'micro' },
                        { id: 'block_3', name: 'Micro Clip 3', status: 'completed', progress: 100, type: 'micro' },
                        { id: 'mega', name: 'Mega Compilation', status: 'completed', progress: 100, type: 'mega' }
                    ]
                });
            }

            // Build 3 Separate Block Results with REAL AI METADATA
            log.info("🤖 [LEGO Hub] Đang tạo Metadata & Scroring riêng biệt cho 3 Micro-Topics...");
            const legoBlocks = [];
            const modules = finalResult.modules || [];
            const blockSize = Math.ceil(modules.length / 3);

            for (let i = 0; i < 3; i++) {
                const blockModules = modules.slice(i * blockSize, (i + 1) * blockSize);
                const blockScript = blockModules.map(m => m.script).join('\n\n');
                const topic = microTopics[i] || { topic_title: `Micro Topic ${i + 1}`, core_question: "Unknown" };

                // Generate Specific Metadata for this Block via AI
                const blockMetaPrompt = `
You are a YouTube SEO Expert for the German market (Style: Mr No Plan A).
Given this script snippet, generate catchy viral titles, a deep psychological description, and relevant tags.
Also evaluate the hook score (1-10) for this specific segment.

TOPIC: ${topic.topic_title}
MECHANISM: ${topic.named_mechanism || "Psychological manipulation"}
SCRIPT:
${blockScript.substring(0, 3000)}

OUTPUT JSON ONLY:
{
  "hook_score": 0.0,
  "titles": ["Title 1", "Title 2"],
  "description": "...",
  "tags": ["tag1", "tag2"],
  "thumbnail": "Visual concept for thumbnail"
}
`;
                let blockData = { hook_score: 7.0, titles: [`${topic.topic_title}`], description: `Deep dive into ${topic.named_mechanism}`, tags: ["psychology", "analysis"], thumbnail: "N/A" };
                try {
                    const blockRes = await audioKeyManager.executeWithRotation(async (apiKey) => {
                        const genAI = new GoogleGenerativeAI(apiKey);
                        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-lite' });
                        const res = await model.generateContent(blockMetaPrompt);
                        return parseAIResponse(res.response.text());
                    });
                    if (blockRes) blockData = blockRes;
                } catch (e) { log.warn(`⚠️ Lỗi tạo metadata cho block ${i + 1}: ${e.message}`); }

                legoBlocks.push({
                    id: i + 1,
                    full_script: blockScript,
                    ...blockData,
                    modules: blockModules
                });
            }

            return {
                ...finalResult,
                isLego: true,
                legoBlocks: legoBlocks,
                mega: {
                    ...finalResult,
                    ...megaResult,
                    full_script: finalResult.full_script,
                    titles: finalResult.titles || [],
                    metadata: finalResult.description_bundle
                }
            };
        }

    } catch (genErr) {
        log.error(`❌ Lỗi Generator Step: ${genErr.message}`);
    }

    return finalResult;
}

const { parseAIJSON } = require('./json_helper');
function parseAIResponse(text) {
    const results = parseAIJSON(text, "Analysis");
    if (!results) return null;
    return results.length === 1 ? results[0] : results;
}

module.exports = { analyzeContent };
