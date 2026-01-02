const fs = require('fs');
const path = require('path');
const { processTextToSpeech } = require('./voice_generator');
const ai84Voice = require('./ai84_voice');
const { log } = require('./colors');
const { getAudioDuration } = require('./voice_generator');

/**
 * Voice Merger & SRT Aligner
 * Gom nhiều kịch bản nhỏ thành 1 MP3 + 1 SRT tổng
 */

async function processUnifiedVoice(fullText, profileConfig, ttsConfig, outputDir, voiceService = 'ai84') {
    log.info(`🛠️ [Unified Voice] Bắt đầu xử lý kịch bản tổng (~${fullText.length} ký tự)`);

    // 1. CHUNK TEXT: Chia kịch bản thành các khối ~4500 ký tự (Giới hạn ElevenLabs)
    const chunks = chunkText(fullText, 4500);
    log.info(`📦 Chia kịch bản thành ${chunks.length} đoạn để gen voice.`);

    const results = [];
    let cumulativeDuration = 0;

    for (let i = 0; i < chunks.length; i++) {
        const chunkLabel = `Part_${i + 1}`;
        log.info(`🎤 Đang gen Voice cho đoạn ${i + 1}/${chunks.length}...`);

        let res;
        if (voiceService === 'ai84') {
            const ai84Data = ai84Voice.loadAI84Data();
            const targetVoice = ai84Data.default_voice_id || 'JiW03c2Gt43XNUQAumRP';
            const apiKey = (ai84Data.api_keys || [])[0];

            // Giả lập config cho generateVoice
            res = await ai84Voice.generateVoice(chunks[i], chunkLabel, outputDir, targetVoice, {}, null, apiKey);
            // Chuẩn hóa kết quả giống voice_generator
            res = {
                success: res.success,
                audio_path: res.mp3_path,
                srt_path: res.srt_path,
                duration: res.duration
            };
        } else {
            res = await processTextToSpeech(chunks[i], ttsConfig, outputDir, chunkLabel, { chapterNum: i + 1, totalChapters: chunks.length });
        }

        if (!res.success) throw new Error(`Lỗi gen voice tại đoạn ${i + 1}: ${res.error}`);

        results.push({
            audio_path: res.audio_path,
            srt_path: res.srt_path,
            duration: res.duration,
            offset: cumulativeDuration
        });

        cumulativeDuration += res.duration;
    }

    // 2. MERGE MP3: Dùng binary append (MP3 cho phép nối trực tiếp)
    const finalMp3Name = `final_${Date.now()}.mp3`;
    const finalMp3Path = path.join(outputDir, finalMp3Name);
    const mp3Stream = fs.createWriteStream(finalMp3Path);

    for (const res of results) {
        const buffer = fs.readFileSync(res.audio_path);
        mp3Stream.write(buffer);
    }
    mp3Stream.end();

    // 3. MERGE SRT & OFFSET: Chuẩn hóa thời gian
    const finalSrtName = finalMp3Name.replace('.mp3', '.srt');
    const finalSrtPath = path.join(outputDir, finalSrtName);
    let finalSrtContent = '';
    let globalSubIndex = 1;

    for (const res of results) {
        if (!res.srt_path || !fs.existsSync(res.srt_path)) continue;

        const srtRaw = fs.readFileSync(res.srt_path, 'utf8');
        const adjustedSrt = offsetSRT(srtRaw, res.offset, globalSubIndex);

        finalSrtContent += adjustedSrt + "\n";

        // Cập nhật index cho đoạn tiếp theo
        const matches = adjustedSrt.match(/^\d+$/gm);
        if (matches) globalSubIndex += matches.length;
    }

    fs.writeFileSync(finalSrtPath, finalSrtContent.trim());

    // Lưu link final vào project để editor tự tìm (hoặc file cố định)
    const symlinkSrt = path.join(outputDir, 'final.srt');
    const symlinkMp3 = path.join(outputDir, 'final.mp3');
    if (fs.existsSync(symlinkSrt)) fs.unlinkSync(symlinkSrt);
    if (fs.existsSync(symlinkMp3)) fs.unlinkSync(symlinkMp3);
    fs.copyFileSync(finalSrtPath, symlinkSrt);
    fs.copyFileSync(finalMp3Path, symlinkMp3);

    log.success(`✅ Hoàn tất Gộp Voice: ${cumulativeDuration.toFixed(1)}s. File: ${finalMp3Name}`);

    return {
        success: true,
        audio_path: finalMp3Path,
        srt_path: finalSrtPath,
        duration: cumulativeDuration,
        chunks_count: chunks.length
    };
}

/**
 * Chia nhỏ text theo dấu câu hợp lý
 */
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

/**
 * Cộng thêm offset thời gian vào SRT
 */
function offsetSRT(srtContent, offsetSeconds, startIdx) {
    if (!srtContent) return "";
    const lines = srtContent.split(/\r?\n/);
    let result = [];
    let currentIdx = startIdx;

    const timeRegex = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        // Nếu là dòng index
        if (/^\d+$/.test(line)) {
            result.push(currentIdx.toString());
            currentIdx++;
            continue;
        }

        // Nếu là dòng thời gian
        const match = line.match(timeRegex);
        if (match) {
            const start = addOffset(match[1], offsetSeconds);
            const end = addOffset(match[2], offsetSeconds);
            result.push(`${start} --> ${end}`);
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
