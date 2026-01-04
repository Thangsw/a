function parseAIJSON(text, context = "Unknown") {
    if (!text) return null;
    try {
        // 1. Deep Cleaning
        // Remove markdown fences first
        let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
        // Remove non-printable characters
        clean = clean.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "").trim();

        // 2. Identify JSON Boundaries (Aggressive)
        const firstCurly = clean.indexOf('{');
        const firstBracket = clean.indexOf('[');
        const lastCurly = clean.lastIndexOf('}');
        const lastBracket = clean.lastIndexOf(']');

        let start = -1;
        let end = -1;

        // Prefer the outer-most structure
        if (firstCurly !== -1 && (firstBracket === -1 || firstCurly < firstBracket)) {
            start = firstCurly;
            end = lastCurly;
        } else if (firstBracket !== -1) {
            start = firstBracket;
            end = lastBracket;
        }

        if (start !== -1 && end !== -1 && end > start) {
            const jsonBody = clean.substring(start, end + 1);
            try {
                const parsed = JSON.parse(jsonBody);
                if (Array.isArray(parsed)) return parsed.length > 0 ? parsed : null;
                if (typeof parsed === 'object' && parsed !== null) return [parsed];
            } catch (e) {
                console.warn(`⚠️ [JSON Parser][${context}] JSON.parse failed on extracted body: ${e.message}`);
                // Proceed to salvage
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
