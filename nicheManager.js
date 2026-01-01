const NICHE_PROFILES = {
    science: {
        writer_role: "scientific documentary scriptwriter",
        tone: ["investigative", "neutral", "serious", "evidentiary"],
        speculation_level: "none",
        keyword_discipline: "strict",
        cliff_style: "mystery",
        forbidden_phrases: ["aliens confirmed", "proof of aliens"],
        emotional_arc: ["hook", "evidence", "analysis", "peak", "open_loop"],
        emotional_requirements: { logic_heavy: true, investigative_rhythm: true },
        polish_prompt: "You are a senior scientific editor. Polish only the BODY of this script for clarity, precision, and rhythm. Do NOT change facts or add emotional fluff. Improve transitions between evidence and analysis.",
        ctr_config: {
            strategy: "authority_seo",
            title_rules: {
                style: "authority_action",
                rules: "Use 1 strong core keyword. Include authority/action (confirmed, detected, revealed). 8-14 words max."
            },
            thumbnail_rules: {
                style: "cinematic_nasa",
                elements: "Subject: Mysterious object/phenomenon. Elements: red arrow, high contrast. Mood: discovery, urgency."
            }
        }
    },

    documentary: {
        writer_role: "long-form documentary storyteller",
        tone: ["serious", "narrative-driven", "immersive", "cautious"],
        speculation_level: "limited",
        keyword_discipline: "medium",
        cliff_style: "story-based",
        forbidden_phrases: [],
        emotional_arc: ["hook", "rising_action", "peak", "resolution", "open_loop"],
        emotional_requirements: { narrative_tension: true },
        polish_prompt: "You are a senior documentary editor. Polish only the BODY of this script. Maintain narrative tension and immersive flow. Smooth out transitions to maintain long-form engagement.",
        ctr_config: {
            strategy: "narrative_mystery",
            title_rules: {
                style: "mystery_hook",
                rules: "Focus on the 'Untold Story' or 'Hidden Truth'. Use intriguing narrative hooks. 10-15 words max."
            },
            thumbnail_rules: {
                style: "epic_immersive",
                elements: "Subject: Iconic historic or natural scene. Elements: subtle hidden detail, mysterious lighting."
            }
        }
    },

    self_help: {
        name: "Self Help (German Market)",
        market: "DE",
        writer_role: "psychological self-help storyteller (German Style)",
        tone: ["empathetic", "reflective", "honest", "calm", "intense", "psychological"],
        speculation_level: "free",
        keyword_discipline: "loose",
        cliff_style: "emotional-question",
        forbidden_phrases: ["buy now", "subscribe", "guaranteed success", "click here", "motivation code"],
        emotional_arc: ["hook", "pain", "awareness", "shift", "open_loop"],
        emotional_requirements: { empathy_mirror: true, reflection_signals: true, deep_psychology: true },
        visual_style: "Minimalist 2D hand-drawn doodle illustration on a muted green background (#c6d3bc)",
        visual_rules: "Simple clean lines, stick-man style characters, symbolic representation (light bulb, heart, thought bubbles), zero shading, flat colors. Like psych2go but simpler minimalist doodle art.",
        visual_mapping_strategy: "per_dialogue",
        sentence_constraints: {
            max_words_per_sentence: 14,
            preferred_structure: "declarative",
            rhetorical_questions_max: 1,
            avoid_american_style: true
        },
        cultural_rules: {
            avoid_hype: true,
            avoid_emotional_validation: false, // Empathy is allowed in self-help
            focus_on_mechanism: true,
            cause_effect_priority: true
        },
        polish_prompt: "You are a senior self-help narrative editor. Polish only the BODY. Improve emotional flow and voice delivery. Add natural pauses. Enhance empathy and reflection. Avoid motivational clichés.",
        ctr_config: {
            strategy: "emotional_curiosity",
            title_rules: {
                language_lock: "German",
                style: "direct_address",
                allowed_patterns: [
                    "Warum du dich luôn luôn einsam fühlst",
                    "So ngừngst du negative Gedanken",
                    "Das Geheimnis innerer Ruhe",
                    "Wenn du das tust, ändert sich dein Leben"
                ],
                rules: "Speak directly to 'you'. Focus on emotional pain/reflection. 6-12 words max. Formula: Emotional pain + Direct address + Curiosity gap."
            },
            thumbnail_rules: {
                style: "doodle_minimal",
                elements: "Subject: Simple doodle character in a relatable emotional state. Background: Muted green (Doodle Style)."
            }
        },
        description_style: {
            tone: "empathetic_expert",
            focus_on_value: true,
            include_reflection_questions: true
        }
    },

    dark_psychology_de: {
        name: "Dark Psychology (German Market)",
        language: "German",
        market: "DE",
        writer_role: "cold psychological analyst and behavioral observer",
        tone: ["direct", "analytical", "controlled", "cold", "non-empathetic"],
        speculation_level: "limited",
        keyword_discipline: "strict",
        sentence_constraints: {
            max_words_per_sentence: 14,
            preferred_structure: "declarative",
            rhetorical_questions_max: 1,
            avoid_american_style: true
        },
        forbidden_phrases: [
            "you deserve", "healing", "self love", "motivation",
            "everything will change", "this will save you", "believe in yourself"
        ],
        allowed_core_concepts: [
            "control", "power", "respect", "boundaries", "manipulation", "status", "social hierarchy"
        ],
        emotional_arc: [
            "hook_threat", "mechanism_exposed", "power_imbalance", "boundary_definition", "cold_resolution", "open_loop"
        ],
        cliff_style: "logical-threat",
        cultural_rules: {
            avoid_hype: true,
            avoid_emotional_validation: true,
            focus_on_mechanism: true,
            cause_effect_priority: true
        },
        hook_rules: {
            preferred_triggers: [
                "loss_of_control", "boundary_violation", "status_threat", "social_disrespect"
            ],
            forbidden_triggers: [
                "urgency", "false_hope", "emotional_healing"
            ]
        },
        ctr_config: {
            strategy: "power_control",
            title_rules: {
                language_lock: "German",
                length_words: [6, 12],
                style: "direct_statement",
                allowed_patterns: [
                    "Warum Menschen dich không respektieren",
                    "So verlieren Manipulatoren die Kontrolle",
                    "Das ist psychologische Manipulation",
                    "Wenn du das tust, verlierst du Respekt"
                ],
                forbidden_patterns: [
                    "Do this once", "This will change", "Secret trick", "You will feel better"
                ]
            },
            thumbnail_rules: {
                language_lock: "German",
                text_max_words: 2,
                all_caps: true,
                no_exclamation: true,
                preferred_words: ["KONTROLLE", "RESPEKT", "MANIPULATION", "NICHT TUN", "GRENZE"],
                color_palette: ["gray", "white", "red_accent"],
                style: "minimal",
                emotion: "cold_tension",
                forbidden_elements: ["emoji", "smiling_faces", "motivational_pose"]
            }
        },
        script_validation: {
            over_empathy_check: true,
            over_smoothing_check: true,
            logic_gap_check: true,
            american_tone_check: true
        },
        polish_prompt: "Polish for clarity and logical flow only. Remove emotional softening. Shorten sentences. Maintain a cold, analytical tone. Do NOT add empathy, motivation, or reassurance.",
        description_style: {
            tone: "informative",
            avoid_storytelling: true,
            focus_on_explanation: true
        },
        visual_mapping_strategy: "per_dialogue"
    },


    void_chaser: {
        writer_role: "thriller and mystery documentary storyteller",
        tone: ["suspenseful", "dark", "mysterious", "intense", "chilling", "investigative"],
        speculation_level: "limited",
        keyword_discipline: "medium",
        cliff_style: "mystery",
        forbidden_phrases: ["happy ending", "all explained"],
        emotional_arc: ["hook", "mystery", "escalation", "revelation", "peak", "open_loop"],
        emotional_requirements: { narrative_tension: true, suspense_building: true },
        polish_prompt: "You are a senior thriller editor. Polish for maximum suspense. Use short, punchy sentences. Maintain a sense of impending revelation or dread.",
        ctr_config: {
            strategy: "narrative_mystery",
            title_rules: {
                style: "mystery_hook",
                rules: "Focus on the 'Untold Story' or 'Hidden Truth'. Use intriguing narrative hooks. 10-15 words max."
            },
            thumbnail_rules: {
                style: "epic_immersive",
                elements: "Subject: Iconic historic or natural scene. Elements: subtle hidden detail, mysterious lighting."
            }
        }
    },

    health: {
        writer_role: "medical and wellness guide",
        tone: ["authoritative", "cautious", "informative", "balanced"],
        speculation_level: "none",
        keyword_discipline: "strict",
        cliff_style: "health-tip",
        requires_disclaimer: true,
        forbidden_phrases: ["cure for cancer", "guaranteed weight loss"],
        emotional_arc: ["hook", "symptom", "explanation", "solution", "open_loop"],
        emotional_requirements: { cautious_authority: true },
        polish_prompt: "You are a senior medical editor. Polish only the BODY. Ensure clarity and cautious authority. Smooth out biology-to-lifestyle transitions. Accurate but accessible.",
        ctr_config: {
            strategy: "cautionary_benefit",
            title_rules: {
                style: "biological_truth",
                rules: "Focus on a specific body change or hidden symptom. Use 'Why...' or 'The Truth about...'. 8-12 words max."
            },
            thumbnail_rules: {
                style: "medical_aesthetic",
                elements: "Subject: Biological visualization or symbolic health object. Elements: clean medical aesthetic, clear focal point."
            }
        }
    }
};

const CLIFF_RULES = {
    "mystery": "End with an unresolved factual question that raises a mystery or uncertainty",
    "emotional-question": "End with a reflective emotional question that challenges the viewer's current mindset",
    "health-tip": "End with an actionable but incomplete insight that encourages watching the next module to understand the full mechanism",
    "story-based": "End with a narrative tension point or an unresolved story development",
    "logical-threat": "End with a direct logical warning or a boundary-based consequence that forces reflection on power dynamics"
};

const ROLE_PROPERTIES = {
    // Self-help / Dark Psychology roles
    PAIN: { intensity: "high", word_bias: -50 },
    STORY: { intensity: "medium", word_bias: 0 },
    INSIGHT: { intensity: "medium", word_bias: +20 },
    REALIZATION: { intensity: "peak", word_bias: +50 },
    SHIFT: { intensity: "peak", word_bias: +30 },

    // DE Dark Psych Roles
    HOOK_THREAT: { intensity: "high", word_bias: -20 },
    MECHANISM_EXPOSED: { intensity: "high", word_bias: +10 },
    POWER_IMBALANCE: { intensity: "medium", word_bias: 0 },
    BOUNDARY_DEFINITION: { intensity: "medium", word_bias: +20 },
    COLD_RESOLUTION: { intensity: "peak", word_bias: +40 },

    // Science / Documentary roles
    PEAK: { intensity: "peak", word_bias: +50 },
    ANALYSIS: { intensity: "medium", word_bias: +10 },
    TURNING_POINT: { intensity: "peak", word_bias: +30 },

    // Default fallback
    DEFAULT: { intensity: "medium", word_bias: 0 }
};

const ROLE_MAP = {
    science: ["HOOK", "CONTEXT", "DISCOVERY", "EVIDENCE", "ANALYSIS", "THEORY", "PEAK", "RECAP", "OPEN_END"],
    documentary: ["HOOK", "EXPOSITION", "RISING_ACTION", "COMPLICATION", "TURNING_POINT", "PEAK", "RESOLUTION", "OPEN_END"],
    self_help: ["HOOK", "PAIN", "STORY", "INSIGHT", "SHIFT", "REALIZATION", "REFRAME", "OPEN_END"],
    dark_psychology_de: ["HOOK_THREAT", "MECHANISM_EXPOSED", "POWER_IMBALANCE", "BOUNDARY_DEFINITION", "COLD_RESOLUTION", "OPEN_LOOP"],
    health: ["HOOK", "SYMPTOM", "BIOLOGY", "LIFESTYLE", "SOLUTION", "PEAK", "ACTION_PLAN", "OPEN_END"],
    void_chaser: ["HOOK", "MYSTERY_SETUP", "INVESTIGATION", "ESCALATION", "REVELATION", "PEAK", "RECAP", "OPEN_END"]
};

function getProfile(niche) {
    return NICHE_PROFILES[niche] || NICHE_PROFILES.documentary;
}

function getNicheConfig(niche) {
    return getProfile(niche);
}

function getRoles(niche) {
    return ROLE_MAP[niche] || ROLE_MAP.documentary;
}

function getRoleProperty(role) {
    return ROLE_PROPERTIES[role] || ROLE_PROPERTIES.DEFAULT;
}

const ARC_STAGE_MAP = {
    hook: ["HOOK", "HOOK_THREAT"],
    pain: ["PAIN", "MECHANISM_EXPOSED"],
    symptom: ["SYMPTOM"],
    evidence: ["EVIDENCE", "DISCOVERY", "CONTEXT", "POWER_IMBALANCE"],
    rising_action: ["EXPOSITION", "RISING_ACTION", "COMPLICATION", "BOUNDARY_DEFINITION", "STORY"],
    analysis: ["ANALYSIS", "THEORY"],
    explanation: ["BIOLOGY", "LIFESTYLE", "CONTEXT"],
    awareness: ["INSIGHT", "REALIZATION"],
    shift: ["SHIFT", "REFRAME"],
    solution: ["SOLUTION", "ACTION_PLAN", "COLD_RESOLUTION"],
    peak: ["PEAK", "TURNING_POINT", "REALIZATION", "SHIFT"],
    resolution: ["RESOLUTION", "RECAP"],
    open_loop: ["OPEN_END", "OPEN_LOOP"]
};

function getCliffRule(style) {
    return CLIFF_RULES[style] || "End with a strong, curiosity-inducing cliffhanger sentence.";
}

module.exports = {
    NICHE_PROFILES,
    ROLE_MAP,
    ROLE_PROPERTIES,
    CLIFF_RULES,
    ARC_STAGE_MAP,
    getProfile,
    getNicheConfig,
    getRoles,
    getRoleProperty,
    getCliffRule
};
