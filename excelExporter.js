const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

/**
 * Xuất danh sách prompt ra file Excel dựa trên mẫu storyboard_prompts.xlsx
 * @param {Array} results - Mảng kết quả từ các chương (đã được gom lại)
 * @param {string} outputPath - Đường dẫn file excel đầu ra
 * @param {string} templatePath - Đường dẫn file mẫu
 */
function exportPromptsToExcel(results, outputPath, templatePath) {
    try {
        console.log(`📊 [Excel] Đang chuẩn bị xuất dữ liệu ra: ${outputPath}`);

        // 1. Đọc file mẫu
        let workbook;
        if (fs.existsSync(templatePath)) {
            workbook = xlsx.readFile(templatePath);
        } else {
            console.warn(`⚠️ [Excel] Không tìm thấy file mẫu tại ${templatePath}. Tạo file mới.`);
            workbook = xlsx.utils.book_new();
            const ws = xlsx.utils.aoa_to_sheet([["Shot Number", "Voice", "Image Prompt", "Image to Video", "Text to Video", "BatchFrame Prompt"]]);
            xlsx.utils.book_append_sheet(workbook, ws, "Storyboard Prompts");
        }

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // 2. Chuẩn bị dữ liệu
        const allScenes = [];
        results.forEach(chapter => {
            // Case 1: Multiple scenes (Standard Pipeline)
            if (chapter.visual_prompts && Array.isArray(chapter.visual_prompts)) {
                chapter.visual_prompts.forEach((p, idx) => {
                    allScenes.push({
                        shotNumber: allScenes.length + 1,
                        voice: p.text_segment || "",
                        imagePrompt: p.prompt || "",
                        videoPrompt: p.video_prompt || ""
                    });
                });
            }
            // Case 2: Single scene (Verification Script / Single Chapter Test)
            else if (chapter.visual_prompt) {
                allScenes.push({
                    shotNumber: allScenes.length + 1,
                    voice: chapter.content_for_tts?.substring(0, 300) || "",
                    imagePrompt: chapter.visual_prompt || "",
                    videoPrompt: chapter.video_prompt || ""
                });
            }
        });

        // 3. Ghi dữ liệu vào worksheet
        // Mapping as per storyboard_prompts.xlsx:
        // A: Shot (0), B: Voice (1), C: Image Prompt (2), F: BatchFrame Prompt (5)

        // Clear existing data safely by checking worksheet range
        const existingRange = worksheet['!ref'] ? xlsx.utils.decode_range(worksheet['!ref']) : { s: { r: 1, c: 0 }, e: { r: 100, c: 5 } };
        for (let r = 1; r <= Math.max(existingRange.e.r, allScenes.length); r++) {
            ['A', 'B', 'C', 'D', 'E', 'F'].forEach(col => {
                const cellRef = col + (r + 1);
                if (worksheet[cellRef]) delete worksheet[cellRef];
            });
        }

        allScenes.forEach((scene, index) => {
            const setCell = (r, c, val) => {
                const cellRef = xlsx.utils.encode_cell({ r: r, c: c });
                let finalVal = val;

                if (val && typeof val === 'object') {
                    // Ưu tiên lấy trường prompt hoặc text nếu là object phức tạp
                    finalVal = val.prompt || val.video_prompt || val.image_prompt || JSON.stringify(val);
                }

                worksheet[cellRef] = { t: 's', v: finalVal ? String(finalVal) : "" };
            };

            const r = index + 1; // 0-based index: row 0 is header
            setCell(r, 0, scene.shotNumber); // Cột A
            setCell(r, 1, scene.voice);      // Cột B
            setCell(r, 2, scene.imagePrompt);// Cột C

            // Cột F (index 5): BatchFrame Prompt
            // Logic: Nếu là N+1, shot cuối sẽ không có video_prompt hoặc là "Static..." 
            // Nếu là 1:1, shot cuối vẫn có video_prompt riêng.
            // Để an toàn và linh hoạt: Nếu videoPrompt rỗng hoặc là mặc định và đó là shot cuối, để N/A.
            let vPrompt = scene.videoPrompt;
            if (index === allScenes.length - 1 && (!vPrompt || String(vPrompt).toLowerCase().includes("static"))) {
                vPrompt = "N/A (Last shot)";
            }
            setCell(r, 5, vPrompt || "N/A");
        });

        // Update range
        worksheet['!ref'] = xlsx.utils.encode_range({
            s: { r: 0, c: 0 },
            e: { r: allScenes.length, c: 5 }
        });

        // 4. Lưu file
        xlsx.writeFile(workbook, outputPath);
        console.log(`✅ [Excel] Đã xuất file thành công tại: ${outputPath}`);
        return { success: true, path: outputPath };

    } catch (error) {
        console.error(`❌ [Excel] Lỗi xuất file: ${error.message}`);
        return { success: false, error: error.message };
    }
}

module.exports = { exportPromptsToExcel };
