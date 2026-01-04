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

    dark_psychology_de: {
        name: "Dark Psychology DE (Mr No Plan A)",
        language: "German",
        market: "DE",
        writer_role: "cold psychological analyst and senior behavioral observer (Style: Mr No Plan A)",
        tone: ["cold", "analytical", "authoritative", "direct", "unemotional", "logic-driven"],
        speculation_level: "limited",
        keyword_discipline: "strict",
        sentence_constraints: {
            max_words_per_sentence: 45,
            preferred_structure: "declarative",
            rhetorical_questions_max: 1,
            avoid_american_style: true
        },
        forbidden_phrases: [
            "stell dir vor", "dunkler wald", "herzschmerz", "traurig", "vielleicht",
            "you deserve", "healing", "self love", "motivation",
            "everything will change", "this will save you", "believe in yourself",
            "buy now", "subscribe", "guaranteed success", "click here", "motivation code"
        ],
        allowed_core_concepts: [
            "System", "Signal", "Kontrolle", "Strategie", "Macht", "Fakt", "Dominanz", "Status"
        ],
        gold_standard_samples: [
            "Warum wirst du immer wieder respektlos behandelt? Es ist kein Zufall. Und es ist auch kein Pech. Es ist ein System. Du sendest unbewusst Signale aus, die anderen sagen: 'Du kannst mit mir machen, was du willst.'",
            "Hör auf, dich zu erklären. Wenn dich jemand angreift hoặc kritisiert, ist dein erster Instinkt: Verteidigung. Das ist ein Fehler. In dem Moment, in dem du dich rechtfertigst, ordnest du dich unter.",
            "Narzissten und Manipulatoren suchen keine Lösung. Sie suchen eine Reaktion. Deine Wut, deine Tränen, deine Argumente – das là ihr Treibstoff. Wenn du emotional reagierst, haben sie gewonnen."
        ],
        emotional_arc: [
            "hook_threat", "mechanism_exposed", "power_imbalance", "boundary_definition", "cold_resolution", "open_loop"
        ],
        cliff_style: "logical-threat",
        visual_style: "Dark, high-contrast cinematic clinical atmosphere. Minimalist, cold tones (slate, deep red accents). Professional behavioral analysis vibe.",
        visual_rules: "Cold office settings, psychological observation rooms, blueprints of human behavior, high-contrast eyes, sharp shadows. No smiling, no friendly colors.",
        visual_mapping_strategy: "per_dialogue",
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
        polish_prompt: "You are a senior cold-logic editor. Remove ALL poetic metaphors, melancholic storytelling, and emotional softening. Shorten sentences. Use punchy, authoritative German. Ensure it sounds like a clinical behavioral analysis, not a novel (Style: Mr No Plan A).",
        description_style: {
            tone: "informative",
            avoid_storytelling: true,
            focus_on_explanation: true
        },
        pipeline_settings: {
            target_words_per_block: 1500,
            num_blocks: 3,
            target_language: "German",
            voice_id: "oae6GCCzwoEbfc5FHdEu" // Fallback ID for GenAI
        }
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
    hook_threat: ["HOOK_THREAT"], // Specific for LEGO_MICRO
    mechanism_exposed: ["MECHANISM_EXPOSED"], // Specific for LEGO_MICRO
    pain: ["MECHANISM_EXPOSED"],
    symptom: ["SYMPTOM"],
    power_imbalance: ["POWER_IMBALANCE"], // Specific for LEGO_MICRO
    evidence: ["EVIDENCE", "DISCOVERY", "CONTEXT", "POWER_IMBALANCE"],
    boundary_definition: ["BOUNDARY_DEFINITION"], // Specific for LEGO_MICRO
    rising_action: ["EXPOSITION", "RISING_ACTION", "COMPLICATION", "BOUNDARY_DEFINITION"],
    analysis: ["ANALYSIS", "THEORY"],
    explanation: ["BIOLOGY", "LIFESTYLE", "CONTEXT"],
    awareness: ["INSIGHT", "REALIZATION"],
    shift: ["SHIFT", "REFRAME"],
    cold_resolution: ["COLD_RESOLUTION"], // Specific for LEGO_MICRO
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
