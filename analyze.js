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

const crypto = require('crypto');

/**
 * Step 1 & 1.5: Content Analyzer & Hook scoring
 */
async function analyzeContent(req, res) {
    let { url, modelName, manualScript, projectId, profileId, niche = 'self_help', targetLanguage = 'English', word_count = 5000, output_dir = 'output' } = req.body;

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

        // Pass output_dir explicitly to avoid 'req' scoping issues later
        const finalResult = await executeAIAnalysis(projectId, promptStep1, promptStep15, isManual, manualScriptText, audioPath, niche, targetLanguage, word_count, profileId, output_dir);

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
                    finalResult = await runDownstreamPipeline(projectId, finalResult, niche, targetLanguage, word_count, profileId, outputDir);
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

async function runDownstreamPipeline(projectId, finalResult, niche, targetLanguage, word_count, profileId, outputDir = 'output') {
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
                const planData = await modulePlanner.planModules(projectId, finalResult, checkpointFeedback?.feedback, niche, word_count);
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

        const descData = await descriptionEngine.generateDescriptionBundle(projectId, finalResult.step5_result, niche, targetLanguage);
        finalResult = { ...finalResult, description_bundle: descData };

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
