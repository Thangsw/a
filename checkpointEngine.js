const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const db = require('./database');
const { log } = require('./colors');
const { parseAIJSON } = require('./json_helper');
const nicheManager = require('./nicheManager');
const exportEngine = require('./exportEngine');

/**
 * SHU Step 3.5: Checkpoint Engine (Content Director)
 */

async function evaluatePlan(projectId, fullData, niche = 'self_help', outputDir = 'output', targetWords = 5000) {
    log.info(`🔒 [Checkpoint] Đang thẩm định kế hoạch cho Dự án: ${projectId} (Ngách: ${niche}, Mục tiêu: ${targetWords} từ)...`);
    const nicheProfile = nicheManager.getProfile(niche);

    const prompt = `
You are a senior ${nicheProfile.writer_role} content director.

TASK:
Evaluate whether the following plan (Keywords + Module Structure) is ready for full ${niche} video generation (${targetWords} words, approx. ${Math.round(targetWords / 150)}+ minutes).

INPUT DATA:
- Hook Score: ${fullData.hook_score}
- Dominant Trigger: ${fullData.dominant_trigger}
- Niche Tone Strategy: ${Array.isArray(nicheProfile.tone) ? nicheProfile.tone.join(", ") : nicheProfile.tone}
- Core Keyword: ${fullData.core_keyword}
- Supporting Keywords: ${JSON.stringify(fullData.supporting_keywords)}
- Module Plan: ${JSON.stringify(fullData.module_plan)}

CRITERIA:
1. Narrative Flow: Does the sequence build tension logically? Is there a "Single-Peak" structure?
2. Keyword Placement: Are core and supporting keywords placed in appropriate modules (HOOK, PEAK, etc.)?
3. Retention Potential: Does it have enough escalation to keep viewers engaged for 20+ minutes?
4. Factual Risk: Does the plan suggest absurd or prohibited claims that could damage authority?

RULES:
- If hook_score < 6, you MUST flag it as high risk unless the narrative is exceptional.
- If keywords are too generic, suggest "adjust_keywords".
- If the narrative nhịp (pacing) is off, suggest "replan_modules".

OUTPUT FORMAT (JSON ONLY):
{
  "ready": true,
  "recommendation": "proceed", 
  "issues": [],
  "feedback": "Detailed feedback for the next step if not ready"
}

*If ready is false, recommendation MUST be either "replan_modules" or "adjust_keywords".*
*Provide actionable feedback in the "feedback" field.*
`;

    try {
        const evaluation = await executeAICheckpoint(projectId, prompt, outputDir);

        if (!evaluation) {
            log.error("❌ [Checkpoint] AI không trả về phản hồi hợp lệ.");
            return { ready: false, recommendation: "replan_modules", issues: ["Phản hồi AI trống hoặc không thể giải mã"], feedback: "Hãy thử chạy lại hoặc kiểm tra API Key." };
        }

        if (evaluation.ready) {
            log.success(`✅ [Checkpoint] Kế hoạch ĐÃ ĐƯỢC PHÊ DUYỆT để tạo kịch bản.`);
        } else {
            const issuesText = Array.isArray(evaluation.issues) ? evaluation.issues.join(", ") : (evaluation.issues || "Không có lý do cụ thể");
            log.warn(`⚠️ [Checkpoint] Kế hoạch BỊ TỪ CHỐI. Lý do: ${issuesText}`);
            log.info(`💡 Đề xuất: ${evaluation.recommendation}`);
        }

        return evaluation;

    } catch (err) {
        log.error(`❌ Lỗi Checkpoint Engine: ${err.message}`);
        throw err;
    }
}

async function executeAICheckpoint(projectId, prompt, outputDir) {
    const MODEL_PRIORITY = ['gemini-3-flash-preview', 'gemma-3-27b-it', 'gemma-3-12b-it'];
    let lastError = null;

    for (const modelName of MODEL_PRIORITY) {
        try {
            return await keyManager.executeWithRetry(async (apiKey) => {
                const genAI = new GoogleGenerativeAI(apiKey);
                log.info(`🤖 Đang thẩm định [Model: ${modelName}] bằng một API Key khả dụng...`);
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    apiVersion: 'v1beta',
                    generationConfig: { maxOutputTokens: 2048, temperature: 0.3 }
                });

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();

                // SAVE RAW RESPONSE before parsing
                await exportEngine.saveRawResponse(projectId, `Checkpoint_${modelName}`, {
                    model: modelName,
                    raw_text: text,
                    prompt_sent: prompt
                }, outputDir);

                const rawJson = parseAIJSON(text, "CHECKPOINT_EVAL");
                if (rawJson) {
                    const json = Array.isArray(rawJson) ? rawJson[0] : rawJson;
                    if (!json) throw new Error("Phản hồi AI trống");

                    // Be lenient with 'ready' type (cast string to boolean if needed)
                    if (typeof json.ready !== 'boolean') {
                        json.ready = String(json.ready).toLowerCase() === 'true';
                    }

                    if (projectId) {
                        const tokens = response.usageMetadata ? response.usageMetadata.totalTokenCount : 0;
                        await db.logAIAction(projectId, 'CHECKPOINT_EVAL', modelName, tokens, text);
                    }
                    return json;
                }
                throw new Error("Phản hồi AI không hợp lệ hoặc thiếu trường dữ liệu cần thiết");
            });
        } catch (err) {
            lastError = err;
            log.warn(`⚠️ Model ${modelName} gặp lỗi: ${err.message}. Đang thử model dự phòng...`);
            continue; // Always try the next model in PRIORITY list if current one fails for ANY reason
        }
    }
    throw lastError;
}

module.exports = { evaluatePlan };
