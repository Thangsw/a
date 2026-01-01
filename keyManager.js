const { loadConfig, saveConfig } = require('./config');
const { HttpsProxyAgent } = require('https-proxy-agent');

// ANSI Color Codes for CMD Console
const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',      // Errors, DEAD
    green: '\x1b[32m',    // Success, LIVE
    yellow: '\x1b[33m',   // Warning, BUSY, In Progress
    blue: '\x1b[34m',     // Info
    magenta: '\x1b[35m',  // Special
    cyan: '\x1b[36m',     // Highlight
    bold: '\x1b[1m'
};

class KeyManager {
    constructor() {
        this.keys = [];           // Array of key strings
        this.proxies = [];        // Array of proxy strings
        this.keyStatus = {};      // { key: { status: 'LIVE'|'BUSY'|'COOLING'|'DEAD', lastChecked: timestamp } }
        this.proxyStatus = {};    // { proxy: { status: 'LIVE'|'DEAD', msg: string } }
        this.currentIndex = 0;
        this.proxyIndex = 0;
        this.refreshKeys();
    }

    // Refresh keys and proxies from config file
    refreshKeys() {
        try {
            const config = loadConfig();
            let rawKeys = config.GEMINI_API_KEYS || [];
            let rawProxies = config.PROXIES || [];

            // DEDUPLICATE KEYS
            const uniqueKeys = [...new Set(rawKeys)].filter(k => k && k.trim());
            this.proxies = [...new Set(rawProxies)].filter(p => p && p.trim());

            if (uniqueKeys.length !== rawKeys.length) {
                console.log(`${COLORS.yellow}🔄 KeyManager: Deduplicated keys (${rawKeys.length} -> ${uniqueKeys.length})${COLORS.reset}`);
            }

            this.keys = uniqueKeys;

            // Initialize status for new keys
            this.keys.forEach(key => {
                if (!this.keyStatus[key]) {
                    this.keyStatus[key] = { status: 'LIVE', lastChecked: 0 };
                }
            });

            // Cleanup old keys from status object
            Object.keys(this.keyStatus).forEach(key => {
                if (!this.keys.includes(key)) {
                    delete this.keyStatus[key];
                }
            });

            if (this.currentIndex >= this.keys.length) {
                this.currentIndex = 0;
            }
            if (this.proxyIndex >= this.proxies.length) {
                this.proxyIndex = 0;
            }

            console.log(`${COLORS.green}🔑 KeyManager đã nạp: ${this.keys.length} keys, ${this.proxies.length} proxies khả dụng.${COLORS.reset}`);
        } catch (e) {
            console.error(`${COLORS.red}Lỗi khi làm mới keys:${COLORS.reset}`, e.message);
        }
    }

    // Get all available keys
    getAllKeys() {
        if (this.keys.length === 0) this.refreshKeys();
        return [...this.keys];
    }

    // Get next available (non-BUSY, non-COOLING) key
    getNextAvailableKey() {
        if (this.keys.length === 0) this.refreshKeys();
        if (this.keys.length === 0) throw new Error("No API Keys configured!");

        const now = Date.now();
        const BUSY_COOLDOWN = 60000;       // 60s for errors (per user request)
        const COOLING_COOLDOWN = 65000;    // 65s for normal usage (Smart Queue)

        for (let i = 0; i < this.keys.length; i++) {
            const idx = (this.currentIndex + i) % this.keys.length;
            const key = this.keys[idx];
            const status = this.keyStatus[key];

            if (status.status === 'DEAD') continue;

            // Recover BUSY keys
            if (status.status === 'BUSY' && (now - status.lastChecked) > BUSY_COOLDOWN) {
                status.status = 'LIVE';
                console.log(`${COLORS.cyan}🔄 Key ${idx} đã hết thời gian chờ BUSY, đặt lại thành LIVE${COLORS.reset}`);
            }

            // Recover COOLING keys
            if (status.status === 'COOLING' && (now - status.lastChecked) > COOLING_COOLDOWN) {
                status.status = 'LIVE';
                console.log(`${COLORS.green}🍃 Key ${idx} đã xả nhiệt xong, quay lại Pool${COLORS.reset}`);
            }

            if (status.status === 'LIVE') {
                this.currentIndex = (idx + 1) % this.keys.length;
                return key;
            }
        }

        return null;
    }

    // Mark key as cooling down after successful usage
    markKeyCooling(key) {
        if (this.keyStatus[key]) {
            this.keyStatus[key].status = 'COOLING';
            this.keyStatus[key].lastChecked = Date.now();
            const idx = this.keys.indexOf(key);
            console.log(`${COLORS.blue}❄️ Key ${idx} đang được xả nhiệt (65s)...${COLORS.reset}`);
        }
    }

    // Get next proxy in rotation (only LIVE ones if tested)
    getNextProxy() {
        if (this.proxies.length === 0) return null;

        // Try to find a LIVE proxy in rotation
        for (let i = 0; i < this.proxies.length; i++) {
            const idx = (this.proxyIndex + i) % this.proxies.length;
            const p = this.proxies[idx];
            const status = this.proxyStatus[p];

            // If not tested yet or LIVE, use it
            if (!status || status.status === 'LIVE') {
                this.proxyIndex = (idx + 1) % this.proxies.length;
                return p;
            }
        }

        // If all DEAD (tested), fallback to any
        const p = this.proxies[this.proxyIndex];
        this.proxyIndex = (this.proxyIndex + 1) % this.proxies.length;
        return p;
    }

    async testProxies() {
        console.log(`${COLORS.cyan}🌐 Đang kiểm tra ${this.proxies.length} proxies...${COLORS.reset}`);
        const axios = require('axios');
        const { HttpsProxyAgent } = require('https-proxy-agent');

        const results = await Promise.all(this.proxies.map(async (proxy) => {
            try {
                const [host, port, user, pass] = proxy.split(':');
                const proxyUrl = user && pass ? `http://${user}:${pass}@${host}:${port}` : `http://${proxy}`;
                const agent = new HttpsProxyAgent(proxyUrl);
                const startTime = Date.now();
                // Test against a simple reliable endpoint
                await axios.get('https://www.google.com', {
                    httpsAgent: agent,
                    timeout: 5000
                });
                const latency = Date.now() - startTime;
                this.proxyStatus[proxy] = { status: 'LIVE', msg: `${latency}ms` };
                return { proxy, status: 'LIVE', latency };
            } catch (error) {
                this.proxyStatus[proxy] = { status: 'DEAD', msg: error.message };
                return { proxy, status: 'DEAD', error: error.message };
            }
        }));

        const liveCount = results.filter(r => r.status === 'LIVE').length;
        console.log(`${COLORS.green}🌐 Kiểm tra Proxy hoàn tất: ${liveCount}/${this.proxies.length} LIVE${COLORS.reset}`);
        return results;
    }

    markKeyBusy(key) {
        if (this.keyStatus[key]) {
            const idx = this.keys.indexOf(key);
            if (this.keyStatus[key].status !== 'BUSY') {
                console.log(`${COLORS.yellow}⛔ Key ${idx} bị đánh dấu BUSY - sẽ tạm nghỉ 60s${COLORS.reset}`);
            }
            this.keyStatus[key].status = 'BUSY';
            this.keyStatus[key].lastChecked = Date.now();
        }
    }

    markKeyDead(key) {
        if (this.keyStatus[key]) {
            this.keyStatus[key].status = 'DEAD';
            this.keyStatus[key].lastChecked = Date.now();
            const idx = this.keys.indexOf(key);
            console.log(`${COLORS.red}💀 Key ${idx} bị đánh dấu DEAD - ngưng sử dụng${COLORS.reset}`);
        }
    }

    rotateKey() {
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    }

    getKeyCount() {
        if (this.keys.length === 0) this.refreshKeys();
        return this.keys.length;
    }

    getLiveKeyCount() {
        return Object.values(this.keyStatus).filter(s => s.status === 'LIVE').length;
    }

    async executeWithRetry(apiCallFunction) {
        let attempts = 0;
        const maxAttempts = Math.max(this.keys.length * 2, 20); // Allow more attempts for massive batch

        while (attempts < maxAttempts) {
            let currentKey = this.getNextAvailableKey();
            let currentProxy = this.getNextProxy();

            if (!currentKey) {
                attempts++;
                const waitTime = 60000; // Nghỉ đúng 60s như yêu cầu
                console.log(`${COLORS.yellow}⏳ Đang đợi ${waitTime / 1000}s cho Key hồi phục... (lượt thử ${attempts}/${maxAttempts})${COLORS.reset}`);
                await new Promise(r => setTimeout(r, waitTime));
                // Note: Trạng thái BUSY sẽ tự hồi phục trong getNextAvailableKey() dựa trên timestamp
                continue;
            }

            const keyIdx = this.keys.indexOf(currentKey);
            const keyDisplay = currentKey.length > 10 ? `...${currentKey.substring(currentKey.length - 10)}` : currentKey;
            const proxyLog = currentProxy ? ` qua Proxy ${currentProxy.split(':')[0]}...` : "";
            console.log(`${COLORS.cyan}🔑 Sử dụng Key ${keyIdx}: ${keyDisplay}${proxyLog}${COLORS.reset}`);

            try {
                const result = await apiCallFunction(currentKey, currentProxy);
                this.markKeyCooling(currentKey); // ✅ Kích hoạt cơ chế nghỉ để xoay vòng key
                return result;
            } catch (error) {
                if (!error) error = new Error("Unknown error (null caught)");
                const errMsg = error.message || "";
                const status = error.status || (error.response ? error.response.status : null);

                const isQuotaError = errMsg.includes("429") || errMsg.includes("Quota") ||
                    errMsg.includes("Too Many Requests") || errMsg.includes("503") ||
                    errMsg.includes("Overloaded") || status === 429 || status === 503 ||
                    errMsg.includes("exhausted");

                // NETWORK ERRORS (Connection Reset, DNS, etc.)
                const isNetworkError = errMsg.includes("fetch failed") ||
                    errMsg.includes("ECONNRESET") ||
                    errMsg.includes("ETIMEDOUT") ||
                    errMsg.includes("ENOTFOUND") ||
                    errMsg.includes("network error");

                const isBlockedKey = errMsg.includes("403") || errMsg.includes("Forbidden") ||
                    errMsg.includes("location") || status === 403;

                const isDeadKey = errMsg.includes("API_KEY_INVALID") || errMsg.includes("401") ||
                    status === 401;

                if (isNetworkError) {
                    console.error(`${COLORS.magenta}🌐 Lỗi mạng (Reset/Timeout) trên Key ${keyIdx}. Đang thử lại sau 2s...${COLORS.reset}`);
                    attempts++;
                    await new Promise(r => setTimeout(r, 2000));
                    continue; // RETRY WITHOUT MARKING BUSY
                } else if (isQuotaError) {
                    console.log(`${COLORS.yellow}⚠️ Lỗi Quota/Server (Status: ${status}) trên Key ${keyIdx}: ${errMsg.substring(0, 150)}${COLORS.reset}`);
                    this.markKeyBusy(currentKey);
                    attempts++;
                    await new Promise(r => setTimeout(r, 1000));
                } else if (isBlockedKey) {
                    console.error(`${COLORS.red}❌ Key ${keyIdx} Blocked (403). Xóa tạm thời.${COLORS.reset}`);
                    try {
                        const path = require('path');
                        const fs = require('fs');
                        fs.appendFileSync(path.join(__dirname, '../../DEAD_KEYS.txt'), `${new Date().toLocaleString()} - Blocked (403): ${currentKey}\n`);
                    } catch (e) { }
                    this.keys.splice(keyIdx, 1);
                    if (this.currentIndex >= this.keys.length) this.currentIndex = 0;
                } else if (isDeadKey) {
                    console.log(`${COLORS.red}💀 Lỗi Key không hợp lệ trên Key ${keyIdx}: ${errMsg.substring(0, 100)}${COLORS.reset}`);
                    try {
                        const path = require('path');
                        const fs = require('fs');
                        fs.appendFileSync(path.join(__dirname, '../../DEAD_KEYS.txt'), `${new Date().toLocaleString()} - Dead (401/Invalid): ${currentKey}\n`);
                    } catch (e) { }
                    this.markKeyDead(currentKey);
                    attempts++;
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    console.error(`${COLORS.red}❌ Lỗi nghiêm trọng với Key ${keyIdx}:${COLORS.reset}`, errMsg);
                    throw error;
                }
            }
        }
        throw new Error(`TẤT CẢ API KEYS ĐÃ CẠN KIỆT. Đã thử ${attempts} lần.`);
    }

    getStatusSummary() {
        const summary = { live: 0, busy: 0, cooling: 0, dead: 0 };
        this.keys.forEach(key => {
            const status = this.keyStatus[key]?.status || 'LIVE';
            if (status === 'LIVE') summary.live++;
            else if (status === 'BUSY') summary.busy++;
            else if (status === 'COOLING') summary.cooling++;
            else if (status === 'DEAD') summary.dead++;
        });
        return summary;
    }

    getKeyStatuses() {
        const results = {};
        this.keys.forEach(key => {
            results[key] = this.keyStatus[key]?.status || 'LIVE';
        });
        return results;
    }
}

module.exports = new KeyManager();
