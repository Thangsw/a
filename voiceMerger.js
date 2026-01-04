const fs = require('fs');
const path = require('path');
const { processTextToSpeech } = require('./voice_generator');
const ai84Voice = require('./ai84_voice');
const genaiVoice = require('./genai_voice');
const { log } = require('./colors');
const { getAudioDuration } = require('./voice_generator');

/**
 * Voice Merger & SRT Aligner
 * Gom nhiều kịch bản nhỏ thành 1 MP3 + 1 SRT tổng
 */

async function processUnifiedVoice(fullText, profileConfig, ttsConfig, outputDir, voiceService = 'ai84', projectId = null) {
    log.info(`🛠️ [Unified Voice] Bắt đầu xử lý kịch bản tổng (~${fullText.length} ký tự). Project: ${projectId}`);

    // 1. CHUNK TEXT: Chia kịch bản thành các khối ~4500 ký tự (Giới hạn ElevenLabs)
    const chunks = chunkText(fullText, 4500);
    log.info(`📦 Chia kịch bản thành ${chunks.length} đoạn để gen voice.`);

    const results = [];
    let cumulativeDuration = 0;

    for (let i = 0; i < chunks.length; i++) {
        const chunkLabel = `Part_${i + 1}_${Date.now()}`;
        log.info(`🎤 Đang gen Voice cho đoạn ${i + 1}/${chunks.length}...`);

        let res = { success: false };
        const servicesToTry = (voiceService === 'ai84') ? ['ai84', 'genai'] : [voiceService, 'ai84', 'genai'];

        for (const service of servicesToTry) {
            try {
                if (service === 'ai84') {
                    const ai84Data = ai84Voice.loadAI84Data();
                    const targetVoice = profileConfig.pipeline_settings?.voice_id || ai84Data.default_voice_id || 'JiW03c2Gt43XNUQAumRP';
                    const apiKey = (ai84Data.api_keys || [])[0];
                    const ai84Res = await ai84Voice.generateVoice(chunks[i], chunkLabel, outputDir, targetVoice, {}, null, apiKey);
                    res = { success: ai84Res.success, audio_path: ai84Res.mp3_path, srt_path: ai84Res.srt_path, duration: ai84Res.duration, error: ai84Res.error };
                } else if (service === 'genai') {
                    const genaiRes = await genaiVoice.generateVoice(chunks[i], chunkLabel, outputDir, 'oae6GCCzwoEbfc5FHdEu');
                    res = { success: genaiRes.success, audio_path: genaiRes.mp3_path, srt_path: genaiRes.srt_path, duration: genaiRes.duration, error: genaiRes.error };
                } else if (service === 'ai33' || service === 'elevenlabs') {
                    res = await processTextToSpeech(chunks[i], ttsConfig, outputDir, chunkLabel, { chapterNum: i + 1, totalChapters: chunks.length });
                }

                if (res && res.success) break;
            } catch (err) {
                log.warn(`⚠️ [Voice] Dịch vụ ${service} lỗi: ${err.message}.`);
            }
        }

        if (!res || !res.success) throw new Error(`Tất cả dịch vụ Voice đều thất bại tại đoạn ${i + 1}.`);

        results.push({
            audio_path: res.audio_path,
            srt_path: res.srt_path,
            duration: res.duration,
            offset: cumulativeDuration
        });
        cumulativeDuration += res.duration;
    }

    // 2. MERGE MP3
    const finalMp3Path = path.join(outputDir, `voice_final.mp3`);
    const mp3Stream = fs.createWriteStream(finalMp3Path);
    for (const res of results) {
        mp3Stream.write(fs.readFileSync(res.audio_path));
    }
    mp3Stream.end();

    // 3. MERGE SRT
    const finalSrtPath = path.join(outputDir, `voice_final.srt`);
    let finalSrtContent = '';
    let globalSubIndex = 1;

    for (const res of results) {
        if (!res.srt_path || !fs.existsSync(res.srt_path)) continue;
        const srtRaw = fs.readFileSync(res.srt_path, 'utf8');
        const adjustedSrt = offsetSRT(srtRaw, res.offset, globalSubIndex);
        finalSrtContent += adjustedSrt + "\n\n";

        const matches = adjustedSrt.match(/^\d+$/gm);
        if (matches) globalSubIndex += matches.length;
    }
    fs.writeFileSync(finalSrtPath, finalSrtContent.trim());

    // 4. CLEANUP: Delete individual parts to avoid "4 file" issue
    for (const res of results) {
        try {
            if (fs.existsSync(res.audio_path)) fs.unlinkSync(res.audio_path);
            if (fs.existsSync(res.srt_path)) fs.unlinkSync(res.srt_path);
        } catch (e) { /* ignore cleanup errors */ }
    }

    log.success(`✅ Hoàn tất Gộp Voice: ${cumulativeDuration.toFixed(1)}s. Đã dọn dẹp file tạm.`);

    return {
        success: true,
        audio_path: finalMp3Path,
        srt_path: finalSrtPath,
        duration: cumulativeDuration,
        parts: results
    };
}

function chunkText(text, limit) {
    const chunks = [];
    let current = "";
    const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || [text];

    for (const s of sentences) {
        if ((current.length + s.length) > limit && current.length > 0) {
            chunks.push(current.trim());
            current = "";
        }
        current += s + " ";
    }
    if (current.trim().length > 0) chunks.push(current.trim());
    return chunks;
}

function offsetSRT(srtContent, offsetSeconds, startIdx) {
    if (!srtContent) return "";
    const lines = srtContent.split(/\r?\n/);
    let result = [];
    let currentIdx = startIdx;
    const timeRegex = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (/^\d+$/.test(line)) {
            result.push(currentIdx.toString());
            currentIdx++;
            continue;
        }
        const match = line.match(timeRegex);
        if (match) {
            result.push(`${addOffset(match[1], offsetSeconds)} --> ${addOffset(match[2], offsetSeconds)}`);
            continue;
        }
        result.push(line);
    }
    return result.join("\n");
}

function addOffset(timeStr, offsetSec) {
    const [hms, ms] = timeStr.split(',');
    const [h, m, s] = hms.split(':').map(Number);
    let totalMs = ((h * 3600 + m * 60 + s) + offsetSec) * 1000 + parseInt(ms);
    const nh = Math.floor(totalMs / 3600000);
    totalMs %= 3600000;
    const nm = Math.floor(totalMs / 60000);
    totalMs %= 60000;
    const ns = Math.floor(totalMs / 1000);
    const nms = totalMs % 1000;
    return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}:${String(ns).padStart(2, '0')},${String(nms).padStart(3, '0')}`;
}

module.exports = { processUnifiedVoice };
