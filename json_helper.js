function parseAIJSON(text, context = "Unknown") {
    if (!text) return null;
    try {
        // 1. Basic Cleaning
        let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        clean = clean.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

        // 2. Try Standard Parse first (after deep cleaning)
        const jsonMatch = clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (jsonMatch) {
            const potential = jsonMatch[0];
            try {
                const parsed = JSON.parse(potential);
                if (Array.isArray(parsed)) return parsed.length > 0 ? parsed : null;
                if (typeof parsed === 'object' && parsed !== null) return [parsed];
            } catch (e) {
                // Parse failed, proceed to salvage
            }
        }

        // 3. REGEX SALVAGE (Final fallback - Extremely Aggressive)
        // This picks up "key": "value" patterns even if JSON is broken
        const results = [];

        // Specific for Script Modules
        const content = extractField(clean, "content");
        const cliff = extractField(clean, "cliffhanger");
        const index = extractField(clean, "module_index") || "1";

        if (content) {
            results.push({
                module_index: parseInt(index),
                content: content,
                cliffhanger: cliff || ""
            });
            console.log(`✅ [JSON Parser][${context}] Salvaged script module via deep regex.`);
            return results;
        }

        // Generic salvage for lists (prompts, etc)
        const promptPattern = /"(?:image_prompt|p|video_prompt|content)"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
        let pMatch;
        let fallbackId = 1;
        while ((pMatch = promptPattern.exec(clean)) !== null) {
            results.push({
                id: fallbackId++,
                p: pMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'),
                content: pMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
            });
        }

        if (results.length > 0) {
            console.log(`✅ [JSON Parser][${context}] Salvaged ${results.length} items via generic regex.`);
            return results;
        }

        return null;
    } catch (e) {
        console.error(`❌ [JSON Parser][${context}] Critical Error:`, e.message);
        return null;
    }
}

/**
 * Thần chú bóc tách trường dữ liệu từ text rác
 */
function extractField(text, fieldName) {
    // Tìm "fieldName": "value" hoặc 'fieldName': 'value'
    const patterns = [
        new RegExp(`"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i"),
        new RegExp(`'${fieldName}'\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'`, "i"),
        new RegExp(`"${fieldName}"\\s*:\\s*(\\d+)`, "i") // For numbers like module_index
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            if (pattern.source.includes("\\d+")) return match[1];
            return match[1].replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, '\n').trim();
        }
    }
    return null;
}

module.exports = { parseAIJSON };
