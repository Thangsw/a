const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const db = require('./database');
const { log } = require('./colors');
const { parseAIJSON } = require('./json_helper');
const nicheManager = require('./nicheManager');

/**
 * SHU Step 4: Module Script Generation Engine
 */

const pLimit = require('p-limit');

async function processAllModules(projectId, fullData, niche = 'self_help', targetLanguage = 'English') {
    log.info(`🛠️ [SHU Bước 4] Bắt đầu viết kịch bản chi tiết cho Dự án: ${projectId} (Ngách: ${niche})`);

    const nicheProfile = nicheManager.getProfile(niche);
    const modulePlan = fullData.module_plan || [];
    if (modulePlan.length === 0) {
        throw new Error("Không tìm thấy kế hoạch module để viết kịch bản.");
    }

    const coreKeyword = fullData.core_keyword;
    const supportingKeywords = fullData.supporting_keywords || [];
    const ctrPhrases = fullData.ctr_phrases || [];

    // Parallelism setup
    const limit = pLimit(9); // Viết tối đa 9 modules cùng lúc
    let previousSummary = "This is the start of the video.";

    // We can't easily pass previousSummary in a fully parallel way if modules depend on it.
    // However, for SHU documentary style, modules are often discrete. 
    // We'll use a sequential summary chain or just a general project summary to enable parallelism.
    const projectSummary = fullData.summary || "A detailed documentary about " + coreKeyword;

    const modulePromises = modulePlan.map((module) => limit(async () => {
        log.info(`✍️ Đang tạo Module ${module.index}/${modulePlan.length}: ${module.role}`);

        let allowedKeywords = [];
        if (module.allowed_keyword_type.includes('core')) allowedKeywords.push(coreKeyword);
        if (module.allowed_keyword_type.includes('support')) allowedKeywords.push(...supportingKeywords);
        if (module.allowed_keyword_type.includes('ctr')) allowedKeywords.push(...ctrPhrases);

        let attempts = 0;
        let success = false;
        let moduleScript = null;

        while (attempts < 2 && !success) {
            attempts++;
            try {
                // 1. AI Generation
                moduleScript = await generateModule(projectId, module, allowedKeywords, projectSummary, niche, targetLanguage);

                // 2. Tool-based QA Check
                const qaResult = qaCheck(moduleScript, module, allowedKeywords, nicheProfile);
                if (!qaResult.pass) {
                    const issuesText = Array.isArray(qaResult.issues) ? qaResult.issues.join(", ") : "Lỗi QA không xác định";
                    throw new Error(`QA thất bại: ${issuesText}`);
                }

                // 3. AI Self-Check
                const evalResult = await evaluateModule(projectId, moduleScript, module, niche);
                if (evalResult && !evalResult.pass) {
                    const issuesText = Array.isArray(evalResult.issues) ? evalResult.issues.join(", ") : "Lỗi Thẩm định không xác định";
                    throw new Error(`AI thẩm định thất bại: ${issuesText}`);
                }

                success = true;
                log.success(`✅ Module ${module.index} đã vượt qua các bước kiểm tra QA và Thẩm định.`);

            } catch (err) {
                log.warn(`⚠️ Module ${module.index} - Lượt thử ${attempts} thất bại: ${err.message}`);
                if (attempts === 2) {
                    log.error(`❌ Module ${module.index} thất bại sau tất cả các lượt thử.`);
                    success = true;
                }
            }
        }

        if (moduleScript) {
            // Đảm bảo kết quả trả về có đầy đủ thông tin để Assembler không bị lạc lối
            const enrichedScript = {
                ...moduleScript,
                role: module.role,
                goal: module.goal,
                word_target: module.word_target
            };

            if (projectId) {
                await db.db.run(
                    'INSERT OR REPLACE INTO modules (project_id, module_index, module_type, word_target, role) VALUES (?, ?, ?, ?, ?)',
                    [projectId, module.index, module.role, module.word_target, module.role]
                );
                const mod = await db.db.get('SELECT id FROM modules WHERE project_id = ? AND module_index = ?', [projectId, module.index]);
                if (mod) {
                    await db.db.run(
                        'INSERT OR REPLACE INTO module_scripts (module_id, content_text, cliff_text) VALUES (?, ?, ?)',
                        [mod.id, enrichedScript.content, enrichedScript.cliffhanger]
                    );
                }
            }
            return enrichedScript;
        }
        return null;
    }));

    const results = (await Promise.all(modulePromises)).filter(r => r !== null);
    results.sort((a, b) => a.module_index - b.module_index);

    log.success(`🏁 Bước 4 Hoàn tất: Đã viết xong ${results.length}/${modulePlan.length} modules song song.`);

    return {
        modules_written: results.length,
        modules_passed: results.length,
        status: "ready_for_assembly",
        modules_data: results
    };
}


async function generateModule(projectId, moduleData, allowedKeywords, previousSummary, niche, targetLanguage = 'English') {
    const profile = nicheManager.getProfile(niche);

    const prompt = `
You are an expert ${profile.writer_role}.

MODULE ROLE:
${moduleData.role}

MODULE GOAL:
${moduleData.goal}

TASK:
Write the content for this module in ${targetLanguage}.
- LANGUAGE RULE: You MUST write the entire content and cliffhanger in ${targetLanguage}.

- STRICT RULE: Do NOT mention "part 2", "next part", "next video", "im nächsten Teil", "hẹn gặp lại ở video sau", or any phrases implying this is not a complete, standalone unit.
- Ensure every module is self-contained and logical even if viewed in isolation.
- No greetings, no calls to action.

CONTENT RULES:
- Tone: ${Array.isArray(profile.tone) ? profile.tone.join(", ") : profile.tone}
- Dòng chảy nội dung: Lạnh lùng, dứt khoát, đi thẳng vào vấn đề. TUYỆT ĐỐI không dùng ẩn dụ văn học (rừng rậm, gương vỡ), không ủy mị, không kể lể dài dòng.
- Use concrete technical and psychological terms. Build credibility through cold distance.
- ${profile.speculation_level === 'free' ? "Thoughtful speculation, reflective questions, and emotional interpretation are ENCOURAGED." : (profile.speculation_level === 'limited' ? "Avoid wild speculation; only provide limited, logical interpretations based on Case Studies." : "STRICT RULE: Avoid all speculation. Stick 100% to logical patterns and facts.")}
${(profile.forbidden_phrases || []).length > 0 ? `- FORBIDDEN WORDS (NEVER USE): ${profile.forbidden_phrases.join(", ")}` : ""}
${profile.gold_standard_samples ? `- GOLD STANDARD SAMPLES (FOLLOW THIS STYLE):
${profile.gold_standard_samples.map(s => `  > ${s}`).join("\n")}
` : ""}
${profile.requires_disclaimer ? "- IMPORTANT: Include a brief, non-medical disclaimer where appropriate." : ""}
${profile.sentence_constraints ? `- SENTENCE CONSTRAINTS: 
    * Max words per sentence: ${profile.sentence_constraints.max_words_per_sentence} (You are ENCOURAGED to use this limit to provide depth).
    * Preferred structure: ${profile.sentence_constraints.preferred_structure}
    * Rhetorical questions max: ${profile.sentence_constraints.rhetorical_questions_max}
    * Avoid American-style emotional softening.` : ""}
${profile.cultural_rules ? `- CULTURAL RULES (${profile.market}): 
    * Avoid Hype: ${profile.cultural_rules.avoid_hype}
    * Avoid Emotional Validation: ${profile.cultural_rules.avoid_emotional_validation}
    * Focus on Mechanism: ${profile.cultural_rules.focus_on_mechanism}` : ""}

KEYWORD RULES:
- You may ONLY use the following keywords:
${allowedKeywords.join(", ")}
- Use each keyword at most ONCE
- Do NOT introduce new SEO keywords

STRUCTURE REQUIREMENTS:
- Follow the assigned module role strictly
- Build tension progressively
- ${nicheManager.getCliffRule(profile.cliff_style)}

LENGTH:
- Target: ${moduleData.word_target} words.
- STRICT RULE: You MUST write at least ${moduleData.word_target} words. Do NOT provide a short summary. Provide deep, expansive prose.
- Allowed range: ${Math.round(moduleData.word_target * 0.95)} - ${Math.round(moduleData.word_target * 1.25)} words.
- PROSE PRESSURE: Develop every point with massive detail, historical context, and atmospheric descriptions to meet the word count target.

OUTPUT FORMAT (JSON ONLY):
{
  "module_index": ${moduleData.index},
  "content": "...",
  "cliffhanger": "..."
}
`;

    return await executeAIScript(projectId, prompt, `GENERATE_MODULE_${moduleData.index}`);
}

function qaCheck(moduleScript, moduleData, allowedKeywords, profile) {
    const issues = [];
    const content = moduleScript.content || "";
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

    // 1. Check Word Count (Chỉ kiểm tra tối thiểu để tránh AI lười biếng. KHÔNG giới hạn trần).
    const minWords = moduleData.word_target * 0.70; // Giảm xuống 70% cho an toàn
    if (wordCount < minWords) {
        issues.push(`Content too short: ${wordCount} words (Target: ${moduleData.word_target}, Min: ${Math.round(minWords)})`);
    }
    // Hủy bỏ giới hạn trần (maxWords) hoàn toàn. AI viết dài là tốt cho Visual.

    // 2. Check Keyword Usage
    if (profile.keyword_discipline === "strict") {
        allowedKeywords.forEach(kw => {
            const regex = new RegExp(`\\b${kw}\\b`, 'gi');
            const matches = content.match(regex);
            if (matches && matches.length > 1) {
                issues.push(`Keyword "${kw}" used ${matches.length} times (Max: 1)`);
            }
        });
    } else {
        // Loose discipline: just check for extreme spam
        allowedKeywords.forEach(kw => {
            const regex = new RegExp(`\\b${kw}\\b`, 'gi');
            const matches = content.match(regex);
            if (matches && matches.length > 2) {
                issues.push(`Keyword "${kw}" overused emotionally (${matches.length} matches)`);
            }
        });
    }

    // 3. Check Forbidden Phrases
    const defaultForbidden = ["in conclusion", "to summarize", "in summary", "thank you for watching"];
    const allForbidden = [...defaultForbidden, ...(profile.forbidden_phrases || [])];
    allForbidden.forEach(phrase => {
        if (content.toLowerCase().includes(phrase)) {
            issues.push(`Forbidden phrase detected: "${phrase}"`);
        }
    });

    // 4. Check Sentence Constraints (German Market)
    if (profile.sentence_constraints && profile.sentence_constraints.max_words_per_sentence) {
        const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
        sentences.forEach(s => {
            const wordsInSentence = s.split(/\s+/).length;
            if (wordsInSentence > profile.sentence_constraints.max_words_per_sentence) {
                issues.push(`Sentence too long (${wordsInSentence} words): "${s.substring(0, 30)}..." (Max: ${profile.sentence_constraints.max_words_per_sentence})`);
            }
        });
    }

    // 5. Check Cliffhanger
    if (!moduleScript.cliffhanger || moduleScript.cliffhanger.trim().length < 10) {
        issues.push("Missing or too short cliffhanger sentence.");
    }

    return {
        pass: issues.length === 0,
        issues
    };
}

async function evaluateModule(projectId, moduleScript, moduleData, niche) {
    const profile = nicheManager.getProfile(niche);
    const prompt = `
Evaluate the following ${niche} module script.

TASK:
Check whether the module:
- Fulfills its role: ${moduleData.role}
- Fulfills its goal: ${moduleData.goal}
- Matches tone: ${Array.isArray(profile.tone) ? profile.tone.join(", ") : profile.tone}
- Builds tension effectively (Cliff style instruction: ${nicheManager.getCliffRule(profile.cliff_style)})
- Avoids repetition and keeps the pace
- Ends with a strong, natural cliffhanger
${profile.script_validation ? `- VALIDATION CHECKS:
    * Over-Empathy Check: ${profile.script_validation.over_empathy_check}
    * American Tone Check: ${profile.script_validation.american_tone_check}
    * Logic Gap Check: ${profile.script_validation.logic_gap_check}` : ""}

MODULE CONTENT:
${moduleScript.content}

CLIFFHANGER:
${moduleScript.cliffhanger}

OUTPUT JSON ONLY:
{
  "pass": true,
  "issues": []
}
`;

    const result = await executeAIScript(projectId, prompt, `EVALUATE_MODULE_${moduleData.index}`);
    return result || { pass: true, issues: [] };
}

async function executeAIScript(projectId, prompt, actionName) {
    const MODEL_PRIORITY = ['gemma-3-27b-it', 'gemma-3-12b-it', 'gemini-3-flash-preview'];
    let lastError = null;

    for (const modelName of MODEL_PRIORITY) {
        try {
            return await keyManager.executeWithRetry(async (apiKey) => {
                const genAI = new GoogleGenerativeAI(apiKey);
                log.info(`🤖 Đang viết kịch bản [Model: ${modelName}] bằng một API Key khả dụng...`);
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    apiVersion: 'v1beta',
                    generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
                });

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                const rawJson = parseAIJSON(text, "SCRIPT_GEN");
                if (rawJson) {
                    const json = Array.isArray(rawJson) ? rawJson[0] : rawJson;
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

module.exports = { processAllModules };
