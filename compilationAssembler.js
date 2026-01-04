const fs = require('fs');
const path = require('path');
const { log } = require('./colors');
const db = require('./database');
const ai84Voice = require('./ai84_voice');
const { getAudioDuration } = require('./voice_generator');

/**
 * LEGO V11.4: Compilation Assembler
 * Ghép 3 micro-videos thành 1 Mega-Video (4500w) kèm Bridges.
 */
async function assembleMegaVideo(projectId, modules, niche = 'dark_psychology_de', outputDir = 'output') {
    log.info(`🧩 [LEGO Assembler] Bắt đầu ghép nối Mega-Video cho Dự án: ${projectId}`);

    // Sử dụng outputDir tuyệt đối từ client hoặc tương đối mặc định
    const projectDir = path.isAbsolute(outputDir) ? path.join(outputDir, projectId.toString()) : path.join(__dirname, '../../', outputDir, projectId.toString());
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

    // 1. Phân nhóm Modules thành 3 Blocks (giả định 3 blocks, mỗi block ~3-4 modules)
    const blocks = [];
    const blockSize = Math.ceil(modules.length / 3);
    for (let i = 0; i < modules.length; i += blockSize) {
        blocks.push(modules.slice(i, i + blockSize));
    }

    const bridges = [
        "Was du gerade gehört hast, ist chỉ một khía cạnh của cùng một cơ chế. Trong phần tiếp theo, chúng ta sẽ thấy cùng một động lực từ một góc nhìn khác.",
        "Das là die Logik der Manipulation. Aber wie manifestiert sich das im Alltag? Der nächste Abschnitt phân tích chính xác điều đó."
    ];

    const germanBridges = [
        "Was du gerade gehört hast, ist nur eine Ausprägung desselben Mechanismus. Im nächsten Abschnitt zeigt sich dieselbe Dynamik aus einer anderen Perspektive.",
        "Das ist die Logik der Macht. Doch wie manifestiert sich das im System? Der nächste Teil analysiert genau diese Struktur."
    ];

    const finalBridgeTexts = niche.endsWith('_de') ? germanBridges : bridges;
    const finalAssets = [];
    let cumulativeDuration = 0;

    // 2. Xử lý từng Block và chèn Bridge
    for (let i = 0; i < blocks.length; i++) {
        log.info(`📦 Đang gộp Block ${i + 1}...`);

        // block hien tai chinh la 1 phan tu trong mang `legoBlocks` nhung duoc truyen qua argument `modules` (thuc chat la legoBlocks tu analyze.js)
        const block = modules[i];

        finalAssets.push({
            type: 'block',
            path: block.audio_path || "",
            duration: block.duration || 0,
            srt: block.srt_path ? fs.readFileSync(block.srt_path, 'utf8') : "",
            visual_prompts: block.visual_prompts || []
        });

        // Chèn Bridge Audio sau block 1 và block 2
        if (i < blocks.length - 1) {
            const bridgeText = finalBridgeTexts[i];
            const bridgeFilename = `bridge_helmut_${i + 1}`;
            log.progress(`🎙️ Đang tạo Bridge Audio ${i + 1} (Helmut)...`);

            try {
                const ai84Data = ai84Voice.loadAI84Data();
                const helmutVoice = ai84Data.default_voice_id || 'qAZH0aMXY8tw1QufPN0D'; // Helmut
                const apiKey = (ai84Data.api_keys || [])[0];

                const bridgeRes = await ai84Voice.generateVoice(
                    bridgeText,
                    bridgeFilename,
                    projectDir,
                    helmutVoice,
                    {},
                    null,
                    apiKey
                );

                if (bridgeRes.success) {
                    finalAssets.push({
                        type: 'bridge',
                        path: bridgeRes.mp3_path,
                        duration: bridgeRes.duration,
                        text: bridgeText
                    });
                }
            } catch (e) {
                log.warn(`⚠️ Không thể tạo Bridge ${i + 1}: ${e.message}`);
            }
        }
    }

    // 3. Ghép nối nhị phân các file MP3 và tính toán Mega SRT / Visual Prompts
    const megaAudioPath = path.join(projectDir, `mega_audio_${projectId}.mp3`);
    const writeStream = fs.createWriteStream(megaAudioPath);

    let megaSrt = "";
    let megaVisualPrompts = [];
    let currentSrtOffset = 0;
    let srtCounter = 1;

    for (const asset of finalAssets) {
        // MP3 Merge
        const buffer = fs.readFileSync(asset.path);
        writeStream.write(buffer);

        // SRT & Visual Logic
        if (asset.type === 'block') {
            // Append SRT with offset
            const blockSrt = asset.srt || "";
            const parsedSrt = parseSimpleSrt(blockSrt);
            parsedSrt.forEach(entry => {
                megaSrt += `${srtCounter}\n${formatSrtTime(entry.start + currentSrtOffset)} --> ${formatSrtTime(entry.end + currentSrtOffset)}\n${entry.text}\n\n`;
                srtCounter++;
            });

            // Append Visual Prompts with offset
            const blockVisuals = asset.visual_prompts || [];
            blockVisuals.forEach(v => {
                megaVisualPrompts.push({
                    ...v,
                    start_time: (v.start_time || 0) + currentSrtOffset
                });
            });
        } else if (asset.type === 'bridge') {
            // Bridge Visual: "Kéo dài ảnh cuối" technique
            // Add a single SRT entry for the bridge
            megaSrt += `${srtCounter}\n${formatSrtTime(currentSrtOffset)} --> ${formatSrtTime(currentSrtOffset + asset.duration)}\n${asset.text}\n\n`;
            srtCounter++;

            // Visual Bridge: Use last prompt but adjust timing
            const lastPrompt = megaVisualPrompts.length > 0 ? { ...megaVisualPrompts[megaVisualPrompts.length - 1] } : { prompt: asset.text, scene_id: 'bridge' };
            megaVisualPrompts.push({
                ...lastPrompt,
                is_bridge: true,
                start_time: currentSrtOffset,
                duration: asset.duration,
                prompt: `(Bridge) ${asset.text}`
            });
        }

        currentSrtOffset += asset.duration;
    }
    writeStream.end();

    // 4. Lưu Mega SRT và Mega Visual Prompts
    const megaSrtPath = path.join(projectDir, `mega_video_${projectId}.srt`);
    const megaVisualPath = path.join(projectDir, `mega_visual_prompts.json`);
    fs.writeFileSync(megaSrtPath, megaSrt, 'utf8');
    fs.writeFileSync(megaVisualPath, JSON.stringify(megaVisualPrompts, null, 2), 'utf8');

    log.success(`✨ Mega-Files ready: Audio, SRT, and Visual Index.`);

    // 5. Lưu kết quả vào DB
    if (projectId) {
        await db.db.run(
            'UPDATE projects SET status = ?, mega_audio_path = ? WHERE id = ?',
            ['completed', megaAudioPath, projectId]
        );
    }

    return {
        mega_audio_path: megaAudioPath,
        mega_srt_path: megaSrtPath,
        mega_visual_path: megaVisualPath,
        total_duration: cumulativeDuration,
        blocks_count: blocks.length,
        status: "compilation_complete",
        thanh_pham: {
            clip_lon: megaAudioPath,
            srt_master: megaSrtPath,
            index_visual: megaVisualPath
        }
    };
}

// Helpers for SRT processing
function parseSimpleSrt(srtText) {
    if (!srtText) return [];
    const entries = [];
    const blocks = srtText.split('\n\n');
    blocks.forEach(block => {
        const lines = block.split('\n');
        if (lines.length >= 3) {
            const timeRange = lines[1].split(' --> ');
            if (timeRange.length === 2) {
                entries.push({
                    start: parseSrtTime(timeRange[0]),
                    end: parseSrtTime(timeRange[1]),
                    text: lines.slice(2).join(' ')
                });
            }
        }
    });
    return entries;
}

function parseSrtTime(timeStr) {
    const parts = timeStr.replace(',', '.').split(':');
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
}

function formatSrtTime(seconds) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
    return `${h}:${m}:${s},${ms}`;
}

module.exports = { assembleMegaVideo };
