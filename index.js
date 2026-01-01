const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { loadConfig, saveConfig, getTTSConfig, saveTTSConfig } = require('./modules/config');
const { testChat } = require('./modules/test_chat');
const { analyzeContent } = require('./modules/analyze');
const { generateScript } = require('./modules/script');
const { listProfiles, getProfile, saveProfile, deleteProfile } = require('./modules/profiles');
const { checkAllKeys, testSingleKey } = require('./modules/keyChecker');
const { generateMetadata } = require('./modules/metadata');
const { runFullPipeline } = require('./modules/pipeline');
const { testVoiceAPI } = require('./modules/voice_generator');
const keyManager = require('./modules/keyManager');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createBackup } = require('./modules/backup');
const { log } = require('./modules/colors');
const audioKeyManager = require('./modules/audioKeyManager');

// Import Veo3 Routes
const veo3Routes = require('./routes/veo3Routes');
const laneRoutes = require('./routes/laneRoutes');
const testGenRoutes = require('./routes/testGenRoutes');
const ai33Routes = require('./routes/ai33Routes');
const genaiRoutes = require('./routes/genaiRoutes'); // GenAI Labs
const ai84Routes = require('./routes/ai84Routes'); // AI84.pro
const browserApiTestRoutes = require('./routes/browserApiTestRoutes'); // Browser-native API test
const veo3UITestRoutes = require('./routes/veo3UITestRoutes'); // Veo3 UI Automation Test
const chatRoutes = require('./routes/chatRoutes'); // Gemini Chat Bubble
const captchaTestRoutes = require('./routes/captchaTestRoutes'); // Captcha Test Routes
const captchaRoutes = require('./routes/captchaRoutes'); // Captcha Token API (Production)
const scriptAssistantRoutes = require('./routes/scriptAssistantRoutes'); // Script Assistant
const shuRoutes = require('./routes/shuRoutes'); // SHU Content Engine
const editorRoutes = require('./modules/editorRoutes'); // Video Editor & Smart Mapping


const app = express();
const PORT = 3006;


// Multer for file uploads
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for image uploads
app.use(express.static(path.join(__dirname, '../public')));
app.use('/data/assets', express.static(path.join(__dirname, '../data/assets'))); // Serve generated images

// Register Veo3 API Routes
app.use('/api/veo3', veo3Routes);
app.use('/api', laneRoutes);
app.use('/api/test-gen', testGenRoutes);
app.use('/api/ai33', ai33Routes);
app.use('/api/genai', genaiRoutes); // GenAI Labs Routes
app.use('/api/ai84', ai84Routes); // AI84.pro Routes
app.use('/api/browser-api', browserApiTestRoutes); // Browser-native API test route
app.use('/api/veo3-ui', veo3UITestRoutes); // Veo3 UI Automation Test
app.use('/api', chatRoutes); // Gemini Chat
app.use('/api/captcha-test', captchaTestRoutes); // Captcha Test Routes
app.use('/api/token', captchaRoutes); // Captcha Token API (Production - standalone endpoint)
app.use('/api/script-assistant', scriptAssistantRoutes); // Script Assistant
app.use('/api/shu', shuRoutes); // SHU Content Engine
app.use('/api/editor', editorRoutes); // Video Editor & Smart Mapping


// ===== SSE: Real-time Process Log =====
let sseClients = [];

app.get('/api/sse/process-log', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now();
    sseClients.push({ id: clientId, res });
    console.log(`[SSE] Client ${clientId} connected. Total: ${sseClients.length}`);

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE Connected' })}\n\n`);

    req.on('close', () => {
        sseClients = sseClients.filter(c => c.id !== clientId);
        console.log(`[SSE] Client ${clientId} disconnected. Total: ${sseClients.length}`);
    });
});

// Global SSE broadcast function
global.sendSSE = (type, data) => {
    const payload = JSON.stringify({ type, data, timestamp: Date.now() });
    sseClients.forEach(client => {
        try {
            client.res.write(`data: ${payload}\n\n`);
        } catch (e) {
            // Client disconnected
        }
    });
};


// ===== API: Config =====
app.get('/api/config', (req, res) => {
    res.json({ success: true, config: loadConfig() });
});

app.get('/api/keys/status', (req, res) => {
    res.json({ success: true, statuses: keyManager.getKeyStatuses() });
});

app.post('/api/config', (req, res) => {
    const currentConfig = loadConfig();
    const newConfig = { ...currentConfig, ...req.body.config };

    if (saveConfig(newConfig)) {
        keyManager.refreshKeys(); // Refresh key manager when config changes
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Failed to save config' });
    }
});

// ===== API: Keys CRUD =====
app.post('/api/keys', (req, res) => {
    const { key } = req.body;
    if (!key) return res.json({ success: false, error: 'Key is required' });

    const config = loadConfig();
    const keys = config.GEMINI_API_KEYS || [];

    if (keys.includes(key)) return res.json({ success: false, error: 'Key already exists' });

    keys.push(key);
    config.GEMINI_API_KEYS = keys;

    if (saveConfig(config)) {
        keyManager.refreshKeys();
        res.json({ success: true, message: 'Key added' });
    } else {
        res.json({ success: false, error: 'Failed to save config' });
    }
});

app.put('/api/keys/:index', (req, res) => {
    const index = parseInt(req.params.index);
    const { key } = req.body;
    if (!key) return res.json({ success: false, error: 'Key is required' });

    const config = loadConfig();
    const keys = config.GEMINI_API_KEYS || [];
    if (index < 0 || index >= keys.length) return res.json({ success: false, error: 'Invalid index' });

    keys[index] = key;
    config.GEMINI_API_KEYS = keys;

    if (saveConfig(config)) {
        keyManager.refreshKeys();
        res.json({ success: true, message: 'Key updated' });
    } else {
        res.json({ success: false, error: 'Failed to save config' });
    }
});

app.delete('/api/keys/:index', (req, res) => {
    const index = parseInt(req.params.index);
    const config = loadConfig();
    const keys = config.GEMINI_API_KEYS || [];
    if (index < 0 || index >= keys.length) return res.json({ success: false, error: 'Invalid index' });

    keys.splice(index, 1);
    config.GEMINI_API_KEYS = keys;

    if (saveConfig(config)) {
        keyManager.refreshKeys();
        res.json({ success: true, message: 'Key deleted' });
    } else {
        res.json({ success: false, error: 'Failed to save config' });
    }
});

// Bulk save keys (from textarea)
app.post('/api/keys/bulk', (req, res) => {
    const { keys } = req.body;
    if (!keys || !Array.isArray(keys)) return res.json({ success: false, error: 'Keys array required' });

    const config = loadConfig();
    // Unique and trimmed keys
    config.GEMINI_API_KEYS = [...new Set(keys.map(k => k.trim()).filter(k => k))];

    if (saveConfig(config)) {
        keyManager.refreshKeys();
        res.json({ success: true, message: `Successfully saved ${config.GEMINI_API_KEYS.length} keys` });
    } else {
        res.json({ success: false, error: 'Failed to save config' });
    }
});

// Proxy Rotation API
app.get('/api/proxies/stats', (req, res) => {
    res.json({
        success: true,
        proxies: keyManager.proxies,
        status: keyManager.proxyStatus
    });
});

app.post('/api/proxies/test', async (req, res) => {
    const results = await keyManager.testProxies();
    res.json({ success: true, results });
});


app.post('/api/test-key', testSingleKey);
app.post('/api/test-gemini-key', testSingleKey);

// ===== API: Audio Analysis Keys =====
app.get('/api/audio-keys', (req, res) => {
    const stats = audioKeyManager.getUsageStats();
    res.json({ success: true, ...stats });
});

app.post('/api/audio-keys', (req, res) => {
    const { keys } = req.body;
    if (!keys || !Array.isArray(keys)) {
        return res.json({ success: false, error: 'Keys array is required' });
    }

    // Filter empty keys
    const validKeys = keys.filter(k => k && k.trim().length > 0).map(k => k.trim());

    if (audioKeyManager.saveAudioKeys(validKeys)) {
        keyManager.refreshKeys(); // Refresh general pool too
        const stats = audioKeyManager.getUsageStats();
        res.json({ success: true, message: `Saved ${validKeys.length} audio keys`, ...stats });
    } else {
        res.json({ success: false, error: 'Failed to save audio keys' });
    }
});

app.post('/api/audio-keys/settings', (req, res) => {
    const { model, dailyLimit } = req.body;
    const updated = audioKeyManager.updateSettings({ model, dailyLimit });
    res.json({ success: true, model: updated.model, dailyLimit: updated.dailyLimit });
});

// ===== API: Profiles =====
app.get('/api/profiles', listProfiles);
app.get('/api/profiles/:id', getProfile);
app.post('/api/profiles', saveProfile);
app.put('/api/profiles/:id', saveProfile);
app.delete('/api/profiles/:id', deleteProfile);

// ===== API: Core Modules =====
app.post('/api/test-chat', testChat);
app.post('/api/analyze', analyzeContent);
app.post('/api/generate-script', generateScript);
app.post('/api/generate-metadata', generateMetadata);
app.post('/api/run-pipeline', runFullPipeline);
app.post('/api/check-keys', checkAllKeys);

// AI Suggestions
app.post('/api/ai-suggest-rules', async (req, res) => {
    const { suggestRulesWithAI } = require('./modules/api_suggestions');
    try {
        const { type, profileName, keywords } = req.body;
        const suggestion = await suggestRulesWithAI(type, profileName, keywords);
        res.json({ success: true, suggestion });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Excel Export
app.post('/api/export-excel', (req, res) => {
    const { results, projectName } = req.body;
    const { exportPromptsToExcel } = require('./modules/excelExporter');

    const timestamp = new Date().getTime();
    const outputPath = path.join(__dirname, `../output_files/${projectName || 'export'}_storyboard_${timestamp}.xlsx`);
    const templatePath = path.join(__dirname, '../data/storyboard_prompts.xlsx');

    const result = exportPromptsToExcel(results, outputPath, templatePath);
    res.json(result);
});

// ===== API: Media Generation (Veo3) =====
const { generateMediaForChapter, getLanes } = require('./modules/mediaGenerator');

app.post('/api/generate-media', async (req, res) => {
    try {
        const { chapterResult, laneName, outputDir } = req.body;

        if (!chapterResult || !chapterResult.visual_prompts) {
            return res.json({ success: false, error: 'Missing visual_prompts in chapterResult' });
        }

        // Get available lanes if not specified
        let targetLane = laneName;
        if (!targetLane) {
            const lanes = await getLanes();
            if (lanes.length === 0) {
                return res.json({ success: false, error: 'No lanes configured!' });
            }
            targetLane = lanes[0].name;
        }

        console.log(`\n🎬 [API] Starting media generation for chapter ${chapterResult.chapter_id}`);
        console.log(`   🚗 Lane: ${targetLane}`);
        console.log(`   📊 Prompts: ${chapterResult.visual_prompts.length}`);

        const result = await generateMediaForChapter(chapterResult, targetLane, outputDir);

        res.json({
            success: true,
            chapter_id: chapterResult.chapter_id,
            lane: targetLane,
            images: result.images,
            videos: result.videos,
            stats: {
                totalImages: result.images.length,
                successfulImages: result.images.filter(i => i.success).length,
                totalVideos: result.videos.length,
                successfulVideos: result.videos.filter(v => v.success).length
            }
        });

    } catch (error) {
        console.error('❌ [API] Generate media failed:', error);
        res.json({ success: false, error: error.message });
    }
});

const getMP3Duration = require('mp3-duration');

// ===== API: List Project Audio =====
app.get('/api/project-audio', async (req, res) => {
    try {
        const { projectId } = req.query;
        let outDir = 'output_files'; // Default

        // If projectId is given, try to find the specific folder
        if (projectId && projectId !== 'latest') {
            const project = await db.db.get('SELECT title_working, name FROM projects WHERE id = ?', [projectId]);
            if (project) {
                const safeName = (project.title_working || project.name).replace(/[<>:"/\\|?*]/g, '_');
                // Check common output patterns
                const possiblePaths = [
                    path.join(__dirname, '../output_files', safeName),
                    path.join('C:\\Kênh\\', safeName), // Common default in UI
                    path.join(__dirname, '../output_files')
                ];
                for (const p of possiblePaths) {
                    if (fs.existsSync(p)) { outDir = p; break; }
                }
            }
        } else {
            // Find latest modified folder in output_files
            const baseDir = path.join(__dirname, '../output_files');
            if (fs.existsSync(baseDir)) {
                const dirs = fs.readdirSync(baseDir).map(d => ({ name: d, time: fs.statSync(path.join(baseDir, d)).mtime.getTime() }));
                const latest = dirs.sort((a, b) => b.time - a.time)[0];
                if (latest) outDir = path.join(baseDir, latest.name);
            }
        }

        if (!fs.existsSync(outDir)) return res.json({ success: true, files: [] });

        const files = fs.readdirSync(outDir).filter(f => f.endsWith('.mp3'));
        const fileData = await Promise.all(files.map(async f => {
            const filePath = path.join(outDir, f);
            let duration = 0;
            try {
                duration = await new Promise((resolve) => {
                    getMP3Duration(filePath, (err, duration) => resolve(err ? 0 : Math.round(duration)));
                });
            } catch (e) { }
            return { name: f, path: filePath, duration };
        }));

        res.json({ success: true, files: fileData, dir: outDir });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ===== API: Audio Proxy (Serve any file) =====
app.get('/api/audio-proxy', (req, res) => {
    const filePath = req.query.path;
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('File not found');
    res.sendFile(filePath);
});

// ===== API: Placeholder Thumb =====
app.get('/api/placeholder-thumb', (req, res) => {
    const text = req.query.text || 'THUMBNAIL';
    // Return a simple SVG as image
    const svg = `<svg width="400" height="225" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#1a1a2e"/>
        <text x="50%" y="50%" font-family="Arial" font-size="24" fill="#444" text-anchor="middle" dominant-baseline="middle">${text}</text>
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
});

// ===== API: Test Voice API =====
app.post('/api/test-voice', async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) return res.json({ success: false, error: 'Missing apiKey' });

    const result = await testVoiceAPI(apiKey);
    res.json(result);
});

// ===== API: Retry Voice Generation =====
app.post('/api/retry-voice', async (req, res) => {
    try {
        const { text, chapterId, outputDir } = req.body;

        if (!text) return res.json({ success: false, error: 'Missing text content' });

        // Load TTS Config
        const ttsConfig = getTTSConfig();
        if (!ttsConfig.api_key || !ttsConfig.voice_id) {
            return res.json({ success: false, error: 'Missing TTS Config (API Key or Voice ID)' });
        }

        const { processTextToSpeech } = require('./modules/voice_generator');

        console.log(`\n🔄 [Retry] Manually retrying voice for Chapter ${chapterId}...`);

        // Call the voice generator directly
        const result = await processTextToSpeech(
            text,
            ttsConfig,
            outputDir || 'output_files',
            `Chapter_${chapterId}`,
            { chapterNum: chapterId, totalChapters: '?' }
        );

        if (result.success) {
            res.json({ success: true, data: result });
        } else {
            res.json({ success: false, error: result.error || 'Unknown error' });
        }

    } catch (e) {
        console.error('Retry Voice Error:', e);
        res.json({ success: false, error: e.message });
    }
});

// ===== API: TTS Config (Get/Save) =====
app.get('/api/tts-config', (req, res) => {
    const config = getTTSConfig();
    // Mask API key for security (only show last 4 chars)
    const maskedKey = config.api_key ? '****' + config.api_key.slice(-4) : '';
    res.json({
        success: true,
        config: { ...config, api_key_masked: maskedKey, has_key: !!config.api_key }
    });
});

app.post('/api/tts-config', (req, res) => {
    const { api_key, voice_id, model_id } = req.body;

    // Validate Voice ID is required
    if (voice_id !== undefined && !voice_id.trim()) {
        return res.json({ success: false, error: 'Voice ID is required!' });
    }

    const result = saveTTSConfig({ api_key, voice_id, model_id });
    if (result) {
        res.json({ success: true, message: 'TTS Config saved!' });
    } else {
        res.json({ success: false, error: 'Failed to save config' });
    }
});

// ===== API: AI Expand Style =====
app.post('/api/ai-expand-style', async (req, res) => {
    const { baseStyle } = req.body;
    if (!baseStyle) return res.json({ success: false, error: 'Missing baseStyle' });

    const prompt = `
    Nhiệm vụ: Bạn là chuyên gia định hình phong cách viết kịch bản (Tone & Voice Consultant).
    User nhập phong cách sơ sài: "${baseStyle}".
    
    Hãy viết lại thành một đoạn chỉ dẫn chi tiết (System Instruction) khoảng 100-150 từ cho AI Writer.
    Bao gồm:
    - Tone giọng cụ thể (Vd: Trầm hùng, hay châm biếm sâu cay).
    - Cấu trúc câu (Ngắn gọn đanh thép hay dài dòng văn vẻ).
    - Cách dùng từ vựng đặc trưng.
    - Ví dụ mẫu câu.
    
    Chỉ trả về nội dung chỉ dẫn, không giải thích thêm. Viết bằng tiếng Việt.
    `;

    try {
        const result = await keyManager.executeWithRetry(async (apiKey) => {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: 'gemma-3-27b-it',
                apiVersion: 'v1beta'
            });
            const response = await model.generateContent(prompt);
            return response.response.text();
        });

        res.json({ success: true, expandedStyle: result });
    } catch (e) {
        console.error('AI Expand Style Error:', e);
        res.json({ success: false, error: e.message });
    }
});

// ===== API: AI Enhance Visual Prompt =====
app.post('/api/ai-enhance-prompt', async (req, res) => {
    const { basePrompt } = req.body;
    if (!basePrompt) return res.json({ success: false, error: 'Missing basePrompt' });

    const prompt = `
    Role: Senior Prompt Engineer for Midjourney/Stable Diffusion.
    Task: Enhance this basic visual prompt into a high-quality, detailed prompt.
    Input: "${basePrompt}"
    
    Requirements:
    - Add lighting keywords (e.g., volumetric lighting, cinematic lighting, rim light).
    - Add quality keywords (e.g., 8k, masterpiece, sharp focus, highly detailed).
    - Add camera keywords if needed (e.g., wide angle, 85mm, bokeh, depth of field).
    - Add style/mood modifiers (e.g., moody, atmospheric, epic, dramatic).
    - Keep it comma-separated.
    - Output ONLY the final enhanced prompt string, no explanation.
    `;

    try {
        const result = await keyManager.executeWithRetry(async (apiKey) => {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: 'gemma-3-27b-it',
                apiVersion: 'v1beta'
            });
            const response = await model.generateContent(prompt);
            return response.response.text();
        });

        res.json({ success: true, enhancedPrompt: result.trim() });
    } catch (e) {
        console.error('AI Enhance Prompt Error:', e);
        res.json({ success: false, error: e.message });
    }
});

// ===== API: Analyze Document =====
app.post('/api/analyze-doc', upload.single('doc'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.json({ success: false, error: 'No file uploaded' });

        let textContent = "";

        // Read file based on extension
        if (file.originalname.endsWith('.txt')) {
            textContent = fs.readFileSync(file.path, 'utf8');
        } else if (file.originalname.endsWith('.docx')) {
            // Try to load mammoth if available
            try {
                const mammoth = require('mammoth');
                const result = await mammoth.extractRawText({ path: file.path });
                textContent = result.value;
            } catch (e) {
                // Mammoth not installed, read as plain text
                textContent = fs.readFileSync(file.path, 'utf8');
            }
        } else if (file.originalname.endsWith('.xlsx')) {
            // Try to load xlsx if available
            try {
                const XLSX = require('xlsx');
                const workbook = XLSX.readFile(file.path);
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                textContent = JSON.stringify(XLSX.utils.sheet_to_json(sheet), null, 2);
            } catch (e) {
                textContent = "Không đọc được file Excel. Vui lòng cài đặt: npm install xlsx";
            }
        } else {
            // Try to read as text
            textContent = fs.readFileSync(file.path, 'utf8');
        }

        // Truncate if too long
        const maxLength = 10000;
        if (textContent.length > maxLength) {
            textContent = textContent.substring(0, maxLength) + "\n... (truncated)";
        }

        // Ask Gemini to extract rules
        const prompt = `
        Đây là tài liệu hướng dẫn viết bài của người dùng.
        Bạn hãy trích xuất toàn bộ các quy tắc quan trọng để nạp vào hệ thống AI Writer.
        
        Tài liệu:
        """
        ${textContent}
        """
        
        Yêu cầu output:
        Giữ nguyên chi tiết các quy tắc, không tóm tắt quá ngắn gọn làm mất thông tin.
        Trình bày rõ ràng theo từng mục:
        - Phong cách viết (Tone & Mood)
        - Cấu trúc bài viết (Structure)
        - Các từ cấm / từ bắt buộc (Keywords)
        - Quy tắc Format (Formatting)
        - Logic Visual (nếu có)
        
        Output bằng tiếng Việt.
        `;

        const analysis = await keyManager.executeWithRetry(async (apiKey) => {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: 'gemma-3-27b-it',
                apiVersion: 'v1beta'
            }); // Use Gemma as requested
            const response = await model.generateContent(prompt);
            return response.response.text();
        });

        // Clean up temp file
        fs.unlinkSync(file.path);

        res.json({ success: true, analysis });

    } catch (e) {
        console.error('Analyze Doc Error:', e);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.json({ success: false, error: e.message });
    }
});

// ===== API: AI Suggest Negative Prompt =====
app.post('/api/ai-suggest-negative', async (req, res) => {
    try {
        const { description } = req.body; // e.g., the visual style prompt
        if (!description) return res.json({ success: false, error: 'Missing prompt' });

        const prompt = `
        Dựa vào mô tả phong cách Visual sau: "${description}"
        Hãy gợi ý một danh sách các "Negative Prompt" (các yếu tố không mong muốn) phù hợp để tránh lỗi ảnh hưởng đến style này.
        Ví dụ style cinematic thì negative là: cartoon, drawing, low quality, etc.
        
        Chỉ trả về danh sách các từ khóa tiếng Anh, cách nhau bởi dấu phẩy. Không giải thích thêm.
        `;

        const result = await keyManager.executeWithRetry(async (apiKey) => {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                apiVersion: 'v1beta'
            });
            const response = await model.generateContent(prompt);
            return response.response.text();
        });

        res.json({ success: true, suggest: result.trim() });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ===== API: Project Folder Management =====
app.post('/api/project/create-folders', (req, res) => {
    const { projectName, outputDirectory } = req.body;

    if (!projectName) {
        return res.json({ success: false, error: 'Tên project không được để trống!' });
    }

    // Sanitize project name (remove invalid characters)
    const safeName = projectName.replace(/[<>:"/\\|?*]/g, '_').trim();
    const baseDir = outputDirectory || 'C:\\Kênh';

    // Create project folder path
    const projectPath = path.join(baseDir, safeName);
    const picPath = path.join(projectPath, 'Pic');
    const vidPath = path.join(projectPath, 'Vid');

    try {
        // Create main project folder
        if (!fs.existsSync(projectPath)) {
            fs.mkdirSync(projectPath, { recursive: true });
        }

        // Create Pic subfolder
        if (!fs.existsSync(picPath)) {
            fs.mkdirSync(picPath, { recursive: true });
        }

        // Create Vid subfolder
        if (!fs.existsSync(vidPath)) {
            fs.mkdirSync(vidPath, { recursive: true });
        }

        console.log(`📁 [Project] Created folders for: ${safeName}`);
        console.log(`   📸 Pic: ${picPath}`);
        console.log(`   🎬 Vid: ${vidPath}`);

        res.json({
            success: true,
            projectPath: projectPath,
            folders: {
                root: projectPath,
                pic: picPath,
                vid: vidPath
            }
        });
    } catch (error) {
        console.error('Error creating project folders:', error);
        res.json({ success: false, error: error.message });
    }
});

// ===== API: Generate Script =====
app.post('/api/generate-script', generateScript);

// ===== API: Generate Metadata =====
app.post('/api/generate-metadata', generateMetadata);

// ===== API: Run Pipeline =====
app.post('/api/run-pipeline', runFullPipeline);

// ===== API: Native Folder Picker (VBScript - Most Reliable) =====
app.get('/api/select-folder', (req, res) => {
    const { exec } = require('child_process');

    // Create a temporary VBScript file - this is the MOST reliable method on Windows
    const vbsContent = `
Set objShell = CreateObject("Shell.Application")
Set objFolder = objShell.BrowseForFolder(0, "Chon thu muc Output", &H0001 + &H0010, "C:\\")
If Not objFolder Is Nothing Then
    WScript.Echo objFolder.Self.Path
End If
`;

    const tempVbs = path.join(__dirname, '../temp/folder_picker.vbs');

    // Ensure temp directory exists
    const tempDir = path.dirname(tempVbs);
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // Write VBScript file
    fs.writeFileSync(tempVbs, vbsContent, 'utf8');

    console.log('📂 [System] Opening Folder Picker Dialog (VBScript)...');

    // Execute VBScript with cscript (console mode, no popup)
    exec(`cscript //nologo "${tempVbs}"`, { windowsHide: false }, (error, stdout, stderr) => {
        // Clean up temp file
        try { fs.unlinkSync(tempVbs); } catch (e) { }

        const selectedPath = stdout.trim();
        if (selectedPath) {
            console.log(`✅ [System] Selected path: ${selectedPath}`);
            res.json({ success: true, path: selectedPath });
        } else {
            console.log('❌ [System] No folder selected or cancelled.');
            res.json({ success: false, cancelled: true });
        }
    });
});

// ===== API: Backup System =====
app.post('/api/backup', async (req, res) => {
    try {
        const result = await createBackup();
        res.json(result);
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ===== Start Server =====
const db = require('./modules/database');

async function startServer() {
    try {
        await db.init();
        // Initial proxy test on startup
        console.log('🚀 Server 11testAuto starting...');
        keyManager.testProxies().then(results => {
            const liveCount = results.filter(r => r.status === 'LIVE').length;
            console.log(`✅ Initial Proxy Test: ${liveCount}/${results.length} LIVE`);
        });

        app.listen(PORT, () => {
            console.log(`🚀 Server 11testAuto running at http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('❌ Failed to initialize database:', err);
        process.exit(1);
    }
}

startServer();
