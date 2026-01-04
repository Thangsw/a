const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const db = require('./database');
const { log } = require('./colors');
const { parseAIJSON } = require('./json_helper');
const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * LEGO Step 1.8: Micro-Topic Generator
 * Splits a core topic into 3 independent psychological units.
 */

async function generateMicroTopics(projectId, coreTopic, dominantTrigger, niche = 'dark_psychology_de') {
    log.info(`🧱 [LEGO Step 1.8] Generating 3 Micro-Topics for: ${coreTopic}`);

    const prompt = `
You are a content strategist specializing in psychology YouTube content for the German market (Style: Mr No Plan A).

TASK:
Generate exactly 3 MICRO-TOPICS from the core topic below.

DEFINITION:
A micro-topic is a narrowly scoped psychological question that:
- can be fully explained and resolved in a 12–15 minute video.
- does NOT require watching any other video to feel finished.
- revolves around EXACTLY ONE named psychological mechanism (e.g. avoidance conditioning, intermittent reinforcement, power asymmetry).

STRICT RULES:
1. ARC COMPLETENESS: Each micro-topic MUST be resolvable without referring to any future or related topic. The resolution must close the core question completely. Do NOT design topics that require follow-up videos.
2. ONE MECHANISM: Each micro-topic must revolve around ONE specific mechanism. If more than one mechanism is required to explain the topic, it is INVALID.
3. ROLE FIT: Each topic must be structured to fit perfectly into exactly 4 modules: Hook Threat, Mechanism Exposed, Power Balance, and Cold Resolution.
4. Standalone Rule: Do NOT ever use phrases like "part 2", "more in the next video", or "continued".

CORE TOPIC:
${coreTopic}

DOMINANT TRIGGER:
${dominantTrigger}

OUTPUT FORMAT (JSON ONLY):
[
  {
    "id": 1,
    "topic_title": "...",
    "core_question": "...",
    "named_mechanism": "...",
    "brief_outline": "...",
    "role_fit": {
      "hook_threat": true,
      "mechanism_exposed": true,
      "power_balance": true,
      "cold_resolution": true
    }
  }
]
`;

    try {
        const results = await executeAIGenerator(projectId, prompt);
        if (!Array.isArray(results) || results.length !== 3) {
            throw new Error("AI failed to generate exactly 3 micro-topics.");
        }

        log.success(`✅ Generated 3 Micro-Topics for LEGO production.`);

        if (projectId) {
            const project = await db.getProject(projectId);
            let analysis = {};
            try { analysis = JSON.parse(project.analysis_result || '{}'); } catch (e) { }
            analysis.micro_topics = results;
            await db.db.run('UPDATE projects SET analysis_result = ? WHERE id = ?', [JSON.stringify(analysis), projectId]);
        }

        return results;
    } catch (err) {
        log.error(`❌ MicroTopicGenerator Error: ${err.message}`);
        throw err;
    }
}

async function executeAIGenerator(projectId, prompt) {
    // UPDATED MODEL PRIORITY: Primary Gemini 3, Fallback Gemma 3/2.5 Flash
    const MODEL_PRIORITY = ['gemini-3-flash-preview', 'gemma-3-27b-it', 'gemini-2.5-flash'];

    for (const modelName of MODEL_PRIORITY) {
        try {
            return await keyManager.executeWithRetry(async (apiKey, proxy) => {
                const proxyUrl = keyManager.formatProxyUrl(proxy);
                const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    apiVersion: 'v1beta',
                    generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }
                }, {
                    httpOptions: agent ? { agent } : undefined
                });

                const result = await model.generateContent(prompt);
                const text = result.response.text();
                const json = parseAIJSON(text, "MicroTopicGen");

                if (json) {
                    if (projectId) await db.logAIAction(projectId, 'MICRO_TOPIC_GEN', modelName, 0, text);
                    return json;
                }

                log.error(`[DEBUG] MicroTopicGen failed to parse JSON from AI response. Raw text length: ${text.length}`);
                log.error(`[DEBUG] Raw AI Text: ${text.substring(0, 500)}...`);
                throw new Error("Invalid JSON from AI result.");
            });
        } catch (err) {
            const msg = err.message.toLowerCase();
            if (msg.includes('429') || msg.includes('quota')) continue;
            throw err;
        }
    }
}

module.exports = { generateMicroTopics };
