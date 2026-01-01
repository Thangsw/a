const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const db = require('./database');
const { log } = require('./colors');
// parseAIResponse removed as it is not used directly here
const nicheManager = require('./nicheManager');

/**
 * SHU Step 5: Script Assembly + Emotional Flow Engine
 */

async function assembleScript(projectId, modulesData, niche = 'documentary', targetLanguage = 'English') {
    log.info(`🔗 [SHU Step 5] Assembling Script for Project: ${projectId} (Niche: ${niche})`);

    const nicheProfile = nicheManager.getProfile(niche);
    const modules = Array.isArray(modulesData) ? modulesData : (modulesData.modules_data || []);

    if (modules.length === 0) {
        throw new Error("No module data provided for assembly.");
    }

    // Sort modules by index
    const sortedModules = [...modules].sort((a, b) => a.module_index - b.module_index);

    // --- GAP CHECK: Ensure no modules are missing in sequence ---
    for (let i = 0; i < sortedModules.length; i++) {
        const expectedIndex = i + 1;
        if (sortedModules[i].module_index !== expectedIndex) {
            log.error(`❌ [Assembler] Phát hiện thiếu Module tại Index ${expectedIndex}. Sequence: ${sortedModules.map(m => m.module_index).join(',')}`);
            throw new Error(`Kịch bản không liên tục: Thiếu Module ${expectedIndex}. Vui lòng chạy lại Planner.`);
        }
    }

    // --- STEP 5.1: MODULE ORDER & EMOTIONAL FLOW CHECK (DATA-DRIVEN) ---
    const validation = validateEmotionalFlow(sortedModules, nicheProfile);
    if (!validation.pass) {
        const issuesText = Array.isArray(validation.issues) ? validation.issues.join("; ") : "Lỗi luồng cảm xúc không xác định";
        log.warn(`⚠️ Emotional Flow Check: ${issuesText}`);
    }

    // --- STEP 5.2: MERGE MODULES & HOOK PROTECTION ---
    // Extract HOOK (module 1) to protect it from AI softening
    const hookModule = sortedModules.find(m => m.module_index === 1);
    const bodyModules = sortedModules.filter(m => m.module_index !== 1);

    const hookText = hookModule ? hookModule.content : "";

    // Add markers to body modules to preserve boundaries during polish
    const bodyRaw = bodyModules.map(m => `[M-${m.module_index}]\n${m.content}`).join("\n\n");

    // --- STEP 5.3: EMOTIONAL FLOW POLISH (AI CALL - BODY ONLY) ---
    log.info(`✨ Polishing script BODY for ${niche.toUpperCase()} (Protecting HOOK)...`);
    const polishedBody = await polishWithAI(projectId, bodyRaw, nicheProfile, targetLanguage);

    // --- STEP 5.3.1: SPLIT POLISHED BODY BACK INTO MODULES ---
    const modulesMap = new Map();
    // Re-add hook to the map
    if (hookModule) modulesMap.set(1, hookText);

    // Split by markers [M-X]
    const parts = polishedBody.split(/\[M-(\d+)\]/);
    for (let i = 1; i < parts.length; i += 2) {
        const index = parseInt(parts[i]);
        const content = parts[i + 1].trim();
        modulesMap.set(index, content);
    }

    // Fallback: If AI stripped markers, just use raw modules but log warning
    if (modulesMap.size <= 1 && bodyModules.length > 0) {
        log.warn("⚠️ AI stripped module markers during polish. Falling back to unpolished modules for individual chapters.");
        bodyModules.forEach(m => modulesMap.set(m.module_index, m.content));
    }

    // Create polished modules array for the next steps
    const polishedModules = sortedModules.map(m => ({
        ...m,
        content: modulesMap.get(m.module_index) || m.content
    }));

    // Re-join for full script display
    const finalPolishedScript = polishedModules.map(m => m.content).join("\n\n");

    // --- STEP 5.4: VOICE READABILITY CHECK (TOOL-BASED) ---
    const readability = checkReadability(finalPolishedScript, nicheProfile);

    // --- STEP 5.5: OUTPUT & PERSISTENCE ---
    const finalResult = {
        full_script: finalPolishedScript,
        word_count: finalPolishedScript.split(/\s+/).filter(w => w.length > 0).length,
        voice_ready: readability.pass,
        emotional_arc_passed: validation.pass,
        validation_issues: validation.issues,
        readability_issues: readability.issues,
        status: "ready_for_title_and_thumbnail",
        modules_data: polishedModules
    };

    // Save to DB
    if (projectId) {
        await db.db.run(
            'INSERT OR REPLACE INTO script_finals (project_id, full_script_text, version) VALUES (?, ?, ?)',
            [projectId, finalPolishedScript, "v1.1-hook-protected"]
        );

        const project = await db.getProject(projectId);
        let currentAnalysis = {};
        try { currentAnalysis = JSON.parse(project.analysis_result || '{}'); } catch (e) { }

        const updatedAnalysis = {
            ...currentAnalysis,
            step5_result: finalResult,
            assembled_at: new Date().toISOString()
        };

        await db.db.run(
            'UPDATE projects SET analysis_result = ?, status = ? WHERE id = ?',
            [JSON.stringify(updatedAnalysis), 'assembled', projectId]
        );
    }

    log.success(`🏁 Step 5 Complete: Full script generated (${finalResult.word_count} words).`);
    return finalResult;
}

function validateEmotionalFlow(modules, profile) {
    const issues = [];
    const arcStages = profile.emotional_arc || [];
    const arcMap = nicheManager.ARC_STAGE_MAP;

    if (arcStages.length === 0) return { pass: true, issues: [] };

    const roles = modules.map(m => m.role);

    // Check if each arc stage is represented by at least one module role
    arcStages.forEach(stage => {
        const allowedRoles = arcMap[stage] || [];
        const hasStage = roles.some(r => allowedRoles.includes(r));
        if (!hasStage) {
            issues.push(`Missing emotional stage: ${stage.toUpperCase()}`);
        }
    });

    // Check sequence: Roles should appear in roughly the same order as arcStages
    let lastFoundIdx = -1;
    arcStages.forEach(stage => {
        const allowedRoles = arcMap[stage] || [];
        const stageIdx = roles.findIndex(r => allowedRoles.includes(r));

        if (stageIdx !== -1) {
            if (stageIdx < lastFoundIdx) {
                issues.push(`Emotional flow regression: ${stage.toUpperCase()} found before previous stage.`);
            }
            lastFoundIdx = stageIdx;
        }
    });

    return {
        pass: issues.length === 0,
        issues
    };
}

async function polishWithAI(projectId, rawScript, profile, targetLanguage = 'English') {
    const prompt = `
${profile.polish_prompt}

LANGUAGE RULE: The input script is in ${targetLanguage}. You MUST maintain the ${targetLanguage} language in your polished output.
${(targetLanguage === 'German' || profile.market === 'DE') ? `STRICT STYLE RULE (DE):
 - NO American-style emotional softening. 
 - Keep it cold, analytical, and direct.
 - DO NOT use words like "deserve", "healing", "journey", or "motivation".
 - Maintain declarative tone.` : ""}

SCRIPT BODY TO POLISH:
${rawScript}

OUTPUT:
Return the polished body as plain text in ${targetLanguage}. 
IMPORTANT: DO NOT REMOVE the [M-X] markers at the beginning of each module.
`;

    return await executeAIPolish(projectId, prompt);
}

function checkReadability(text, profile) {
    const issues = [];
    const paragraphs = text.split(/\n\n+/);
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];

    // 1. Sentence length check (> 25 words)
    sentences.forEach(s => {
        const words = s.trim().split(/\s+/).length;
        if (words > 28) {
            issues.push(`Long sentence: "${s.trim().substring(0, 30)}..." (${words} words)`);
        }
    });

    // 2. Paragraph density (> 5 sentences)
    paragraphs.forEach(p => {
        const pSentences = p.match(/[^.!?]+[.!?]+/g) || [];
        if (pSentences.length > 5) {
            issues.push(`Dense paragraph: (${pSentences.length} sentences).`);
        }
    });

    // 3. Niche-specific Semantic Patterns (Soft Warning)
    if (profile.emotional_requirements?.empathy_mirror) {
        const empathyPatterns = [
            /maybe (you|this|it)/i,
            /understand/i,
            /know how (it|you) feel/i,
            /imagine/i,
            /if you've ever/i,
            /\?/ // Direct questions to viewer
        ];

        const found = empathyPatterns.filter(pattern => pattern.test(text));
        if (found.length < 2) {
            issues.push("Suggestion: Increase empathy signals (direct address to viewer).");
        }
    }

    if (profile.emotional_requirements?.reflection_signals) {
        const pivotPatterns = [
            /but here/i,
            /what if/i,
            /instead of/i,
            /the part/i,
            /real question/i
        ];
        const foundPivots = pivotPatterns.filter(pattern => pattern.test(text));
        if (foundPivots.length < 1) {
            issues.push("Suggestion: Add a clear awareness pivot (e.g., 'But here is the part...').");
        }
    }

    // 4. DE Flow Check (German Market specific validation)
    if (targetLanguage === 'German' || profile.market === 'DE') {
        const empathyWords = ["healing", "deserve", "journey", "motivation", "self-love", "believe"];
        const foundEmpathy = empathyWords.filter(w => text.toLowerCase().includes(w));
        if (foundEmpathy.length > 0) {
            const empathyText = Array.isArray(foundEmpathy) ? foundEmpathy.join(", ") : "N/A";
            issues.push(`DE_FLOW_ALERT: Over-empathy detected! Forbidden emotional words found: [${empathyText}]. This script feels too "American".`);
        }

        // Logical density check (simple sentence count vs total length)
        const avgSentenceLength = text.split(/\s+/).length / sentences.length;
        if (avgSentenceLength > 15) {
            issues.push("DE_FLOW_ALERT: Sentence structure is too complex for a direct analytical tone.");
        }
    }

    return {
        pass: true,
        issues
    };
}

async function executeAIPolish(projectId, prompt) {
    const MODEL_PRIORITY = ['gemma-3-27b-it', 'gemma-3-12b-it', 'gemini-3-flash-preview'];

    return await keyManager.executeWithRetry(async (apiKey) => {
        const genAI = new GoogleGenerativeAI(apiKey);
        let lastError = null;

        for (const modelName of MODEL_PRIORITY) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    apiVersion: 'v1beta',
                    generationConfig: { maxOutputTokens: 8192, temperature: 0.4 } // Lower temp for consistency
                });

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();

                if (text && text.length > 100) {
                    if (projectId) {
                        const tokens = response.usageMetadata ? response.usageMetadata.totalTokenCount : 0;
                        await db.logAIAction(projectId, 'POLISH_SCRIPT', modelName, tokens, text);
                    }
                    return text.trim();
                }
            } catch (err) {
                lastError = err;
                const errMsg = err.message.toLowerCase();
                if (errMsg.includes('429') || errMsg.includes('quota')) continue;
                throw err;
            }
        }
        throw lastError || new Error("All models failed to polish script.");
    });
}

module.exports = { assembleScript };
