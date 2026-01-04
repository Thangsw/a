const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const db = require('./database');
const { log } = require('./colors');
const { parseAIJSON } = require('./json_helper');
const pLimit = require('p-limit');
const exportEngine = require('./exportEngine');
const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * SHU Step 4: Script Generation Engine
 */

async function processAllModules(projectId, fullData, niche = 'dark_psychology_de', targetLanguage = 'English', outputDir = 'output') {
    const modulePlan = fullData.module_plan || [];
    if (modulePlan.length === 0) {
        throw new Error("Không tìm thấy kế hoạch module để viết kịch bản.");
    }

    const coreKeyword = fullData.core_keyword;
    const supportingKeywords = fullData.supporting_keywords || [];

    const existingModules = fullData.modules || [];
    const offset = existingModules.length;
    const limit = pLimit(4); // User requested 4 slots for 1 arc
    const projectSummary = fullData.summary || "A detailed documentary about " + coreKeyword;

    log.info(`✍️ [SHU Bước 4] Bắt đầu viết kịch bản cho ${modulePlan.length} modules song song (4 luồng)...`);

    const modulePromises = modulePlan.map((module) => limit(async () => {
        try {
            const adjustedIndex = offset + module.index;
            const moduleScript = await generateModule(projectId, { ...module, index: adjustedIndex }, coreKeyword, supportingKeywords, projectSummary, niche, targetLanguage, outputDir);
            return {
                ...module,
                module_index: adjustedIndex, // Quan trọng cho Assembler
                content: moduleScript, // Dùng 'content' thay vì 'script' để khớp Assembler.js
                status: 'completed'
            };
        } catch (err) {
            log.error(`❌ Lỗi viết module ${module.index}: ${err.message}`);
            return null;
        }
    }));

    const results = (await Promise.all(modulePromises)).filter(r => r !== null);

    return {
        modules: [...existingModules, ...results],
        status: "script_generated"
    };
}

async function generateModule(projectId, module, coreKeyword, supportingKeywords, summary, niche, targetLanguage, outputDir) {
    const wordTarget = module.word_target || 400;
    const minWords = Math.floor(wordTarget * 0.9);

    const prompt = `
You are a senior psychological analyst writing a DEEP NARRATION script. 

[SINGULAR FOCUS]: You are writing ONLY for Module ${module.index}: ${module.role}.
The goal is: ${module.goal}

[STRICT RULES]:
1. DO NOT mention other modules (no "Module 4", no "Next part").
2. DO NOT summarize the project. Jump directly into the narration.
3. [LENGTH REQUIREMENT]: This specific section must be at least ${minWords} words. Expand every thought with surgical detail.
4. TONE: Cold, authoritative, analytical (Style: Mr No Plan A).

[CONTEXT]:
- Core Subject: ${coreKeyword}
- Key Themes: ${supportingKeywords.join(", ")}
- Brief Context: ${summary}

[WRITING STYLE]: 
- Use complex, declarative German/Language ${targetLanguage}.
- Focus on the "HOW" and "WHY" of human manipulation.
- Provide clinical examples and architectural metaphors.

OUTPUT THE NARRATION SCRIPT ONLY. NO HEADERS. NO MODULE LABELS. 
`;

    return await executeAIScript(projectId, prompt, module.index, outputDir);
}

async function executeAIScript(projectId, prompt, moduleIndex, outputDir) {
    // UPDATED MODEL PRIORITY: No 1.5, No 2.0
    const MODEL_PRIORITY = ['gemini-3-flash-preview', 'gemma-3-27b-it', 'gemini-2.5-flash'];
    let lastError = null;

    for (const modelName of MODEL_PRIORITY) {
        try {
            return await keyManager.executeWithRetry(async (apiKey, proxy) => {
                const proxyUrl = keyManager.formatProxyUrl(proxy);
                const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    apiVersion: 'v1beta',
                    generationConfig: { maxOutputTokens: 8192, temperature: 0.8 }
                }, {
                    httpOptions: agent ? { agent } : undefined
                });

                const result = await model.generateContent(prompt);
                const text = result.response.text();

                // Save RAW for debugging
                await exportEngine.saveRawResponse(projectId, `Module_${moduleIndex}_${modelName}`, {
                    model: modelName,
                    raw_text: text,
                    prompt: prompt
                }, outputDir);

                if (projectId) {
                    const tokens = result.response.usageMetadata ? result.response.usageMetadata.totalTokenCount : 0;
                    await db.logAIAction(projectId, 'MODULE_GEN', modelName, tokens, text);
                }

                return text.trim();
            });
        } catch (err) {
            lastError = err;
            continue;
        }
    }
    throw lastError;
}

module.exports = { processAllModules };
