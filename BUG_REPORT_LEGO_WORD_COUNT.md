# 🚨 BUG REPORT: LEGO Mode Word Count Deficit

**Bug ID:** NEW CRITICAL #5
**Severity:** 🔴🔴🔴 CRITICAL
**Status:** 🚨 ACTIVE - Blocking production
**Discovered:** 03/01/2026
**Reporter:** User (via voice generation issue)
**File:** Multiple files (modulePlanner.js, scriptGenerator.js, compilationAssembler.js)

---

## 📋 USER REPORT

**Yêu cầu:**
- 3 arcs (micro-videos)
- Mỗi arc: 1500 từ
- Total: 4500 từ
- Gộp lại thành 1 clip lớn

**Thực tế khi gen voice:**
- Mỗi arc chỉ có: **~500 từ** (~5 phút audio)
- **Thiếu 1000 từ mỗi arc!** ❌
- Total thực tế: ~1500 từ thay vì 4500 từ

---

## 🔍 ROOT CAUSE ANALYSIS

### **FLOW HIỆN TẠI (LEGO Mode)**

```
User Input: legoMode=true, word_count=4500, niche='dark_psychology_de'
     ↓
STEP 1: Generate 3 Micro-Topics (microTopicGenerator.js)
   • Returns: 3 topics với outline
   • ✅ OK - Chỉ để reference
     ↓
STEP 2: Module Planner (modulePlanner.js) - 🚨 PROBLEM START
   • Called ONCE for all 3 topics
   • Input: targetWords = 4500
   • scaleFactor = 4500 / 5000 = 0.9 ⚠️
   • Plans 8-10 modules total (not per topic!)

   Word Target Calculation:
   • Default role: word_target = Math.round(550 * 0.9) = 495 từ
   • PEAK role: word_target = Math.round(650 * 0.9) = 585 từ
   • HOOK role: word_target = Math.round(120 * 0.8) = 96 từ

   Example Output (9 modules):
   • Module 1 (HOOK): 96 từ
   • Module 2-8 (default): 495 từ each
   • Module 9 (PEAK): 585 từ
   • TOTAL: 96 + (7*495) + 585 = 4146 từ ✅ (gần 4500)
     ↓
STEP 3: Script Generator (scriptGenerator.js) - 🚨 PROBLEM CONTINUES
   • Called ONCE to generate all 9 modules
   • Each module has QA check:
     - Target: 495 từ
     - Minimum: 495 * 0.70 = 346 từ ⚠️
     - AI chỉ cần gen 346+ từ để pass!

   Actual Generation (observed):
   • AI often generates near minimum (350-450 từ)
   • Average per module: ~400 từ (instead of 495)
   • Total actual: 9 * 400 = 3600 từ ❌ (thiếu 900 từ!)
     ↓
STEP 4: Compilation Assembler (compilationAssembler.js) - 🚨 PROBLEM REVEALED
   • Receives 9 modules with ~400 từ each
   • Chia thành 3 blocks:
     - blockSize = Math.ceil(9 / 3) = 3
     - Block 1: modules 0-2 = 3 * 400 = 1200 từ ❌
     - Block 2: modules 3-5 = 3 * 400 = 1200 từ ❌
     - Block 3: modules 6-8 = 3 * 400 = 1200 từ ❌

   • Thêm 2 bridges (~50 từ each) = 100 từ
   • TOTAL: 3600 + 100 = 3700 từ ❌

   ⚠️ Thiếu 800 từ so với yêu cầu 4500 từ!
```

---

## 🎯 ROOT CAUSES IDENTIFIED

### **1. WRONG ARCHITECTURE - LEGO Mode không gen 3 scripts riêng biệt**

**Expected:**
```
3 Micro-Topics
    ↓
FOR EACH topic:
    ↓
    Module Planner (targetWords = 1500)
        ↓
    Script Generator (8-10 modules, total 1500)
        ↓
    Voice Generation
    ↓
Compilation Assembler ghép 3 audio files
```

**Actual:**
```
3 Micro-Topics (chỉ reference)
    ↓
Module Planner ONCE (targetWords = 4500)
    ↓
Plans 8-10 modules total (not 3 x 8-10!)
    ↓
Script Generator ONCE for all modules
    ↓
Compilation chia modules thành 3 blocks
```

**Impact:** Không tạo 3 complete story arcs, chỉ chia 1 story thành 3 phần!

---

### **2. SCALE FACTOR BUG - Giảm word target khi < 5000**

**File:** `modulePlanner.js:98`

```javascript
const scaleFactor = targetWords / 5000;  // 🚨 BUG

// For targetWords = 4500:
scaleFactor = 4500 / 5000 = 0.9

// Kết quả:
word_target = Math.round(550 * 0.9) = 495 từ  // Instead of 550!
```

**Problem:**
- Hệ thống được design cho baseline 5000 từ
- Khi user muốn 4500 từ → SCALE DOWN ❌
- Với 3 arcs x 1500 = 4500, nên SCALE UP mỗi module!

**Expected Logic:**
```javascript
// For LEGO mode với 3 arcs:
const wordsPerArc = targetWords / 3;  // 4500 / 3 = 1500
const scaleFactor = wordsPerArc / 1500;  // 1500 / 1500 = 1.0
```

---

### **3. QA CHECK QUÁ LOOSE - AI viết ít mà vẫn pass**

**File:** `scriptGenerator.js:195-198`

```javascript
const minWords = moduleData.word_target * 0.70;  // 🚨 70% minimum!
if (wordCount < minWords) {
    issues.push(`Content too short...`);
}
```

**Problem:**
- Target: 495 từ
- Minimum: 495 * 0.70 = **346 từ** ⚠️
- AI chỉ cần gen 350 từ là pass QA!
- **Gap: 145 từ thiếu mỗi module!**

**Impact:**
- 9 modules x 145 từ thiếu = **1305 từ thiếu total!**
- Đúng với observation của user (~500 từ thay vì 1500)

---

### **4. NO RETRY MECHANISM - AI underdelivers không bị challenge**

**File:** `scriptGenerator.js:48-78`

```javascript
while (attempts < 2 && !success) {
    attempts++;
    try {
        moduleScript = await generateModule(...);
        const qaResult = qaCheck(moduleScript, module, ...);
        if (!qaResult.pass) {
            throw new Error(`QA thất bại: ${issuesText}`);
        }
        success = true;  // ✅ Pass nếu >= 346 từ
    } catch (err) {
        if (attempts === 2) {
            success = true;  // 🚨 Sau 2 lần thất bại, vẫn accept!
        }
    }
}
```

**Problem:**
- Chỉ retry 2 lần
- Sau 2 lần → accept dù fail!
- Không có prompt để yêu cầu AI viết thêm

---

## 📊 IMPACT ANALYSIS

### **Severity Breakdown**

| Metric | Expected | Actual | Deficit |
|--------|----------|--------|---------|
| **Words per arc** | 1500 | 500-600 | -900 to -1000 |
| **Total words** | 4500 | 1500-1800 | -2700 to -3000 |
| **Audio duration per arc** | ~10 min | ~3-4 min | -6 to -7 min |
| **Total duration** | ~30 min | ~10-12 min | -18 to -20 min |

### **Business Impact**

- 🔴 **User frustration** - Content quá ngắn so với promise
- 🔴 **Revenue loss** - Short videos → low retention → low ad revenue
- 🔴 **Brand damage** - "3 arcs x 1500 words" nhưng chỉ deliver 500
- 🔴 **Workflow broken** - LEGO mode không usable

---

## 💡 SOLUTION PROPOSALS

### **Option 1: FIX LEGO ARCHITECTURE (Recommended)**

**Changes Required:**

#### **1.1: Loop Through Micro-Topics**

**File:** `analyze.js:252-355`

```javascript
// OLD CODE (WRONG):
const planData = await modulePlanner.planModules(projectId, finalResult, null, niche, word_count);

// NEW CODE (CORRECT):
const microScripts = [];
const wordsPerArc = word_count / microTopics.length;  // 4500 / 3 = 1500

for (let i = 0; i < microTopics.length; i++) {
    const topic = microTopics[i];
    log.info(`🧱 [LEGO Arc ${i+1}] Processing: ${topic.topic_title}`);

    // Plan modules FOR THIS ARC ONLY
    const arcPlanData = await modulePlanner.planModules(
        projectId,
        { ...finalResult, core_keyword: topic.core_question },
        null,
        niche,
        wordsPerArc  // 1500 words for this arc
    );

    // Generate script FOR THIS ARC ONLY
    const arcScriptData = await scriptGenerator.processAllModules(
        projectId,
        arcPlanData,
        niche,
        targetLanguage
    );

    // Assemble FOR THIS ARC ONLY
    const arcAssembly = await scriptAssembler.assembleScript(
        projectId,
        arcScriptData,
        niche,
        targetLanguage
    );

    microScripts.push({
        arc_id: i + 1,
        topic: topic.topic_title,
        script: arcAssembly.full_script,
        modules: arcAssembly.modules,
        word_count: arcAssembly.word_count
    });
}

finalResult.micro_scripts = microScripts;
```

#### **1.2: Fix Scale Factor Logic**

**File:** `modulePlanner.js:98-124`

```javascript
// OLD CODE:
const scaleFactor = targetWords / 5000;  // 🚨 WRONG

// NEW CODE:
// For LEGO mode, targetWords is per-arc already (1500)
// For normal mode, targetWords is total (5000)
const baseline = 1500;  // Standard arc size
const scaleFactor = targetWords / baseline;

// For targetWords = 1500: scaleFactor = 1.0
// For targetWords = 3000: scaleFactor = 2.0
```

#### **1.3: Tighten QA Check**

**File:** `scriptGenerator.js:195-198`

```javascript
// OLD CODE:
const minWords = moduleData.word_target * 0.70;  // Too loose!

// NEW CODE:
const minWords = moduleData.word_target * 0.85;  // 85% minimum
const maxWords = moduleData.word_target * 1.15;  // 115% maximum

if (wordCount < minWords) {
    issues.push(`Content too short: ${wordCount} words (Target: ${moduleData.word_target}, Min: ${Math.round(minWords)})`);
}

if (wordCount > maxWords) {
    issues.push(`Content too long: ${wordCount} words (Target: ${moduleData.word_target}, Max: ${Math.round(maxWords)})`);
}
```

#### **1.4: Update Compilation Assembler**

**File:** `compilationAssembler.js:12-24`

```javascript
// OLD CODE: Chia modules thành 3 blocks
const blocks = [];
const blockSize = Math.ceil(modules.length / 3);
for (let i = 0; i < modules.length; i += blockSize) {
    blocks.push(modules.slice(i, i + blockSize));
}

// NEW CODE: Nhận 3 complete arcs
async function assembleMegaVideo(projectId, microScripts, niche, outputDir) {
    // microScripts = [
    //   { arc_id: 1, modules: [...], audio_path: "..." },
    //   { arc_id: 2, modules: [...], audio_path: "..." },
    //   { arc_id: 3, modules: [...], audio_path: "..." }
    // ]

    const finalAssets = [];

    for (let i = 0; i < microScripts.length; i++) {
        const arc = microScripts[i];

        // Add arc audio
        finalAssets.push({
            type: 'arc',
            arc_id: arc.arc_id,
            path: arc.audio_path,
            duration: arc.audio_duration,
            word_count: arc.word_count
        });

        // Add bridge (except after last arc)
        if (i < microScripts.length - 1) {
            const bridge = await generateBridge(i, niche, projectDir);
            finalAssets.push(bridge);
        }
    }

    // Concat all audio files
    const megaAudioPath = await concatAudioFiles(finalAssets, projectDir);

    return {
        mega_audio_path: megaAudioPath,
        arcs: microScripts,
        total_word_count: microScripts.reduce((sum, arc) => sum + arc.word_count, 0),
        total_duration: finalAssets.reduce((sum, a) => sum + a.duration, 0)
    };
}
```

---

### **Option 2: QUICK FIX (Temporary)**

Nếu không muốn refactor toàn bộ, có thể:

#### **2.1: Tăng Word Target cho LEGO Mode**

**File:** `modulePlanner.js:16-19`

```javascript
if (!targetWords) {
    targetWords = nicheProfile.pipeline_settings?.target_words_per_block || 1500;
    if (niche === 'dark_psychology_de') {
        // OLD: targetWords = 4500;
        // NEW: Tăng lên để compensate cho underdelivery
        targetWords = 6000;  // +33% buffer
    }
}
```

#### **2.2: Tighten QA Minimum**

```javascript
const minWords = moduleData.word_target * 0.90;  // 90% instead of 70%
```

#### **2.3: Add AI Prompt Enhancement**

**File:** `scriptGenerator.js:115-145`

```javascript
// Add to prompt:
CRITICAL WORD COUNT REQUIREMENT:
- You MUST write AT LEAST ${moduleData.word_target} words for this module.
- This is a HARD REQUIREMENT. Content shorter than ${Math.round(moduleData.word_target * 0.9)} words will be REJECTED.
- If you cannot reach the word count naturally, expand on:
  * More examples
  * Deeper analysis
  * Additional perspectives
  * Real-world applications
```

**Pros:** Quick to implement, no architecture change
**Cons:** Band-aid solution, doesn't fix root cause

---

## 🧪 TEST CASES

### **Test Case 1: Full LEGO Flow**

```javascript
Input:
{
  "legoMode": true,
  "niche": "dark_psychology_de",
  "word_count": 4500,
  "manualScript": "Core topic about manipulation"
}

Expected Output:
{
  "micro_scripts": [
    { "arc_id": 1, "word_count": 1500, "modules": 8-10 },
    { "arc_id": 2, "word_count": 1500, "modules": 8-10 },
    { "arc_id": 3, "word_count": 1500, "modules": 8-10 }
  ],
  "total_word_count": 4500,
  "mega_audio_duration": "~30 minutes"
}

Current Output (BROKEN):
{
  "modules": 9,  // Single set, not 3 arcs
  "total_word_count": 1500-1800,  // ❌ Thiếu 2700+ từ
  "blocks": [
    { "block_id": 1, "word_count": 500 },
    { "block_id": 2, "word_count": 500 },
    { "block_id": 3, "word_count": 500 }
  ]
}
```

### **Test Case 2: QA Check Validation**

```javascript
// Module with target 500 words
const moduleData = { word_target: 500 };

// Test 1: Content 350 words (70% of target)
const content350 = "Lorem ipsum... (350 words)";
const qa1 = qaCheck({ content: content350 }, moduleData);
// Current: ✅ PASS (min = 350)
// Expected: ❌ FAIL (should need 425+ at 85%)

// Test 2: Content 450 words (90% of target)
const content450 = "Lorem ipsum... (450 words)";
const qa2 = qaCheck({ content: content450 }, moduleData);
// Expected: ✅ PASS
```

---

## 🎯 RECOMMENDED ACTION

**Priority:** 🔴🔴🔴 CRITICAL - Fix immediately

**Recommendation:** **Option 1 (Full Fix)**

**Reason:**
- Option 2 là band-aid, sẽ gây technical debt
- LEGO mode architecture sai từ đầu
- Cần refactor để đúng design: 3 complete arcs, not 1 arc split into 3

**Implementation Plan:**

1. **Phase 1 (Day 1):** Fix scale factor và QA check → Quick relief
2. **Phase 2 (Day 2-3):** Refactor LEGO loop in analyze.js
3. **Phase 3 (Day 4):** Update compilationAssembler
4. **Phase 4 (Day 5):** Testing và validation

**Estimated Effort:** 4-5 days

---

## 📝 CHANGELOG

- **v1.0 (03/01/2026):** Initial bug report - LEGO mode word count deficit
  - Root causes identified: Architecture, scale factor, QA check
  - Solutions proposed: Full fix vs Quick fix
  - Impact: -60% word count (-2700 to -3000 words)

---

**END OF BUG REPORT**
