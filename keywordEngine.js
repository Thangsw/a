const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const db = require('./database');
const { log } = require('./colors');
const profiles = require('./profiles');
const { parseAIJSON } = require('./json_helper');
const nicheManager = require('./nicheManager');

/**
 * Normalizes keyword for better comparison (lowercase + remove trailing s)
 */
function normalizeKeyword(k) {
    if (!k) return "";
    return k.toLowerCase().trim().replace(/s$/, '');
}

/**
 * Keyword Engine SHU 1.5 - Bước 2
 */
async function processKeywords(projectId, analyzedData, profileId, feedback = null, niche = 'self_help', targetLanguage = 'English') {
    log.info(`🔑 [SHU Bước 2] Đang xử lý từ khóa cho Dự án: ${projectId} (Ngách: ${niche})${feedback ? " (Đang tinh chỉnh dựa trên phản hồi)" : ""}`);

    const profile = profiles.getProfileData(profileId);
    const userPool = profile?.keywords_core || [];
    const nicheName = profile?.name || "General";

    const repeated = (analyzedData.repeated_phrases || []).map(p => normalizeKeyword(p));
    const pool = userPool.map(p => normalizeKeyword(p));

    let coreKeyword = "";
    const common = (analyzedData.repeated_phrases || [])
        .filter(p => pool.includes(normalizeKeyword(p)))
        .sort((a, b) => a.length - b.length);

    if (common.length > 0) {
        coreKeyword = common[0];
    } else if (userPool.length > 0) {
        coreKeyword = userPool.sort((a, b) => a.length - b.length)[0];
    } else {
        coreKeyword = (analyzedData.repeated_phrases && analyzedData.repeated_phrases[0]) || "documentary";
    }

    log.info(`🎯 [B2.2] Đã chọn Từ khóa chính: "${coreKeyword}" (Dựa trên quy tắc)`);

    const nicheConfig = nicheManager.getNicheConfig(niche);
    const isDE = nicheConfig.market === 'DE' || (targetLanguage === 'German');

    const semanticPrompt = `
You are an SEO semantic expansion assistant specializing in ${niche} content.
TASK: ${feedback ? "REFINE the following supporting keywords based on feedback." : `Generate semantically related supporting keywords for a YouTube ${niche} video.`}
RULES:
- Do NOT select a main keyword
- Keywords should be ${nicheConfig.keyword_discipline === 'strict' ? 'informational or investigative' : 'reflective, emotional, or concept-based'}
- Style: ${isDE ? 'Minimalist, direct, logical' : 'Engaging, emotional, descriptive'}
- Language: ${targetLanguage} ONLY. (IMPORTANT: Translate to ${targetLanguage} if necessary)
- Each keyword should be 2–5 words
CORE KEYWORD: ${coreKeyword}
CONTEXT: ${nicheName} ${niche} content, tone: ${Array.isArray(nicheConfig.tone) ? nicheConfig.tone.join(", ") : nicheConfig.tone}, dominant trigger: ${analyzedData.dominant_trigger}
OUTPUT: Return a JSON array of ${isDE ? '3-5' : '6-10'} supporting keywords only.
`;

    const ctrPrompt = `
You are a YouTube CTR phrase generator.
TASK: Generate short emotional phrases for thumbnails and titles.
RULES:
- ${isDE ? '1–3 words per phrase. MINIMALIST. No superlatives. No exclamation marks.' : '2–4 words per phrase. Emotional hooks encouraged.'}
- Language: ${isDE ? 'German (Deutsch) ONLY' : 'English ONLY'}
- Format: ALL CAPS
- Match the dominant emotional trigger: ${analyzedData.dominant_trigger}
OUTPUT: Return 5 phrases as a JSON array.
`;

    try {
        const [semanticRes, ctrRes] = await Promise.all([
            executeAI(projectId, semanticPrompt, 'SEMANTIC_KEYWORDS'),
            executeAI(projectId, ctrPrompt, 'CTR_PHRASES')
        ]);

        let supportKeywords = semanticRes || [];
        const GENERIC_EXCLUDES = ["space", "universe", "galaxy"];
        const maxSupportKw = (niche === 'self_help') ? 5 : 8;
        supportKeywords = [...new Set(supportKeywords)]
            .filter(k => {
                const normalized = normalizeKeyword(k);
                const isGeneric = GENERIC_EXCLUDES.includes(normalized);
                const isTooShort = k.trim().split(/\s+/).length < 2;
                return normalized !== normalizeKeyword(coreKeyword) && !isGeneric && !isTooShort;
            })
            .slice(0, maxSupportKw);

        const keywordMap = {
            core_keyword: { use: ["title", "description", "voice_hook", "recap"], max_usage: 3 },
            supporting_keywords: { use: ["body_modules"], max_usage_per_keyword: 1 },
            ctr_phrases: { use: ["thumbnail_text", "title_variant"], max_usage: 1 }
        };

        const finalOutput = {
            core_keyword: coreKeyword,
            supporting_keywords: supportKeywords,
            ctr_phrases: ctrRes || [],
            keyword_map: keywordMap
        };

        if (!coreKeyword) throw new Error("Missing core keyword");
        const minSupportKw = isDE ? 3 : 5;
        if (supportKeywords.length < minSupportKw) {
            throw new Error(`Semantic cluster too weak for ${niche} (Count: ${supportKeywords.length}).`);
        }

        await db.db.run(
            'UPDATE projects SET analysis_result = ? WHERE id = ?',
            [JSON.stringify({ ...analyzedData, ...finalOutput }), projectId]
        );

        log.success(`✅ Bước 2 Hoàn tất cho Dự án: ${projectId}`);
        return finalOutput;

    } catch (err) {
        log.error(`❌ Lỗi Keyword Engine: ${err.message}`);
        throw err;
    }
}

async function executeAI(projectId, prompt, actionName) {
    const MODEL_PRIORITY = ['gemma-3-27b-it', 'gemma-3-12b-it', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
    let lastError = null;

    for (const modelName of MODEL_PRIORITY) {
        try {
            return await keyManager.executeWithRetry(async (apiKey) => {
                const genAI = new GoogleGenerativeAI(apiKey);
                log.info(`🤖 Đang xử lý từ khóa [Model: ${modelName}] bằng một API Key khả dụng...`);
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    apiVersion: 'v1beta',
                    generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
                });

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                const json = parseAIJSON(text, actionName);

                if (json) {
                    if (projectId) {
                        const tokens = response.usageMetadata ? response.usageMetadata.totalTokenCount : 0;
                        await db.logAIAction(projectId, actionName, modelName, tokens, text);
                    }
                    return json;
                }
                throw new Error("Phản hồi AI không hợp lệ");
            });
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

module.exports = { processKeywords };
