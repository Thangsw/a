const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const db = require('./database');
const { log } = require('./colors');
const { parseAIJSON } = require('./json_helper');
const nicheManager = require('./nicheManager');

/**
 * SHU Step 6: CTR Engine (Title & Thumbnail)
 */

async function generateCTRBundle(projectId, fullScript, niche = 'documentary', targetLanguage = 'English') {
    log.info(`🚀 [SHU Step 6] Generating CTR Bundle for Project: ${projectId} (Niche: ${niche})`);

    const nicheProfile = nicheManager.getProfile(niche);
    const ctrConfig = nicheProfile.ctr_config || {};

    try {
        // --- STEP 6.1: EXTRACT CLICK TRIGGERS ---
        log.info("🔍 Extracting Click Triggers from script...");
        const triggers = await extractClickTriggers(projectId, fullScript);

        // --- STEP 6.2: TITLE ENGINE (NICHE-SPECIFIC) ---
        log.info(`✍️ Generating ${niche.toUpperCase()} titles...`);
        const titles = await generateTitles(projectId, triggers, ctrConfig, targetLanguage);

        // --- STEP 6.3: THUMBNAIL ENGINE ---
        log.info(`🖼️ Creating thumbnail concept for ${niche.toUpperCase()}...`);
        const thumbnail = await generateThumbConcept(projectId, triggers, ctrConfig, targetLanguage);

        // --- STEP 6.4: TITLE ↔ THUMB SYNC CHECK ---
        const syncStatus = syncCheck(titles, thumbnail);
        if (!syncStatus.pass) {
            log.warn(`⚠️ CTR Sync Warning: ${syncStatus.issue}`);
        }

        const finalResult = {
            titles: titles,
            thumbnail: thumbnail,
            click_triggers: triggers,
            ctr_strategy: ctrConfig.strategy,
            sync_check: syncStatus,
            status: "ready_for_publish"
        };

        // Persistence (Update analysis_result)
        if (projectId) {
            const project = await db.getProject(projectId);
            let currentAnalysis = {};
            try { currentAnalysis = JSON.parse(project.analysis_result || '{}'); } catch (e) { }

            const updatedAnalysis = {
                ...currentAnalysis,
                ctr_bundle: finalResult,
                ctr_generated_at: new Date().toISOString()
            };

            await db.db.run(
                'UPDATE projects SET analysis_result = ?, status = ? WHERE id = ?',
                [JSON.stringify(updatedAnalysis), 'completed', projectId]
            );
        }

        log.success("✅ Step 6 Complete: CTR Bundle generated.");
        return finalResult;

    } catch (err) {
        log.error(`❌ Step 6 Error: ${err.message}`);
        throw err;
    }
}

async function extractClickTriggers(projectId, script) {
    const prompt = `
You are a YouTube CTR analyst.

TASK:
Analyze the following script and extract click-worthy elements.

EXTRACT:
1. Core curiosity point (1 sentence)
2. Strongest emotional pain or tension
3. One shocking / unexpected angle
4. One short phrase suitable for thumbnail text (2–4 words max)

RULES:
- Do NOT write a title
- Do NOT summarize the script
- Extract only what triggers curiosity or emotion

SCRIPT:
${script.substring(0, 5000)} // Analyze first 5k chars for triggers

OUTPUT JSON ONLY:
{
  "curiosity_core": "...",
  "emotional_trigger": "...",
  "shock_angle": "...",
  "thumbnail_phrase": "..."
}
`;

    return await executeAICall(projectId, prompt, 'EXTRACT_TRIGGERS');
}

async function generateTitles(projectId, triggers, config, targetLanguage = 'English') {
    const titleRules = (typeof config.title_rules === 'object') ? JSON.stringify(config.title_rules) : config.title_rules;
    const prompt = `
You are a YouTube viral title expert.

TASK:
${titleRules}

RULES:
- Return 5 variants
- Reflect the core curiosity and emotion
- No clickbait lies
- LANGUAGE RULE: You MUST write the titles in ${targetLanguage}.
${config.title_rules.language_lock ? `- LANGUAGE LOCK: Titles MUST be in ${config.title_rules.language_lock}.` : ""}

DATA TO USE:
Curiosity: ${triggers.curiosity_core}
Emotional Pain: ${triggers.emotional_trigger}
Shock Angle: ${triggers.shock_angle}

OUTPUT JSON ONLY:
["Title 1", "Title 2", "Title 3", "Title 4", "Title 5"]
`;

    return await executeAICall(projectId, prompt, 'GENERATE_TITLES');
}

async function generateThumbConcept(projectId, triggers, config, targetLanguage = 'English') {
    const thumbRules = (typeof config.thumbnail_rules === 'object') ? JSON.stringify(config.thumbnail_rules) : config.thumbnail_rules;
    const prompt = `
You are a professional YouTube Thumbnail artist and Prompt Engineer.

TASK:
Create a thumbnail concept and AI image generation prompt.

NICHE REQUIREMENTS:
${thumbRules}

STRICT LANGUAGE RULE:
- Text on thumbnail MUST be written in ${targetLanguage}.
${config.thumbnail_rules.language_lock ? `- LANGUAGE LOCK: Thumbnail text MUST be in ${config.thumbnail_rules.language_lock}. NO English words allowed if target is ${config.thumbnail_rules.language_lock}.` : ""}

DATA TO USE:
Trigger: ${triggers.shock_angle}
Text on Thumb (Draft): ${triggers.thumbnail_phrase}

OUTPUT JSON ONLY:
{
  "visual_concept": "Describe the thumbnail scene",
  "text_on_thumb": "Final short text in ${targetLanguage}",
  "ai_image_prompt": "Cinematic high-detail prompt for an AI image generator",
  "mood": "..."
}
`;

    return await executeAICall(projectId, prompt, 'GENERATE_THUMB');
}

function syncCheck(titles, thumbnail) {
    const thumbText = (thumbnail.text_on_thumb || "").toLowerCase();

    for (const title of titles) {
        const titleLower = title.toLowerCase();
        // Check if title and thumb text are too similar
        if (titleLower.includes(thumbText) && thumbText.length > 5) {
            return {
                pass: false,
                issue: "Thumbnail text overlaps with Title content. Redundancy detected."
            };
        }
    }

    return { pass: true, issue: null };
}

async function executeAICall(projectId, prompt, taskType) {
    const MODEL_PRIORITY = ['gemma-3-27b-it', 'gemma-3-12b-it', 'gemini-3-flash-preview'];

    return await keyManager.executeWithRetry(async (apiKey) => {
        const genAI = new GoogleGenerativeAI(apiKey);
        let lastError = null;

        for (const modelName of MODEL_PRIORITY) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    apiVersion: 'v1beta',
                    generationConfig: { maxOutputTokens: 2048, temperature: 0.8 }
                });

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                const json = parseAIJSON(text, taskType);

                if (json) {
                    if (projectId) {
                        const tokens = response.usageMetadata ? response.usageMetadata.totalTokenCount : 0;
                        await db.logAIAction(projectId, taskType, modelName, tokens, text);
                    }
                    return json;
                }
            } catch (err) {
                lastError = err;
                const errMsg = err.message.toLowerCase();
                if (errMsg.includes('429') || errMsg.includes('quota')) continue;
                throw err;
            }
        }
        throw lastError || new Error(`AI Call failed for ${taskType}`);
    });
}

module.exports = { generateCTRBundle };
