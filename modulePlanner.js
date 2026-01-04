const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const db = require('./database');
const { log } = require('./colors');
const { parseAIJSON } = require('./json_helper');
const nicheManager = require('./nicheManager');
const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * SHU Step 3: Module Planning Engine
 */

async function planModules(projectId, analyzedData, feedback = null, niche = 'dark_psychology_de', targetWords = null, contentMode = 'SHU') {
    const nicheProfile = nicheManager.getProfile(niche);
    const isLegoMicro = contentMode === 'LEGO_MICRO';

    // DYNAMIC CONFIG (Auto-distribute targetWords)
    let moduleCount = isLegoMicro ? 4 : 8;
    let baseTarget = targetWords || nicheProfile.pipeline_settings?.target_words_per_block || (isLegoMicro ? 1500 : 4000);

    // Distribution logic (Professional Arc Ratios)
    let wordPerModule = [];
    if (isLegoMicro) {
        // [20%, 30%, 30%, 20%]
        wordPerModule = [
            Math.floor(baseTarget * 0.20),
            Math.floor(baseTarget * 0.30),
            Math.floor(baseTarget * 0.30),
            Math.floor(baseTarget * 0.20)
        ];
    } else {
        // Equal distribution for long SHU
        const avg = Math.floor(baseTarget / 8);
        wordPerModule = new Array(8).fill(avg);
    }

    log.info(`🧠 [SHU Bước 3] Mode: ${contentMode} | Dự án: ${projectId} (Ngách: ${niche}) | Module Count: ${moduleCount}`);

    const validRoles = nicheManager.getRoles(niche);

    const prompt = `
You are a senior YouTube editor specializing in ${nicheProfile.writer_role}.

TASK:
Plan exactly ${moduleCount} modules for a ${isLegoMicro ? 'MICRO-VIDEO (12-15 min standalone)' : 'long-form YouTube'} ${niche} video.

${isLegoMicro ? `
STRICT RULES FOR LEGO_MICRO (4 MODULES):
1. Module 1: Role 'HOOK_THREAT' (Short, sharp, intense)
2. Module 2: Role 'MECHANISM_EXPOSED' (Explain exactly ONE mechanism)
3. Module 3: Role 'BOUNDARY_DEFINITION' (GOAL: POWER_IMBALANCE + BOUNDARY_DEFINITION - Who benefits & boundaries)
4. Module 4: Role 'OPEN_LOOP' (GOAL: COLD_RESOLUTION + OPEN_LOOP - How to fix & expansion)
` : `
RULES FOR SHU_LONG (8 MODULES):
- First module must be HOOK_THREAT.
- Single-Peak approach (Climax at peak role).
- Final module must be OPEN_LOOP.
`}

RULES:
- Exact module count: ${moduleCount}
- Module index MUST start at 1 and be sequential.
- Output ONLY JSON.

AVAILABLE MODULE ROLES:
${validRoles.join("\n")}

OUTPUT FORMAT(JSON ONLY):
[
    {
        "index": 1,
        "role": "...",
        "goal": "..."
    }
]
`;

    let attempts = 0;
    while (attempts < 3) {
        attempts++;
        try {
            const aiPlan = await executeAIPlanner(projectId, prompt);

            if (!Array.isArray(aiPlan) || aiPlan.length !== moduleCount) {
                throw new Error(`AI failed to return exactly ${moduleCount} modules(Got: ${aiPlan?.length})`);
            }

            // Enrichment with HARDCODED word targets
            const enrichedModules = aiPlan.map((m, i) => {
                const roleProps = nicheManager.getRoleProperty(m.role);
                const word_target = wordPerModule[i] || (isLegoMicro ? 350 : 500);

                return {
                    ...m,
                    word_target,
                    allowed_keyword_type: (nicheProfile.keyword_discipline === "loose") ? [] : ["core", "support"],
                    intensity: roleProps?.intensity || "medium",
                    status: "planned"
                };
            });

            validateModulePlan(enrichedModules, niche, contentMode);

            const totalWords = enrichedModules.reduce((sum, m) => sum + m.word_target, 0);

            await db.saveModulePlan(projectId, {
                modules: enrichedModules,
                version: "v2.0_hardcoded",
                hook_score: analyzedData.hook_score,
                total_word_estimate: totalWords
            });

            const finalResult = {
                module_plan: enrichedModules,
                total_word_estimate: totalWords,
                status: "ready_for_module_generation"
            };

            log.success(`✅ Bước 3 Hoàn tất: Đã chốt ${enrichedModules.length} modules(${totalWords} từ).`);
            return finalResult;

        } catch (err) {
            log.warn(`⚠️ Bước 3 - Lượt thử ${attempts} thất bại: ${err.message} `);
            if (attempts === 3) throw err;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

function validateModulePlan(modules, niche = 'dark_psychology_de', contentMode = 'SHU') {
    const isLegoMicro = contentMode === 'LEGO_MICRO';
    const expectedCount = isLegoMicro ? 4 : 8;

    if (!Array.isArray(modules) || modules.length !== expectedCount) {
        throw new Error(`Số lượng module không hợp lệ: ${modules.length}. Kỳ vọng: ${expectedCount}.`);
    }

    const validRoles = nicheManager.getRoles(niche);

    modules.forEach((m, i) => {
        if (m.index !== i + 1) {
            throw new Error(`Index module không liên tục tại vị trí ${i} (Kỳ vọng ${i + 1}, nhận được ${m.index})`);
        }
        if (!validRoles.includes(m.role)) {
            throw new Error(`Invalid module role: ${m.role} `);
        }
    });

    if (modules[0].role !== "HOOK_THREAT" && modules[0].role !== "HOOK") {
        throw new Error(`Module đầu tiên phải là HOOK_THREAT / HOOK`);
    }

    const lastModule = modules[modules.length - 1];
    if (!["OPEN_LOOP", "OPEN_END", "COLD_RESOLUTION"].includes(lastModule.role)) {
        // We allow COLD_RESOLUTION for LEGO_MICRO as it merges with OPEN_LOOP
        if (!isLegoMicro || lastModule.role !== "COLD_RESOLUTION") {
            throw new Error(`Module cuối cùng không hợp lệ: ${lastModule.role} `);
        }
    }

    const totalWords = modules.reduce((sum, m) => sum + m.word_target, 0);
    log.info(`📊 Tổng dự lượng bài viết dự kiến: ${totalWords} từ.`);
}

async function executeAIPlanner(projectId, prompt) {
    // UPDATED MODEL PRIORITY: No 1.5, No 2.0
    const MODEL_PRIORITY = ['gemini-3-flash-preview', 'gemma-3-27b-it'];
    let lastError = null;

    for (const modelName of MODEL_PRIORITY) {
        try {
            return await keyManager.executeWithRetry(async (apiKey, proxy) => {
                const proxyUrl = keyManager.formatProxyUrl(proxy);
                const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

                const genAI = new GoogleGenerativeAI(apiKey);
                log.info(`🤖 Đang lập kế hoạch[Model: ${modelName}]...`);

                const model = genAI.getGenerativeModel({
                    model: modelName,
                    apiVersion: 'v1beta',
                    generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
                }, {
                    timeout: 60000,
                    httpOptions: agent ? { agent } : undefined
                });

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                const json = parseAIJSON(text, "Planner");

                if (json) {
                    if (projectId) {
                        const tokens = response.usageMetadata ? response.usageMetadata.totalTokenCount : 0;
                        await db.logAIAction(projectId, 'PLANNER_GEN', modelName, tokens, text);
                    }
                    return json;
                }
                throw new Error("Phản hồi AI không hợp lệ");
            });
        } catch (err) {
            lastError = err;
            const errMsg = err.message.toLowerCase();
            if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('503') || errMsg.includes('overloaded') || errMsg.includes('exhausted')) {
                log.warn(`⚠️ Model ${modelName} thất bại.Đang thử model tiếp theo...`);
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}

module.exports = { planModules };
