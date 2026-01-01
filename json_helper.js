function parseAIJSON(text, context = "Unknown") {
    if (!text) return [];
    try {
        // 1. Basic Cleaning
        let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        clean = clean.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

        // 2. Try Standard Parse first (Fast path with aggressive cropping)
        try {
            let jsonStart = clean.indexOf('[');
            let jsonEnd = clean.lastIndexOf(']');

            // If no array, try object
            if (jsonStart === -1) {
                jsonStart = clean.indexOf('{');
                jsonEnd = clean.lastIndexOf('}');
            }

            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                const potentialJson = clean.substring(jsonStart, jsonEnd + 1);
                const parsed = JSON.parse(potentialJson);
                if (Array.isArray(parsed)) return parsed;
                if (typeof parsed === 'object') return [parsed];
            }
        } catch (eQuick) {
            // Fall through to regex if quick parse fails
        }

        try {
            const parsed = JSON.parse(clean);
            if (Array.isArray(parsed)) return parsed;
            if (typeof parsed === 'object') return [parsed];
        } catch (eInitial) {
            console.warn(`⚠️ [JSON Parser][${context}] Normal parse failed, trying Regex Extraction...`);

            const results = [];

            // 3. REGEX IMMORTAL v2 (Flexible key order and value types)
            // Pattern to find objects containing "id" and ("p" or "image_prompt")
            // This regex finds the whole object block {...} then we'll extract from it
            const blockRegex = /\{[^{}]*"(?:image_prompt|p)"[^{}]*\}/gs;
            const blocks = clean.match(blockRegex) || [];

            for (const block of blocks) {
                try {
                    // Try to extract ID (string or number)
                    const idMatch = block.match(/"id"\s*:\s*"?(\d+)"?/);
                    // Try to extract Prompt (p or image_prompt)
                    const pMatch = block.match(/"(?:image_prompt|p)"\s*:\s*"((?:\\.|[^"\\])*)"/);

                    if (pMatch) {
                        results.push({
                            id: idMatch ? parseInt(idMatch[1]) : results.length + 1,
                            p: pMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
                        });
                    }
                } catch (e) { /* skip bad blocks */ }
            }

            if (results.length > 0) {
                console.log(`✅ [JSON Parser][${context}] Extracted ${results.length} items via block-regex.`);
                return results;
            }

            // 4. Raw Prompt Scan (Last resort)
            const promptPattern = /"(?:image_prompt|p|video_prompt)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
            let pMatch;
            let fallbackId = 1;
            while ((pMatch = promptPattern.exec(clean)) !== null) {
                results.push({
                    id: fallbackId++,
                    p: pMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
                });
            }

            if (results.length > 0) {
                console.log(`✅ [JSON Parser][${context}] Salvaged ${results.length} prompts via raw scan.`);
                return results;
            }

            console.error(`❌ [JSON Parser][${context}] All salvage methods failed.`);
            console.error(`🔍 [Debug][Raw Start]: ${clean.substring(0, 200)}...`);
            return [];
        }
    } catch (e) {
        console.error(`❌ [JSON Parser][${context}] Critical Error in Parser:`, e);
        return [];
    }
}

module.exports = { parseAIJSON };
