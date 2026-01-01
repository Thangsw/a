const fs = require('fs');
console.log('--- DEBUG: script.js is being loaded ---');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const { getProfileData } = require('./profiles');
const { log } = require('./colors');
const db = require('./database');
const keywordEngine = require('./keywordEngine');

// ===== V3 CONSTANTS =====
const WORDS_PER_CHAPTER_LIMIT = 600;
const WORDS_PER_MINUTE = 166;

// Health tracker for models (global)
if (!global.modelHealth) global.modelHealth = {};

const { parseAIJSON } = require('./json_helper');

// Helper: Clean & Parse JSON (NOW USES ROBUST HELPER)
function cleanAndParseJSON(text, context = "Script") {
    if (!text) return null;

    // First, restore our unique tags to avoid them being stripped by JSON cleaning if they are outside JSON
    // but in script.js context, they are usually inside strings.

    const results = parseAIJSON(text, context);
    if (!results || results.length === 0) {
        // Fallback for simple single-object responses if parseAIJSON (which favors arrays) returns empty
        try {
            let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            clean = clean.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");
            return JSON.parse(clean);
        } catch (e) {
            return null;
        }
    }

    // Most script calls expect a single object or an array. 
    // parseAIJSON returns an array.
    return results.length === 1 ? results[0] : results;
}

function restoreSSMLBreaks(obj) {
    if (!obj) return obj;
    const restoreInString = (str) => {
        if (typeof str !== 'string') return str;
        return str.replace(/\[\[BREAK_([0-9.]+)S\]\]/g, '<break time="$1s" />');
    };
    if (typeof obj === 'string') return restoreInString(obj);
    if (Array.isArray(obj)) return obj.map(item => restoreSSMLBreaks(item));
    if (typeof obj === 'object') {
        const result = {};
        for (const key in obj) result[key] = restoreSSMLBreaks(obj[key]);
        return result;
    }
    return obj;
}

function parseAIResponse(text) {
    const parsed = cleanAndParseJSON(text);
    return restoreSSMLBreaks(parsed);
}

async function executeGeminiCall(instruction, preferredModel = 'gemma-3-27b-it', chapterId = null) {
    return await keyManager.executeWithRetry(async (apiKey) => {
        const genAI = new GoogleGenerativeAI(apiKey);

        // Prioritize Gemma 3 models as requested by user
        const PRIORITIZED_MODELS = ['gemma-3-27b-it', 'gemma-3-12b-it', 'gemini-3-flash-preview', 'gemini-2.5-flash'];

        let models = [preferredModel, ...PRIORITIZED_MODELS];
        models = [...new Set(models)]; // Unique

        let lastErr = new Error("All prioritized models are currently exhausted or failed.");
        for (const m of models) {
            // SKIP EXHAUSTED MODELS
            if (global.modelHealth[m] === 'EXHAUSTED') continue;

            try {
                const model = genAI.getGenerativeModel({ model: m, apiVersion: 'v1beta' });
                const res = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: instruction }] }],
                    generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
                });
                const text = res.response.text();

                // If it works, it's LIVE
                global.modelHealth[m] = 'LIVE';
                const chapterPrefix = chapterId ? `[Ch ${chapterId}] ` : "";
                console.log(`   💡 ${chapterPrefix}[AI Response] ${text.split(/\s+/).length} words from ${m}`);
                return text;
            } catch (e) {
                const msg = e.message || "";
                if (msg.includes("429") || msg.includes("Quota")) {
                    console.warn(`   🛑 Model ${m} exhausted (429). Skipping.`);
                    global.modelHealth[m] = 'EXHAUSTED';
                } else {
                    console.warn(`   ⚠️ Model ${m} failed: ${msg.substring(0, 80)}`);
                }
                lastErr = e;
            }
        }
        throw lastErr;
    });
}

// Step 1: Generate Outline
async function generateOutline(contextData, totalChapters, wordsPerChapter, targetLanguage = 'English') {
    const prompt = `
    Role: Senior Content Architect for Documentary Scripts (SHU Methodology).
    Task: Create a detailed MODULE-BASED outline for a YouTube documentary.
    
    Context:
    - Topic: ${contextData.coreKeyword}
    - Target Language: ${targetLanguage} (YOU MUST WRITE EVERYTHING IN THIS LANGUAGE)
    - Total Modules to generate: ${totalChapters} (STRICT LIMIT)
    - Requirement: ${contextData.requirements}
    ${contextData.manualScript ? `- SOURCE MATERIAL (REWRITE THIS): ${contextData.manualScript}` : ''}
    
    STRUCTURE DESIGN: 
    - If 1 module: Full story.
    - If 2-3 modules: Intro -> Body -> CTA.
    - If 4+ modules: HOOK -> Background -> Discovery -> Evidence -> Body(multiple) -> Peak -> CTA.
    
    IMPORTANT: You MUST generate EXACTLY ${totalChapters} modules. No more, no less.
    ${contextData.manualScript ? 'Divide the PROVIDED SOURCE MATERIAL into ' + totalChapters + ' sequential logical modules.' : ''}
    Return JSON ARRAY: [{ "module_id": 1, "title": "...", "key_points": "...", "module_type": "..." }]
    `;

    return await keyManager.executeWithRetry(async (apiKey) => {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemma-3-27b-it', apiVersion: 'v1beta' });
        const result = await model.generateContent(prompt);
        const text = result.response.text();

        let items = parseAIResponse(text);
        if (!Array.isArray(items)) {
            items = items.modules || items.chapters || items.outline || items.modules_list || items.modules_array || [];
        }

        return items.map((item, idx) => ({
            chapter_id: item.module_id || (idx + 1),
            title: item.title || `Module ${idx + 1}`,
            key_points: item.key_points || "",
            module_type: item.module_type || "BODY"
        }));
    });
}

// Step 2: 2-Pass Generation Engine
async function generateChapterContent(chapter, contextData, formattingRules, modelName = 'gemma-3-27b-it', wordsPerChapter, targetLanguage = 'English') {
    const { myKeywords } = contextData;

    // PASS 1: Content Writing (The "Brain")
    const scriptInstruction = `
    VAI TRÒ: Documentary Scriptwriter. GIỌNG ĐIỆU: Nghiêm túc, điều tra, trung lập.
    NHIỆM VỤ: Viết nội dung cho chương "${chapter.title}" (${chapter.module_type || 'BODY'}). 
    NGÔN NGỮ: ${targetLanguage} (BẮT BUỘC).
    SEO: ${contextData.coreKeyword}. LENGTH: ${wordsPerChapter} words. KEY POINTS: ${chapter.key_points}
    STYLE: ${formattingRules.stylePrompt || 'Cinematic documentary'}
    
    QUY TẮC CỐT LÕI:
    - KHÔNG dùng định dạng Markdown (Không **bold**, không ###, không gạch đầu dòng).
    - KHÔNG chào hỏi, không kết bài thừa. 
    - VIẾT DƯỚI DẠNG VĂN XUÔI LIÊN TỤC ĐỂ ĐỌC THOẠI.
    
    QUY TẮC TỪ KHÓA:
    - Sử dụng các từ khóa sau: ${myKeywords}
    `;

    const scriptContent = await executeGeminiCall(scriptInstruction, modelName, chapter.chapter_id);

    // PASS 2: Visual Prompt Generation (The "Eye")
    const visualInstruction = `
    VAI TRÒ: Cinematic Visual Director.
    NHIỆM VỤ: Dựa vào đoạn kịch bản sau, hãy tạo một Visual Prompt cực kỳ chi tiết.
    
    KỊCH BẢN:
    "${scriptContent}"
    
    QUY TẮC THIẾT KẾ (Profile Rules):
    ${formattingRules.imageRules || "Mega-dense cinematic prose, high realism."}
    
    QUY TẮC CHUYỂN ĐỘNG (Video):
    ${formattingRules.videoRules || "Slow cinematic motion."}

    STYLE: ${formattingRules.stylePrompt || "Realistic"}
    
    OUTPUT FORMAT (JSON):
    {
       "visual_prompt": {
          "logic_specs": { "subject": "...", "camera": "...", "lighting": "...", "physics": "...", "composition": "..." },
          "artistic_prose": "...",
          "technical": "--ar 16:9"
       },
       "cliffhanger_note": "..."
    }
    `;

    const visualRaw = await executeGeminiCall(visualInstruction, modelName, chapter.chapter_id);
    let visualJson = parseAIResponse(visualRaw);

    if (!visualJson || typeof visualJson !== 'object') {
        visualJson = { visual_prompt: { artistic_prose: visualRaw } };
    } else if (!visualJson.visual_prompt) {
        visualJson = { visual_prompt: visualJson };
    }

    const scriptClean = cleanTextForTTS(scriptContent);

    // Prepare visual prompt for display/storage
    let visualPromptValue = visualJson.visual_prompt || {};
    if (typeof visualPromptValue === 'object' && visualPromptValue.logic_specs) {
        const specs = visualPromptValue.logic_specs;
        visualPromptValue = "[TECHNICAL SPECS]\n" +
            `- Subject: ${specs.subject || 'N/A'}\n` +
            `- Composition: ${specs.composition || 'N/A'}\n` +
            `- Camera: ${specs.camera || 'N/A'}\n` +
            `- Lighting: ${specs.lighting || 'N/A'}\n` +
            `- Physics: ${specs.physics || 'N/A'}\n\n` +
            `[ARTISTIC PROSE]\n${visualPromptValue.artistic_prose || 'N/A'}\n\n` +
            `${visualPromptValue.technical || '--ar 16:9'}`;
    }

    return {
        chapter_id: chapter.chapter_id,
        title: chapter.title,
        content_for_tts: scriptClean,
        visual_prompt: visualPromptValue,
        video_prompt: String(visualJson.visual_prompt?.video_specs || visualJson.visual_prompt?.video_prompt || "").replace(/\n/g, ' ').trim(),
        cliffhanger_note: visualJson.cliffhanger_note || "",
        word_count: scriptClean.split(/\s+/).length
    };
}

/**
 * SHU Integration: Generate ONLY visual prompts for pre-written content
 */
async function generateVisualPromptsOnly(chapter, content, formattingRules, modelName = 'gemma-3-27b-it') {
    const visualInstruction = `
    VAI TRÒ: Cinematic Visual Director.
    NHIỆM VỤ: Dựa vào đoạn kịch bản sau, hãy tạo một Visual Prompt cực kỳ chi tiết.
    
    KỊCH BẢN:
    "${content}"
    
    QUY TẮC THIẾT KẾ (Profile Rules):
    ${formattingRules.imageRules || "Create a cinematic shot with high density and realism."}
    
    QUY TẮC CHUYỂN ĐỘNG (Motion Rules):
    ${formattingRules.videoRules || "Subtle cinematic camera movement."}

    STYLE PHONG CÁCH: ${formattingRules.stylePrompt || "Realistic"}
    
    OUTPUT FORMAT (JSON):
    {
       "visual_prompt": {
          "logic_specs": { "subject": "...", "camera": "...", "lighting": "...", "physics": "...", "composition": "..." },
          "artistic_prose": "Mô tả chi tiết 300 từ nghệ thuật về bối cảnh, ánh sáng, vật liệu...",
          "technical": "--ar 16:9"
       },
       "cliffhanger_note": "Ghi chú nối cảnh"
    }
    `;

    const visualRaw = await executeGeminiCall(visualInstruction, modelName, chapter.chapter_id || 1);
    let visualJson = parseAIResponse(visualRaw);

    if (!visualJson || typeof visualJson !== 'object') {
        visualJson = { visual_prompt: { artistic_prose: visualRaw } };
    }

    let visualPromptValue = cleanVisualPrompt(visualJson.visual_prompt || {}, formattingRules.negativePrompt, formattingRules.stylePrompt);

    return {
        chapter_id: chapter.chapter_id || 1,
        title: chapter.title || "Module",
        content_for_tts: cleanTextForTTS(content),
        visual_prompt: visualPromptValue,
        video_prompt: String(visualJson.visual_prompt?.video_specs || visualJson.visual_prompt?.video_prompt || "").replace(/\n/g, ' ').trim(),
        cliffhanger_note: visualJson.cliffhanger_note || "",
        word_count: content.split(/\s+/).length
    };
}


function cleanTextForTTS(text) {
    if (!text) return "";
    let clean = text;

    // 1. Loại bỏ Bold (**text** -> text)
    clean = clean.replace(/\*{2,3}(.*?)\*{2,3}/g, '$1');

    // 2. Loại bỏ các ký tự dấu sao rác
    clean = clean.replace(/\*/g, '');

    // 3. Loại bỏ ký tự hashtags (#) nếu không phải là #1, #2...
    clean = clean.replace(/#(?!\d)/g, '');

    // 4. Loại bỏ Markdown headers (###, ##, #)
    clean = clean.replace(/^#+\s/gm, '');

    // 5. Loại bỏ chuỗi % rác (%%% -> %) nhưng giữ 5%
    clean = clean.replace(/%{2,}/g, '%');

    // 6. Loại bỏ nội dung trong ngoặc đơn (Narrator cues)
    clean = clean.replace(/\(.*?\)/g, '');

    // 7. Loại bỏ các dòng trống dư thừa
    clean = clean.replace(/\n{3,}/g, '\n\n');

    return clean.trim();
}

function cleanVisualPrompt(visualObj, negativePrompt = "", stylePrompt = "") {
    if (!visualObj) return "";
    let lines = [];
    if (typeof visualObj === 'object' && Object.keys(visualObj).length > 0) {
        // 1. Logic Specs (Technical Foundation)
        const logic = visualObj.logic_specs || visualObj.image || visualObj;
        if (logic && typeof logic === 'object') {
            lines.push("### VISUAL LOGIC SPECS:");
            Object.entries(logic).forEach(([k, v]) => {
                if (!['artistic_prose', 'video_specs', 'video', 'ar', 'cliffhanger_note'].includes(k)) {
                    lines.push(`- ${k.toUpperCase()}: ${v} `);
                }
            });
            lines.push("");
        }

        // 2. Artistic Prose (The Heart of the Prompt)
        if (visualObj.artistic_prose) {
            lines.push("### ARTISTIC PROSE (300 WORDS DENSE):");
            lines.push(visualObj.artistic_prose);
            lines.push("");
        }

        // 3. Video Specs (Motion Logic)
        const vids = visualObj.video_specs || visualObj.video;
        if (vids && typeof vids === 'object') {
            lines.push("### MOTION SPECS:");
            Object.entries(vids).forEach(([k, v]) => lines.push(`- ${k.toUpperCase()}: ${v} `));
            lines.push("");
        }

        // 4. Style & Tech suffix
        let suffix = `--ar ${visualObj.ar || "16:9"} `;
        if (stylePrompt) suffix += ` --style ${stylePrompt} `;
        if (negativePrompt) suffix += ` --no ${negativePrompt} `;
        lines.push(suffix);

    } else { lines.push(String(visualObj)); }

    return lines.join('\n').trim();
}

async function generateScript(req, res) {
    const { analysisData, keywords, requirements, duration, modelName, profileId, projectId, projectName, targetLanguage } = req.body;

    if (!profileId || profileId === 'null') return res.json({ success: false, error: 'Vui lòng chọn Kênh (Profile) trước khi tạo Script!' });
    if (!projectId || projectId === 'null') return res.json({ success: false, error: 'Vui lòng chọn hoặc tạo Dự án (Project) trước khi tạo Script!' });
    let targetWords = parseInt(req.body.word_count) || (parseInt(duration) || 0) * WORDS_PER_MINUTE || 3000;
    const finalLang = targetLanguage || 'English';

    try {
        const profileData = await getProfileData(profileId);
        const formattingRules = {
            imageRules: profileData.visual_settings?.image_rules || "",
            videoRules: profileData.visual_settings?.video_rules || "",
            negativePrompt: profileData.visual_settings?.negative_prompt || "",
            stylePrompt: profileData.visual_settings?.style_prompt || ""
        };

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const safeProjectName = (projectName || analysisData?.coreKeyword || "Project").replace(/[<>:"/\\|?*]/g, '_').trim();

        let projectDir = req.body.output_dir;
        if (!projectDir) {
            projectDir = path.join(__dirname, '../../output_files', `${safeProjectName}_${timestamp} `);
        }

        if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

        log.info(`📁[Project] Project Dir: ${projectDir} `);

        const totalChapters = Math.ceil(targetWords / 600);
        const wordsPerChapter = Math.ceil(targetWords / totalChapters);

        let myKeywords = keywords || "";
        if (projectId && analysisData) {
            const shu = await keywordEngine.processKeywords(projectId, analysisData, keywords);
            myKeywords = shu.core + ", " + shu.support.join(", ");
        }

        const context = {
            coreKeyword: analysisData?.coreKeyword || "Topic",
            requirements,
            myKeywords,
            manualScript: req.body.manualScript // Use the raw manual script if provided
        };

        let chapters = [];
        const shuModules = analysisData?.modules_data || (analysisData?.step5_result?.modules_data) || [];

        if (shuModules.length > 0) {
            log.info(`🌪️ [SHU Flow] Detected ${shuModules.length} SHU modules. Using pre-written content.`);
            chapters = await Promise.all(shuModules.map(m =>
                generateVisualPromptsOnly({ chapter_id: m.module_index, title: m.role || m.title }, m.content, formattingRules, modelName)
            ));
        } else {
            log.info(`📜 [Standard Flow] No SHU modules found. Generating from outline.`);
            const outline = await generateOutline(context, totalChapters, wordsPerChapter, finalLang);
            if (projectId) {
                for (const m of outline) {
                    await db.db.run('INSERT INTO modules (project_id, module_index, module_type, word_target, title, key_points) VALUES (?, ?, ?, ?, ?, ?)', [projectId, m.chapter_id, m.module_type, wordsPerChapter, m.title, m.key_points]);
                }
            }
            chapters = await Promise.all(outline.map(ch => generateChapterContent(ch, context, formattingRules, modelName, wordsPerChapter, finalLang)));
        }

        chapters.sort((a, b) => a.chapter_id - b.chapter_id);

        let fullScriptText = "";
        let totalActualWords = 0;

        const ttsTextPath = path.join(projectDir, 'voice_clean_text.txt');
        const promptsPath = path.join(projectDir, 'visual_prompts_debug.txt');

        let ttsFileContent = "";
        let promptFileContent = "";

        if (projectId) {
            for (const ch of chapters) {
                const mod = await db.db.get('SELECT id FROM modules WHERE project_id = ? AND module_index = ?', [projectId, ch.chapter_id]);
                if (mod) await db.db.run('INSERT OR REPLACE INTO module_scripts (module_id, content_text, cliff_text) VALUES (?, ?, ?)', [mod.id, ch.content_for_tts, ch.cliffhanger_note]);
                fullScriptText += `\n[MODULE ${ch.chapter_id}]\n${ch.content_for_tts} \n`;
                totalActualWords += ch.word_count;
                ttsFileContent += `\n-- - CHAPTER ${ch.chapter_id} ---\n${ch.content_for_tts} \n`;
                promptFileContent += `\n-- - PROMPTS CHAPTER ${ch.chapter_id} ---\n${JSON.stringify(ch.visual_prompt, null, 2)} \n`;
            }
            await db.db.run('INSERT OR REPLACE INTO script_finals (project_id, full_script_text, version) VALUES (?, ?, ?)', [projectId, fullScriptText, '1.0']);
        } else {
            for (const ch of chapters) {
                fullScriptText += `\n[MODULE ${ch.chapter_id}]\n${ch.content_for_tts} \n`;
                totalActualWords += ch.word_count;
                ttsFileContent += `\n-- - CHAPTER ${ch.chapter_id} ---\n${ch.content_for_tts} \n`;
            }
        }

        fs.writeFileSync(ttsTextPath, ttsFileContent, 'utf-8');
        fs.writeFileSync(promptsPath, promptFileContent, 'utf-8');

        res.json({
            success: true,
            data: {
                chapters,
                full_script: fullScriptText,
                actual_words: totalActualWords,
                target_words: targetWords,
                total_chapters: chapters.length,
                project_dir: projectDir,
                metadata: { projectId, projectName: safeProjectName }
            }
        });
    } catch (err) {
        console.error(err);
        res.json({ success: false, error: err ? err.message : "Unknown error in script generation" });
    }
}

module.exports = { generateOutline, generateChapterContent, generateScript, executeGeminiCall, cleanVisualPrompt, parseAIResponse };
