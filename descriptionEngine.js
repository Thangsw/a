const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const db = require('./database');
const { log } = require('./colors');
// parseAIResponse removed
const nicheManager = require('./nicheManager');

/**
 * SHU Step 6.5: Description & Timestamp Generator
 */

const WPM = 150; // Words Per Minute

async function generateDescriptionBundle(projectId, assembledData, niche = 'documentary', targetLanguage = 'English') {
    log.info(`📝 [SHU Step 6.5] Generating Description & Timestamps for Project: ${projectId} (Niche: ${niche})`);

    const nicheProfile = nicheManager.getProfile(niche);
    const modules = assembledData.modules_data || [];

    if (modules.length === 0) {
        log.warn("⚠️ No modules found. Skipping timestamp calculation.");
        return { description: "", timestamps: [] };
    }

    try {
        // --- STEP 1: CALCULATE TIMESTAMPS ---
        const timestamps = calculateTimestamps(modules);

        // --- STEP 2: GENERATE DESCRIPTION TEXT ---
        const descriptionText = await generateDescriptionText(projectId, assembledData.full_script, timestamps, nicheProfile, targetLanguage);

        const finalResult = {
            description: descriptionText,
            timestamps: timestamps,
            raw_output: `${descriptionText}\n\nKapitel:\n${formatTimestamps(timestamps)}`
        };

        // Persistence
        if (projectId) {
            const project = await db.getProject(projectId);
            let currentAnalysis = {};
            try { currentAnalysis = JSON.parse(project.analysis_result || '{}'); } catch (e) { }

            const updatedAnalysis = {
                ...currentAnalysis,
                description_bundle: finalResult,
                step65_generated_at: new Date().toISOString()
            };

            await db.db.run(
                'UPDATE projects SET analysis_result = ? WHERE id = ?',
                [JSON.stringify(updatedAnalysis), projectId]
            );
        }

        log.success("✅ Step 6.5 Complete: Description Bundle generated.");
        return finalResult;

    } catch (err) {
        log.error(`❌ Step 6.5 Error: ${err.message}`);
        throw err;
    }
}

/**
 * Logic: Start at 00:00. Next time = current time + (words / WPM * 60)
 */
function calculateTimestamps(modules) {
    let currentTimeSeconds = 0;
    const timestamps = [];

    modules.forEach((mod, idx) => {
        const timeStr = formatTime(currentTimeSeconds);
        timestamps.push({
            time: timeStr,
            seconds: currentTimeSeconds,
            title: (mod.role || "MODULE").replace(/_/g, ' ').toUpperCase(),
            index: mod.module_index
        });

        const wordCount = (mod.content || "").split(/\s+/).filter(w => w.length > 0).length;
        const durationSeconds = (wordCount / WPM) * 60;
        currentTimeSeconds += durationSeconds;
    });

    return timestamps;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatTimestamps(timestamps) {
    return timestamps.map(ts => `${ts.time} – ${ts.title}`).join('\n');
}

async function generateDescriptionText(projectId, fullScript, timestamps, profile, targetLanguage) {
    const isDE = (targetLanguage === 'German' || profile.market === 'DE');

    const styleInstruction = profile.description_style || { tone: "informative" };

    const prompt = `
You are a YouTube SEO expert. 
TASK: Write a professional video description for a ${profile.name || 'YouTube Video'}.

RULES:
1. Language: MUST be in ${targetLanguage}.
2. Tone: ${styleInstruction.tone}. Informational, logical, and clear.
${isDE ? `3. STRICT DE RULES:
   - NO Motivation.
   - NO Call to Action (CTA).
   - NO Emojis.
   - Focus on mechanisms, boundaries, and psychological respect.` : `3. Standard Rules: 
   - Engaging summary.
   - Clear value proposition.`}
4. NO hashtags or excessive tagging.
5. Content length: 3-5 concise paragraphs.

SCRIPT SUMMARY:
${fullScript.substring(0, 3000)}...

CHAPTERS TO INCLUDE:
${formatTimestamps(timestamps)}

OUTPUT:
Write ONLY the description text. Do NOT include any intro like "Here is the description".
`;

    const MODEL_PRIORITY = ['gemma-3-27b-it', 'gemini-3-flash-preview'];

    return await keyManager.executeWithRetry(async (apiKey) => {
        const genAI = new GoogleGenerativeAI(apiKey);
        for (const modelName of MODEL_PRIORITY) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    apiVersion: 'v1beta',
                    generationConfig: { maxOutputTokens: 1024, temperature: 0.5 }
                });

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text().trim();

                if (text && text.length > 50) {
                    return text;
                }
            } catch (err) {
                const errMsg = err.message.toLowerCase();
                if (errMsg.includes('429') || errMsg.includes('quota')) continue;
                throw err;
            }
        }
        return "Description generation failed.";
    });
}

module.exports = { generateDescriptionBundle };
