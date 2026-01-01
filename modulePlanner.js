const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const db = require('./database');
const { log } = require('./colors');
const { parseAIJSON } = require('./json_helper');
const nicheManager = require('./nicheManager');

/**
 * SHU Step 3: Module Planning Engine
 */

async function planModules(projectId, analyzedData, feedback = null, niche = 'self_help', targetWords = 5000) {
    log.info(`🧠 [SHU Bước 3] Đang lập kế hoạch module cho Dự án: ${projectId} (Ngách: ${niche}, Mục tiêu: ${targetWords} từ)${feedback ? " (Đang tinh chỉnh dựa trên phản hồi)" : ""}`);

    const nicheProfile = nicheManager.getProfile(niche);
    const validRoles = nicheManager.getRoles(niche);

    const prompt = `
You are a senior YouTube editor specializing in ${nicheProfile.writer_role}.

TASK:
${feedback ? `REFINE the following module plan based on the provided feedback to improve narrative flow, tension building, and keyword placement.

RULES FOR REFINEMENT:
- Do NOT change the total number of modules.
- Do NOT remove HOOK or OPEN_END.
- Improve narrative flow and escalation.
- Adjust goals to be sharper and more focused.
- Ensure only the requested roles are used.
- You MUST preserve the original role order defined by the niche role map.

FEEDBACK TO FIX:
${JSON.stringify(feedback)}

CURRENT PLAN TO REFINE (Base Plan):
${JSON.stringify(feedback?.module_plan || analyzedData.module_plan)}` : `Plan the optimal module structure for a long-form YouTube ${niche} video.`}

CONSTRUCTED CONTEXT:
- Niche: ${niche}
- Tone Strategy: ${Array.isArray(nicheProfile.tone) ? nicheProfile.tone.join(", ") : nicheProfile.tone}
- Dominant emotion: ${analyzedData.dominant_trigger}
- Hook strength score: ${analyzedData.hook_score}
- Core Keyword: ${analyzedData.core_keyword || "N/A"}

RULES:
- Total modules must be between 8 and 10
- Each module must have a clear narrative role
- Structure must escalate tension gradually (Single-Peak approach)
- IMPORTANT: You MUST choose exactly ONE role from the peak role list (PEAK, REALIZATION, TURNING_POINT, SHIFT) to serve as the narrative climax. Do NOT use more than one peak role in your plan.
- Final module must leave an open loop (no conclusion)

AVAILABLE MODULE ROLES:
${validRoles.join("\n")}

OUTPUT FORMAT (JSON ONLY):
[
  {
    "index": 1,
    "role": "HOOK",
    "goal": "..."
  }
]
`;

    let attempts = 0;
    while (attempts < 3) {
        attempts++;
        try {
            const aiPlan = await executeAIPlanner(projectId, prompt);

            if (!Array.isArray(aiPlan)) {
                throw new Error("AI failed to return a valid module list.");
            }

            // B3.3: Tool Enrichment (Rule-based)
            const enrichedModules = aiPlan.map(module => {
                if (!validRoles.includes(module.role)) {
                    throw new Error(`Invalid module role from AI: ${module.role}`);
                }

                let word_target = 500;
                let allowed_keyword_type = ["support"];

                const roleProps = nicheManager.getRoleProperty(module.role);
                const wordBias = roleProps.word_bias || 0;

                if (nicheProfile.keyword_discipline === "loose") {
                    allowed_keyword_type = [];
                }

                const scaleFactor = targetWords / 5000;

                switch (module.role) {
                    case "HOOK":
                        word_target = Math.round((120 + wordBias) * Math.max(0.8, scaleFactor));
                        if (nicheProfile.keyword_discipline !== "loose") allowed_keyword_type = ["core", "ctr"];
                        break;
                    case "PEAK":
                    case "REALIZATION":
                    case "TURNING_POINT":
                    case "SHIFT":
                        word_target = Math.round((650 + wordBias) * scaleFactor);
                        if (analyzedData.hook_score < 7) {
                            word_target = Math.round((500 + wordBias) * scaleFactor);
                        }
                        if (nicheProfile.keyword_discipline !== "loose") allowed_keyword_type = ["core", "support"];
                        break;
                    case "OPEN_END":
                        word_target = Math.round((300 + wordBias) * scaleFactor);
                        if (nicheProfile.keyword_discipline !== "loose") allowed_keyword_type = ["core"];
                        break;
                    default:
                        word_target = Math.round((550 + wordBias) * scaleFactor);
                        break;
                }

                return {
                    ...module,
                    word_target,
                    allowed_keyword_type
                };
            });

            validateModulePlan(enrichedModules);

            const totalWords = enrichedModules.reduce((sum, m) => sum + m.word_target, 0);

            await db.saveModulePlan(projectId, {
                modules: enrichedModules,
                version: "v1.0",
                hook_score: analyzedData.hook_score,
                total_word_estimate: totalWords
            });

            const finalResult = {
                module_plan: enrichedModules,
                total_word_estimate: totalWords,
                status: "ready_for_module_generation"
            };

            log.success(`✅ Bước 3 Hoàn tất: Đã lập kế hoạch cho ${enrichedModules.length} modules (Lượt thử: ${attempts}).`);
            return finalResult;

        } catch (err) {
            log.warn(`⚠️ Bước 3 - Lượt thử ${attempts} thất bại: ${err.message}`);
            if (attempts === 3) throw err;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

function validateModulePlan(modules) {
    if (modules.length < 8 || modules.length > 10) {
        throw new Error(`Số lượng module không hợp lệ: ${modules.length}. Phải từ 8-10.`);
    }

    modules.forEach((m, i) => {
        if (m.index !== i + 1) {
            throw new Error(`Index module không liên tục tại vị trí ${i} (Kỳ vọng ${i + 1}, nhận được ${m.index})`);
        }
    });

    const roles = modules.map(m => m.role);

    if (modules[0].role !== "HOOK") {
        throw new Error("Module đầu tiên phải là HOOK");
    }

    const peakRoles = ["PEAK", "REALIZATION", "TURNING_POINT", "SHIFT"];
    const foundPeak = roles.filter(r => peakRoles.includes(r));
    if (foundPeak.length !== 1) {
        throw new Error(`Số lượng PEAK không hợp lệ: ${foundPeak.length} (${foundPeak.join(", ")}). Phải có đúng 1 peak role (${peakRoles.join(", ")}).`);
    }

    if (!roles.includes("HOOK")) throw new Error("Thiếu module HOOK");

    const lastModule = modules[modules.length - 1];
    if (lastModule.role !== "OPEN_END") {
        throw new Error(`Module cuối cùng phải là OPEN_END, nhưng nhận được ${lastModule.role}`);
    }

    const totalWords = modules.reduce((sum, m) => sum + m.word_target, 0);
    log.info(`📊 Tổng dự lượng bài viết dự kiến: ${totalWords} từ.`);
}

async function executeAIPlanner(projectId, prompt) {
    const MODEL_PRIORITY = ['gemini-3-flash-preview', 'gemma-3-27b-it'];
    let lastError = null;

    for (const modelName of MODEL_PRIORITY) {
        try {
            return await keyManager.executeWithRetry(async (apiKey) => {
                const genAI = new GoogleGenerativeAI(apiKey);
                log.info(`🤖 Đang lập kế hoạch [Model: ${modelName}] bằng một API Key khả dụng...`);
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    apiVersion: 'v1beta',
                    generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
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
                log.warn(`⚠️ Model ${modelName} thất bại trên TẤT CẢ các Keys. Đang thử model tiếp theo...`);
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}

module.exports = { planModules };
