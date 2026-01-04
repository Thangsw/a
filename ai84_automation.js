/**
 * AI84.pro UI Automation Module
 * Monitors task status via Puppeteer by listening to network responses
 */

const { launchChrome, getChromePage } = require('./chromeManager');

class AI84Automation {
    static async ensureBrowser() {
        try {
            console.log(`🚀 [AI84-UI] Opening browser for 'ai84' profile...`);
            await launchChrome('ai84');
            const page = getChromePage('ai84');

            const currentUrl = page.url();
            if (!currentUrl.includes('ai84.pro/app')) {
                console.log(`   🌐 Navigating to AI84 App...`);
                await page.goto('https://ai84.pro/app', { waitUntil: 'networkidle2', timeout: 60000 });
            }
            console.log(`   ✅ Browser ready. Please ensure you are logged in.`);
            return true;
        } catch (e) {
            if (e.message.includes('already running') || e.message.includes('already open')) {
                console.log(`   💡 [AI84-UI] Bạn đang mở Chrome profile 'ai84' thủ công.`);
                console.log(`      Để script có thể 'nghe' được trình duyệt, vui lòng đóng Chrome thủ công trước khi chạy hoặc để script tự động chuyển sang Polling API.`);
                return true;
            }
            throw e;
        }
    }

    static async watchTask(taskId, expectedText = null, timeoutMs = 20000) {
        console.log(`🔍 [AI84-UI] Listening for task completion. ID: ${taskId}${expectedText ? ` | Text: "${expectedText.substring(0, 30)}..."` : ''}`);

        let page;
        try {
            page = getChromePage('ai84');
        } catch (e) {
            // Silently fail to UI Watch if browser is not available, ai84_voice will fallback to API
            throw new Error(`Chrome not open for lane: ai84`);
        }

        if (!page || page.isClosed()) {
            throw new Error(`Chrome page is not available`);
        }

        return new Promise((resolve, reject) => {
            let isResolved = false;

            const cleanup = () => {
                isResolved = true;
                page.off('response', responseHandler);
            };

            const responseHandler = async (response) => {
                if (isResolved) return;

                const url = response.url();
                if (url.includes('/v1/tasks') && url.includes('type=tts')) {
                    try {
                        const result = await response.json();
                        if (result.success && Array.isArray(result.data)) {
                            // Find by ID OR by Text match (handle potential ID mismatch in UI)
                            const task = result.data.find(t => {
                                const idMatch = t.id === taskId;
                                const cleanTarget = expectedText ? expectedText.replace(/<[^>]*>/g, '').substring(0, 100) : '';
                                const cleanSource = t.metadata?.text ? t.metadata.text.replace(/<[^>]*>/g, '').substring(0, 100) : '';
                                const textMatch = expectedText && cleanSource.includes(cleanTarget);
                                return idMatch || textMatch;
                            });

                            if (task) {
                                // Silence progress logging to reduce noise as requested
                                // if (task.progress !== undefined) {
                                //     console.log(`   [AI84-UI] Task ${taskId.substring(0, 8)}: status=${task.status}, progress=${task.progress}%`);
                                // }

                                if (task.status === 'done' || task.status === 'completed') {
                                    cleanup();
                                    resolve({
                                        success: true,
                                        status: task.status,
                                        progress: 100,
                                        audio_url: task.metadata?.audio_url,
                                        srt_url: task.metadata?.transcript_url || task.metadata?.srt_url
                                    });
                                } else if (task.status === 'failed') {
                                    cleanup();
                                    reject(new Error(`AI84 Task Failed: ${task.error_message || 'Unknown error'}`));
                                }
                            }
                        }
                    } catch (e) { }
                }
            };

            page.on('response', responseHandler);

            setTimeout(() => {
                if (!isResolved) {
                    cleanup();
                    reject(new Error(`AI84 UI Watch Timeout after ${timeoutMs / 1000}s`));
                }
            }, timeoutMs);
        });
    }
}

module.exports = AI84Automation;
