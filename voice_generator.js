/**
 * Voice Generator Module
 * Xử lý: Text → AI33/ElevenLabs TTS → MP3 + SRT → Duration
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { sendTelegramMessage } = require('./notifier');

// API Endpoints
const AI33_API_BASE = 'https://api.ai33.pro/v1';

/**
 * Main: Process Text to Speech
 */
async function processTextToSpeech(text, config, outputDir = 'output_files', filename = null, chapterInfo = null) {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    try {
        const chapterLabel = chapterInfo ? `[Chương ${chapterInfo.chapterNum}/${chapterInfo.totalChapters}]` : '';
        console.log(`\n${'─'.repeat(50)}\n🎤 ${chapterLabel} Đang tạo voice...`);

        // Filter Script
        let cleanText = text;
        const visualIndex = cleanText.indexOf('[VISUAL]');
        if (visualIndex !== -1) cleanText = cleanText.substring(0, visualIndex).trim();

        const headerRegex = /^\s*(Module|Chapter|Phần)\s+([0-9]+|[a-zA-Z]{1,10})\s*[:,\.-]\s*.*$/gim;
        const metaRegex = /^\s*(\*\*|#)?\s*(Mục tiêu module|Keyword sử dụng|Nội dung|Cliffhanger)(:)?.*$/gim;
        cleanText = cleanText.replace(headerRegex, '').replace(metaRegex, '').replace(/\n{3,}/g, '\n\n').trim();

        if (!config.api_key || !config.voice_id) throw new Error("Thiếu API Key hoặc Voice ID");

        let apiKeys = Array.isArray(config.api_key) ? config.api_key : [config.api_key];
        let attempt = 0;
        const MAX_RETRIES = Math.max(3, apiKeys.length);
        const MAX_WAIT_TIME_SEC = 3600;

        while (attempt < MAX_RETRIES) {
            const currentKeyIndex = attempt % apiKeys.length;
            const currentApiKey = apiKeys[currentKeyIndex];
            attempt++;

            console.log(`   🔄 Attempt ${attempt}/${MAX_RETRIES} | Key: ...${currentApiKey.slice(-4)}`);

            try {
                const pacingText = cleanText.replace(/\. /g, '. <break time="0.5s" /> ').replace(/\./g, '. <break time="0.5s" /> ');

                const createRes = await axios.post(
                    `${AI33_API_BASE}/text-to-speech/${config.voice_id}?output_format=mp3_44100_128`,
                    {
                        text: pacingText,
                        model_id: config.model_id || "eleven_flash_v2_5",
                        voice_settings: {
                            stability: 0.26,
                            similarity_boost: 0.75,
                            style: 0,
                            speed: 1,
                            use_speaker_boost: true
                        },
                        with_transcript: true
                    },
                    {
                        headers: { "xi-api-key": currentApiKey, "Content-Type": "application/json" },
                        timeout: 30000
                    }
                );

                if (!createRes.data.success && !createRes.data.task_id) throw new Error("API Rejected");

                const taskId = createRes.data.task_id;
                console.log(`   ✅ Task Created: ${taskId}`);

                let audioUrl = null, srtUrl = null;
                const startTime = Date.now();
                let isTaskSuccessful = false;

                if (cleanText.length > 2000) {
                    console.log(`   ⏳ Waiting 7m for long script...`);
                    await sleep(420000);
                }

                while ((Date.now() - startTime) / 1000 < MAX_WAIT_TIME_SEC) {
                    try {
                        const checkRes = await axios.get(`${AI33_API_BASE}/task/${taskId}`, {
                            headers: { "xi-api-key": currentApiKey },
                            timeout: 15000
                        });
                        const status = checkRes.data.status;
                        if (status === 'done') {
                            audioUrl = checkRes.data.metadata?.audio_url;
                            srtUrl = checkRes.data.metadata?.srt_url;
                            isTaskSuccessful = true;
                            break;
                        } else if (status === 'failed') break;
                    } catch (e) { }
                    await sleep(60000);
                }

                if (isTaskSuccessful && audioUrl) {
                    const fullOutputDir = path.resolve(outputDir);
                    let finalName = filename || `voice_${Date.now()}.mp3`;
                    if (!finalName.endsWith('.mp3')) finalName += '.mp3';

                    const mp3Path = path.join(fullOutputDir, finalName);
                    const srtPath = path.join(fullOutputDir, finalName.replace('.mp3', '.srt'));

                    await downloadFile(audioUrl, mp3Path);
                    if (srtUrl) await downloadFile(srtUrl, srtPath);

                    const duration = await getAudioDuration(mp3Path);
                    console.log(`✅ Voice hoàn thành - ${duration.toFixed(1)}s`);

                    return { success: true, audio_path: mp3Path, srt_path: srtUrl ? srtPath : null, duration, task_id: taskId };
                }
            } catch (err) {
                console.error(`   ⚠️ Attempt ${attempt} failed:`, err.message);
                if (attempt >= MAX_RETRIES) throw err;
                await sleep(10000);
            }
        }
        throw new Error("Failed after max retries.");
    } catch (e) {
        console.error("❌ [Lỗi TTS]", e.message);
        sendTelegramMessage(`❌ <b>Lỗi Voice:</b> ${e.message}`);
        return { success: false, error: e.message, duration: 0 };
    }
}

async function downloadFile(url, dest) {
    const writer = fs.createWriteStream(dest);
    const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 60000 });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function getAudioDuration(filePath) {
    try {
        const mp3Duration = require('mp3-duration');
        return new Promise((resolve, reject) => {
            mp3Duration(filePath, (err, duration) => {
                if (err) return reject(err);
                resolve(duration);
            });
        });
    } catch (e) {
        const stats = fs.statSync(filePath);
        return stats.size / (16 * 1024);
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { processTextToSpeech, getAudioDuration };
