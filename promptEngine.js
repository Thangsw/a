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

    // Default Fallback Rules if image_rules is empty
    let rules = visual_rules || image_rules || `
[STRICT ZERO-HALLUCINATION PROTOCOL]
1. NO COLLAGES: Strictly FORBID "split-screens", "montages", "gallery views", "multiple perspectives".
2. SINGLE UNIFIED PERSPECTIVE: One cinematic shot.
3. PHYSICAL REALISM: No floating objects.
4. ANTI-CGI GRAPHICS: News/Social media MUST be on physical screens.
5. NO TYPOGRAPHY: No floating text.
`;

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

    // Default Fallback Rules
    let rules = video_rules || `
[STRICT VIDEO ACTION PROTOCOL]
1. DENSITY: MIN 300 words of Artistic Physical Action Prose.
2. DURATION: EXACTLY ${scene_duration} SECONDS.
3. NO CGI: Real-world optics only.
4. PHYSICS: Consistent light and momentum.
`;

    // Ensure formatting and transition logic is always present even in fallback
    if (!rules.includes("JSON")) {
        rules += `\n5. JSON FORMAT REQUIRED: MUST return an object with video_specs and artistic_prose.`;
    }
    if (!rules.includes("TRANSITION")) {
        rules += `\n6. TRANSITION LOGIC (for N+1): Create a logical journey from Image A (Start) to Image B (End).`;
    }

    return rules;
}

function buildImageBatchPrompt(batchScenes, previousPrompt, imageRules, aspectRatio) {
    return `
### COMPLIANCE PROTOCOL: ELITE VISUAL ARCHITECT
ROLE: You are an expert DP specialized in high-end cinematography and material physics.

INPUT DATA:
- Scenes: ${JSON.stringify(batchScenes)}
- Context: "${previousPrompt || 'Start of chapter'}"
- Rules: "${imageRules}"

### PROMPT ARCHITECTURE:
Each "p" string must ensure 100% physical realism and massive detail.

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
Return a JSON array of objects. Each object MUST have this structure:
{
  "id": N,
  "video_specs": {
    "camera_move": "[1] Movement (STATIC/PAN/TILT/DOLLY/TRUCK/ORBIT/COMBO/TIME-LAPSE), [2] To—From Specs. VD: 'pan right 45° over 8s speed 5.625°/s'",
    "subject_motion": "[3] Subject moves (from—to state), [4] Motion reason, [5] Secondary motions",
    "lighting_time": "[6] Lighting shift, [7] Shadow rotation, [9] Time-lapse",
    "physics_focus": "[8] Focus, [10] Physics (momentum, friction, gravity)",
    "continuity": "[11] Transition (DISSOLVE/MATCH CUT/BRIDGE), [12] Flow progression"
  },
  "artistic_prose": "Massive detailed prose (Min 300 words) for motion. Use technical values like 'tilt up 60° over 5s'.",
  "cliffhanger_note": "End-state camera position and view for continuity."
}

${isNPlusOne ? `### BRIDGE LOGIC: Create the logical journey between 'start_image_prompt' and 'end_image_prompt'.` : `### INTERNAL LOGIC: Focus on micro-motions within the provided 'image_prompt'.`}
`;
}

module.exports = {
    buildImageRules,
    buildVideoRules,
    buildImageBatchPrompt,
    buildVideoBatchPrompt
};
