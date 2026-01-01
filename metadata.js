const { GoogleGenerativeAI } = require('@google/generative-ai');
const keyManager = require('./keyManager');
const { getProfileData } = require('./profiles');
const { log } = require('./colors');

/**
 * Module: Metadata Generator
 * Tạo Title, Description, Thumbnail Prompt theo SHU Formula
 * Chạy song song sau khi script hoàn thành
 */

const { parseAIJSON } = require('./json_helper');

// Xử lý bằng parseAIJSON trực tiếp

/**
 * Generate Titles (3 variants theo SHU formula)
 * Formula: [Keyword] + Action Verb + Emotion/Time
 */
async function generateTitles(scriptSummary, keywords, profileRules, projectId) {
    const prompt = `
    Role: Senior YouTube Title Specialist (SHU Formula Expert)
    
    CONTEXT:
    - Script Summary: "${scriptSummary}"
    - Core Keyword: "${keywords.core}"
    - Supporting Keywords: ${JSON.stringify(keywords.support || [])}
    - CTR Phrases: ${JSON.stringify(keywords.ctr_phrases || ['IT\'S HAPPENING', '5 MINUTES AGO', 'SCIENTISTS IN SHOCK'])}
    
    ${profileRules?.title_rules ? `CUSTOM RULES FROM PROFILE:\n${profileRules.title_rules}` : ''}
    
    SHU TITLE FORMULA:
    [Keyword] + [Action Verb] + [Emotion/Time Trigger]
    
    Examples:
    - Voyager 2 Just Sent a Terrifying Signal 5 Minutes Ago
    - NASA CONFIRMED Voyager 2's Strange Transmission — Scientists in Shock  
    - This Just Happened: Voyager 2 Detected an Unexplained Energy Pulse
    
    REQUIREMENTS:
    1. Create 3 title variants for A/B testing
    2. Each title MUST contain the core keyword
    3. Include action verbs: Just, Detected, Confirmed, Revealed, Discovered
    4. Include emotion/time triggers from CTR phrases
    5. Max 60-70 characters per title
    6. LANGUAGE REQUIREMENT: ALWAYS OUTPUT TITLES IN ENGLISH.
    
    OUTPUT FORMAT (JSON ONLY):
    {
        "titles": [
            { "id": 1, "text": "Title 1...", "type": "primary" },
            { "id": 2, "text": "Title 2...", "type": "ab_test" },
            { "id": 3, "text": "Title 3...", "type": "ab_test" }
        ]
    }
    `;

    return await keyManager.executeWithRetry(async (apiKey) => {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: 'gemma-3-27b-it',
            apiVersion: 'v1beta'
        });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // --- AI LOGGING ---
        if (projectId) {
            const tokens = response.usageMetadata ? response.usageMetadata.totalTokenCount : 0;
            await db.logAIAction(projectId, 'GENERATE_TITLES', 'gemma-3-27b-it', tokens, text);
        }

        return parseAIJSON(text, "GENERATE_TITLES");
    });
}

/**
 * Generate Description (200-350 words, SEO optimized)
 */
async function generateDescription(scriptSummary, keywords, profileRules, language = 'English', projectId) {
    const prompt = `
    Role: Senior YouTube SEO Copywriter & Topic Researcher
    
    CONTEXT:
    - Script Summary: "${scriptSummary}"
    - Core Keyword: "${keywords.core}"
    - Supporting Keywords: ${JSON.stringify(keywords.support || [])}
    - Language: English (REQUIRED)
    
    ${profileRules?.description_rules ? `CUSTOM RULES FROM PROFILE:\n${profileRules.description_rules}` : ''}
    
    HIGH-QUALITY SEO DESCRIPTION STRUCTURE (APPROX 500 WORDS):
    1. THE HOOK (FIRST 2-3 SENTENCES): Must include core keyword. Make it urgent and fascinating.
    2. DEEP DIVE ANALYSIS (200-250 words): Go beyond the script. Provide scientific context, historical background, or broader implications related to "${keywords.core}". Use 3-5 supporting keywords naturally. Explain the "WHY" behind the discovery.
    3. DETAILED SUMMARY (150-200 words): Summarize the key points covered in the video chapters. Mention specific segments like ATLAS-3I, The Giant, or Voyager 2 where applicable.
    4. TIMESTAMPS: Add placeholder timestamps.
    5. CTA & ENGAGEMENT: Compelling request to subscribe and a thought-provoking question for the comments.
    6. SOURCES & TAGS: Placeholder for links + 15 relevant hashtags.
    
    REQUIREMENTS:
    - Total length MUST be between 450-550 words.
    - Style: Authoritative, cinematic, and intellectually stimulating.
    - No fluff. Every sentence must add value or context.
    
    OUTPUT FORMAT (JSON ONLY):
    {
        "description": "Full high-depth 500-word description text here...",
        "word_count": 500,
        "keywords_used": ["keyword1", "keyword2", ...]
    }
    `;

    return await keyManager.executeWithRetry(async (apiKey) => {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: 'gemma-3-27b-it',
            apiVersion: 'v1beta'
        });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // --- AI LOGGING ---
        if (projectId) {
            const tokens = response.usageMetadata ? response.usageMetadata.totalTokenCount : 0;
            await db.logAIAction(projectId, 'GENERATE_DESCRIPTION', 'gemma-3-27b-it', tokens, text);
        }

        return parseAIJSON(text, "GENERATE_DESCRIPTION");
    });
}

/**
 * Generate Thumbnail Prompt (for Midjourney/Whisk)
 * Template: focal object + red arrow + golden flare + 3-4 word text
 */
async function generateThumbnailPrompt(keywords, profileRules, scriptSummary, projectId, selectedTitle = "") {
    const prompt = `
    Role: Thumbnail Prompt Engineer for YouTube (Midjourney/Stable Diffusion)
    
    CONTEXT:
    - Core Keyword: "${keywords.core}"
    - Selected Title: "${selectedTitle}"
    - Script Summary: "${scriptSummary}"
    
    ${profileRules?.thumb_rules || profileRules?.thumb_prompt_rules ? `CUSTOM THUMBNAIL RULES FROM PROFILE:\n${profileRules.thumb_rules || profileRules.thumb_prompt_rules}` : ''}
    
    THUMBNAIL FORMULA (SHU Standard):
    1. THEME: The thumbnail MUST visually represent the Selected Title: "${selectedTitle}".
    2. ONE focal object (large, dramatic, directly related to the title)
    3. Red arrow or red circle pointing to focal point
    4. Golden/orange flare effect (warm tones)
    5. Short text overlay: 2-4 words, ALL CAPS (Should match part of the title or CTR phrase)
    6. Cinematic 16:9, ultra sharp, NASA/Documentary style
    
    REQUIREMENTS:
    - Output a SINGLE prompt for AI image generation
    - Ensure the visual narrative matches the "Selected Title" exactly.
    - Style: Realistic, Cinematic, 8K. NO people faces.
    
    OUTPUT FORMAT (JSON ONLY):
    {
        "thumbnail_prompt": "A massive glowing [object] related to [Title] in deep space with intense golden flare, red arrow pointing to the core, dramatic contrast, cinematic 16:9 thumbnail, bold short text '[OVERLAY]', NASA style, ultra sharp, no human faces --ar 16:9",
        "text_overlay": "SHORT TEXT",
        "focal_object": "object name",
        "style": "cinematic"
    }
    `;

    return await keyManager.executeWithRetry(async (apiKey) => {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: 'gemma-3-27b-it',
            apiVersion: 'v1beta'
        });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // --- AI LOGGING ---
        if (projectId) {
            const tokens = response.usageMetadata ? response.usageMetadata.totalTokenCount : 0;
            await db.logAIAction(projectId, 'GENERATE_THUMBNAIL', 'gemma-3-27b-it', tokens, text);
        }

        return parseAIJSON(text, "GENERATE_THUMBNAIL");
    });
}

const db = require('./database');

/**
 * Main function: Generate all metadata in parallel
 */
async function generateMetadata(req, res) {
    try {
        const { scriptSummary, keywords, profileId, language, projectId } = req.body;

        if (!scriptSummary || (!keywords?.core && !projectId)) {
            return res.json({ success: false, error: 'Missing scriptSummary or keywords/projectId' });
        }

        // --- SHU: Fetch Keywords from DB if ProjectId exists ---
        let activeKeywords = keywords;
        if (projectId && !keywords?.core) {
            const ks = await db.db.get('SELECT * FROM keyword_sets WHERE project_id = ?', [projectId]);
            if (ks) {
                activeKeywords = {
                    core: ks.core_keyword,
                    support: JSON.parse(ks.support_keywords),
                    ctr_phrases: JSON.parse(ks.ctr_phrases)
                };
            }
        }

        console.log(`📝 Generating Metadata for: "${activeKeywords?.core || 'Unknown'}"...`);

        // Load profile rules if provided
        let profileRules = {};
        if (profileId) {
            const profile = getProfileData(profileId);
            if (profile?.metadata_settings) {
                profileRules = profile.metadata_settings;
            }
        }

        // Generate Titles and Description in parallel
        const [titlesData, descData] = await Promise.all([
            generateTitles(scriptSummary, activeKeywords, profileRules, projectId),
            generateDescription(scriptSummary, activeKeywords, profileRules, language, projectId)
        ]);

        // Get the primary title to guide the thumbnail generation
        const mainTitle = titlesData?.titles?.[0]?.text || activeKeywords.core;

        // Generate Thumbnail Prompt based on the selected title
        const thumbData = await generateThumbnailPrompt(activeKeywords, profileRules, scriptSummary, projectId, mainTitle);

        const responseData = {
            titles: titlesData?.titles || [],
            description: descData?.description || '',
            description_word_count: descData?.word_count || 0,
            thumbnail_prompt: thumbData?.thumbnail_prompt || '',
            thumbnail_text: thumbData?.text_overlay || '',
            thumbnail_focal: thumbData?.focal_object || ''
        };

        // --- SHU: Persist SEO Bundle ---
        if (projectId) {
            try {
                await db.db.run(
                    'INSERT OR REPLACE INTO seo_bundles (project_id, titles, description_text, tags, thumbnail_text, thumbnail_prompt) VALUES (?, ?, ?, ?, ?, ?)',
                    [
                        projectId,
                        JSON.stringify(responseData.titles),
                        responseData.description,
                        JSON.stringify([]), // Tags could be extracted from desc if needed
                        responseData.thumbnail_text,
                        responseData.thumbnail_prompt
                    ]
                );
                log.info(`📦 SEO Bundle saved for Project: ${projectId}`);
            } catch (dbErr) {
                log.error(`⚠️ DB Error saving SEO Bundle: ${dbErr.message}`);
            }
        }

        res.json({
            success: true,
            data: responseData
        });

    } catch (e) {
        console.error('Metadata Gen Error:', e);
        res.json({ success: false, error: e.message });
    }
}

module.exports = { generateMetadata };
