/**
 * Prompt Engine Module
 * Chịu trách nhiệm xây dựng cấu trúc prompt cho AI dựa trên dữ liệu từ Profile.
 * Giúp tách biệt "luật ngầm" ra khỏi code chính.
 */

function buildImageRules(visualSettings) {
    const {
        style_prompt = '',
        visual_style = '',
        visual_rules = '',
        aspect_ratio = '16:9',
        camera_angle = 'cinematic',
        object_consistency = '',
        image_rules = ''
    } = visualSettings;

    const isPsycho = (visual_style + style_prompt + visual_rules).toLowerCase().includes('psychology') ||
        (visual_style + style_prompt + visual_rules).toLowerCase().includes('behavioral');

    // Default Fallback Rules
    let rules = visual_rules || image_rules || `
[STRICT ZERO-HALLUCINATION PROTOCOL]
1. NO COLLAGES: Strictly FORBID "split-screens", "montages", "gallery views", "multiple perspectives".
2. SINGLE UNIFIED PERSPECTIVE: One cinematic shot.
3. PHYSICAL REALISM: No floating objects.
4. ANTI-CGI GRAPHICS: News/Social media MUST be on physical screens.
5. NO TYPOGRAPHY: No floating text.
`;

    if (isPsycho) {
        rules += `
[DARK PSYCHOLOGY CLINICAL STYLE]
- Lighting: Harsh clinical overhead lights, deep high-contrast shadows.
- Materials: Brushed steel, reinforced glass, slate tiles, sterile surfaces.
- Vibe: Behavioral observation room, CCTV aesthetics, cold and analytical.
- Colors: Desaturated, monochromatic with occasional deep crimson accents.
`;
    }

    const isDoodle = (visual_style + style_prompt).toLowerCase().includes('doodle') || (visual_rules + image_rules).toLowerCase().includes('doodle');

    // Append dynamic parameters
    let finalRules = `
${rules}

[STRICT STYLE & SPECS]
STYLE: ${visual_style || style_prompt || 'Cinematic, 8K, Photorealistic, Grounded Realism'}.
${isDoodle ? 'NOTE: This is a minimalist 2D illustration. Focus on clean lines and flat colors. Skip complex lighting/camera optics.' : `CAMERA: ${camera_angle}.`}
AR: --ar ${aspect_ratio}.
CONSISTENCY: ${object_consistency || 'Maintain strict subject identity'}.
`;

    return finalRules;
}

function buildVideoRules(visualSettings) {
    const { video_rules = '', scene_duration = 8 } = visualSettings;
    let rules = video_rules || `
[STRICT VIDEO ACTION PROTOCOL]
1. DENSITY: MIN 300 words of Artistic Physical Action Prose.
2. DURATION: EXACTLY ${scene_duration} SECONDS.
3. NO CGI: Real-world optics only.
4. PHYSICS: Consistent light and momentum.
`;
    if (!rules.includes("JSON")) rules += `\n5. JSON FORMAT REQUIRED.`;
    if (!rules.includes("TRANSITION")) rules += `\n6. TRANSITION LOGIC REQUIRED.`;
    return rules;
}

function buildImageBatchPrompt(batchScenes, previousPrompt, imageRules, aspectRatio) {
    return `
### COMPLIANCE PROTOCOL: ELITE VISUAL ARCHITECT
ROLE: Expert DP specialized in high-end cinematography and clinical behavioral observation.

INPUT DATA:
- Scenes: ${JSON.stringify(batchScenes)}
- Context: "${previousPrompt || 'Start of chapter'}"
- Rules: "${imageRules}"

### PROMPT ARCHITECTURE:
Each "p" string must follow the "Mr No Plan A" aesthetics: cold, analytical, high-detail.
Strictly avoid people smiling or generic stock photo looks.

OUTPUT FORMAT: Return JSON Array ONLY: [{"id": N, "p": "TECHNICAL SPECS + DETAILED ARTISTIC PROSE --ar ${aspectRatio} --v 6.0 --style raw"}]
`;
}

function buildVideoBatchPrompt(videoContexts, videoRules, isNPlusOne) {
    return `
### TASK: Generate Advanced Motion Prompts for Scenes
RULES: ${videoRules}

### INPUT DATA:
${JSON.stringify(videoContexts)}

### OUTPUT FORMAT (MANDATORY JSON ARRAY):
Return a JSON array of objects.
`;
}

module.exports = {
    buildImageRules,
    buildVideoRules,
    buildImageBatchPrompt,
    buildVideoBatchPrompt
};
