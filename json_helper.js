function parseAIJSON(text, context = "Unknown") {
    if (!text) return null;
    try {
        // 1. Basic Cleaning
        let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        clean = clean.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

        // 1.5 SELF-HEAL: Attempt to fix truncated JSON (common in AI responses)
        if (clean.includes('{') && !clean.includes('}')) {
            console.warn(`⚠️ [JSON Parser][${context}] Truncated object detected. Attempting to fix...`);
            clean += '"}'; // Minimal fix for string/object closure
        }
        if (clean.startsWith('[') && !clean.endsWith(']')) {
            console.warn(`⚠️ [JSON Parser][${context}] Truncated array detected. Attempting to fix...`);
            clean += '}]';
        }

        // 2. Try Standard Parse first
        try {
            const parsed = JSON.parse(clean);
            if (Array.isArray(parsed)) return parsed.length > 0 ? parsed : null;
            if (typeof parsed === 'object' && parsed !== null) return [parsed];
        } catch (eInitial) {
            // Extraction logic
            let jsonStart = clean.indexOf('[');
            let jsonEnd = clean.lastIndexOf(']');

            if (jsonStart === -1) {
                jsonStart = clean.indexOf('{');
                jsonEnd = clean.lastIndexOf('}');
            }

            if (jsonStart !== -1 && (jsonEnd === -1 || jsonEnd < jsonStart)) {
                // Heuristic: Close the JSON if it looks truncated
                console.warn(`⚠️ [JSON Parser][${context}] Bad boundaries. Closing JSON manually.`);
                const sub = clean.substring(jsonStart) + (clean.startsWith('[') ? '"}]' : '"}');
                try {
                    const parsed = JSON.parse(sub);
                    return Array.isArray(parsed) ? (parsed.length > 0 ? parsed : null) : [parsed];
                } catch (e) { }
            }

            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                try {
                    const potentialJson = clean.substring(jsonStart, jsonEnd + 1);
                    const parsed = JSON.parse(potentialJson);
                    if (Array.isArray(parsed)) return parsed.length > 0 ? parsed : null;
                    if (typeof parsed === 'object') return [parsed];
                } catch (eSub) { }
            }
        }

        // 3. REGEX SALVAGE (Final fallback)
        const results = [];
        const promptPattern = /"(?:image_prompt|p|video_prompt|content|cliffhanger)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
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
            console.log(`✅ [JSON Parser][${context}] Salvaged ${results.length} items via regex.`);
            return results;
        }

        return null; // Ensure null on failure to trigger proper catch blocks
    } catch (e) {
        console.error(`❌ [JSON Parser][${context}] Critical Error:`, e.message);
        return null;
    }
}

module.exports = { parseAIJSON };
