const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const db = require('./database');
const { log } = require('./colors');
const { parseAIJSON } = require('./json_helper');
const nicheManager = require('./nicheManager');
const exportEngine = require('./exportEngine');
const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * SHU Step 3.5: Checkpoint Engine (Content Director)
 */

async function evaluatePlan(projectId, fullData, niche = 'self_help', outputDir = 'output', targetWords = 5000, contentMode = 'SHU') {
    log.info(`🔒 [Checkpoint] Mode: ${contentMode} | Dự án: ${projectId}`);

    if (contentMode === 'COMPILATION') {
        log.success(`✅ [Checkpoint] COMPILATION Mode: Auto-approving assembly plan.`);
        return { ready: true, recommendation: "proceed", issues: [], feedback: "Mega compilation doesn't require module-level validation." };
    }

    const nicheProfile = nicheManager.getProfile(niche);
    const isLegoMicro = contentMode === 'LEGO_MICRO';

    // HARD RULES CHECK (Pre-AI)
    if (isLegoMicro) {
        const modules = fullData.module_plan || [];
        const totalWords = modules.reduce((sum, m) => sum + m.word_target, 0);

        if (modules.length !== 4) {
            return { ready: false, recommendation: "replan_modules", issues: [`LEGO_MICRO must have exactly 4 modules (Got: ${modules.length})`] };
        }
        if (modules[0].role !== 'HOOK_THREAT') {
            return { ready: false, recommendation: "replan_modules", issues: ["First module must be HOOK_THREAT"] };
        }
        if (totalWords > 2500) {
            return { ready: false, recommendation: "replan_modules", issues: [`Total words (${totalWords}) exceed LEGO_MICRO safety limit (2500)`] };
        }
    }

    const prompt = `
You are a senior ${nicheProfile.writer_role} content director.

TASK:
Evaluate whether the following plan (Keywords + Module Structure) is ready for ${isLegoMicro ? 'MICRO-VIDEO' : 'full ' + niche + ' video'} generation.

INPUT DATA:
- Content Mode: ${contentMode}
- Hook Score: ${fullData.hook_score}
- Niche Strategy: ${niche}
- Core Keyword: ${fullData.core_keyword}
- Module Plan: ${JSON.stringify(fullData.module_plan)}

${isLegoMicro ? `
STRICT LEGO_MICRO CRITERIA:
1. Exact 4 modules? (Mandatory)
2. Is Module 1 a sharp HOOK_THREAT?
3. Does it cover exactly ONE psychological mechanism?
4. Is it standalone (no "part 2" vibes)?
` : `
SHU_LONG CRITERIA:
1. Narrative flow and tension progression.
2. Keyword integration.
3. Retention potential.
`}

OUTPUT FORMAT (JSON ONLY):
{
  "ready": true,
  "recommendation": "proceed", 
  "issues": [],
  "feedback": "..."
}
`;

    try {
        const evaluation = await executeAICheckpoint(projectId, prompt, outputDir);

        if (!evaluation) {
            return { ready: false, recommendation: "replan_modules", issues: ["Empty AI response"], feedback: "Retry needed." };
        }

        if (evaluation.ready) {
            log.success(`✅ [Checkpoint] Kế hoạch ĐÃ ĐƯỢC PHÊ DUYỆT.`);
        } else {
            log.warn(`⚠️ [Checkpoint] BỊ TỪ CHỐI: ${evaluation.issues?.join(", ")}`);
        }

        return evaluation;

    } catch (err) {
        log.error(`❌ Lỗi Checkpoint Engine: ${err.message}`);
        throw err;
    }
}

async function executeAICheckpoint(projectId, prompt, outputDir) {
    // UPDATED MODEL PRIORITY: No 1.5, No 2.0
    const MODEL_PRIORITY = ['gemini-3-flash-preview', 'gemma-3-27b-it'];
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
                    generationConfig: { maxOutputTokens: 2048, temperature: 0.3 }
                }, {
                    httpOptions: agent ? { agent } : undefined
                });

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();

                await exportEngine.saveRawResponse(projectId, `Checkpoint_${modelName}`, {
                    model: modelName,
                    raw_text: text,
                    prompt_sent: prompt
                }, outputDir);

                const rawJson = parseAIJSON(text, "CHECKPOINT_EVAL");
                if (rawJson) {
                    const json = Array.isArray(rawJson) ? rawJson[0] : rawJson;
                    if (projectId) {
                        const tokens = response.usageMetadata ? response.usageMetadata.totalTokenCount : 0;
                        await db.logAIAction(projectId, 'CHECKPOINT_EVAL', modelName, tokens, text);
                    }
                    return json;
                }
                throw new Error("Invalid response format");
            });
        } catch (err) {
            lastError = err;
            continue;
        }
    }
    throw lastError;
}

module.exports = { evaluatePlan };
