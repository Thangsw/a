const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs-extra');
const path = require('path');
const db = require('./database');

async function exportToDocx(projectId, outputPath) {
    try {
        // 1. Fetch data
        const project = await db.db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
        if (!project) throw new Error('Project not found');

        const scriptFinal = await db.db.get('SELECT * FROM script_finals WHERE project_id = ? ORDER BY created_at DESC', [projectId]);
        const modules = await db.db.all('SELECT * FROM module_scripts ms JOIN modules m ON ms.module_id = m.id WHERE m.project_id = ? ORDER BY m.module_index', [projectId]);

        if (!scriptFinal && modules.length === 0) {
            throw new Error('No script data found for this project');
        }

        const fullText = scriptFinal ? scriptFinal.full_script_text : modules.map(m => m.content).join('\n\n');

        // 2. Create Document
        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    new Paragraph({
                        text: `KỊCH BẢN: ${project.title_working || 'Dự án không tên'}`,
                        heading: HeadingLevel.HEADING_1,
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 400 }
                    }),
                    new Paragraph({
                        children: [
                            new TextRun({ text: `Kênh: `, bold: true }),
                            new TextRun(project.channel_id || 'N/A'),
                        ]
                    }),
                    new Paragraph({
                        children: [
                            new TextRun({ text: `Ngày xuất: `, bold: true }),
                            new TextRun(new Date().toLocaleString()),
                        ],
                        spacing: { after: 400 }
                    }),
                    new Paragraph({
                        text: "NỘI DUNG KỊCH BẢN",
                        heading: HeadingLevel.HEADING_2,
                        spacing: { before: 400, after: 200 }
                    }),
                    ...fullText.split('\n').map(line => {
                        const isVoiceMarker = line.includes('[PAUSE]') || line.includes('[EMPHASIS]');
                        return new Paragraph({
                            children: [
                                new TextRun({
                                    text: line,
                                    color: isVoiceMarker ? "9b59b6" : "000000",
                                    italics: isVoiceMarker
                                })
                            ],
                            spacing: { after: 120 }
                        });
                    })
                ]
            }]
        });

        // 3. Save file
        const buffer = await Packer.toBuffer(doc);
        await fs.writeFile(outputPath, buffer);

        return outputPath;
    } catch (error) {
        console.error('Error exporting to DOCX:', error);
        throw error;
    }
}

async function exportToCsv(projectId, outputPath) {
    try {
        const seo = await db.db.get('SELECT * FROM seo_bundles WHERE project_id = ?', [projectId]);
        const keywords = await db.db.get('SELECT * FROM keyword_sets WHERE project_id = ?', [projectId]);

        if (!seo && !keywords) {
            throw new Error('No SEO/Keyword data found for this project');
        }

        let csvContent = "\ufeff"; // BOM for Excel UTF-8 support
        csvContent += "Type,Content\n";

        if (seo) {
            const titles = JSON.parse(seo.titles_json || '[]');
            titles.forEach((t, i) => {
                csvContent += `Title ${i + 1},"${String(t.text || t).replace(/"/g, '""')}"\n`;
            });
            csvContent += `Description,"${String(seo.description || '').replace(/"/g, '""')}"\n`;
            csvContent += `Thumbnail Prompt,"${String(seo.thumbnail_prompt || '').replace(/"/g, '""')}"\n`;
        }

        if (keywords) {
            csvContent += `Core Keyword,"${String(keywords.core_keyword || '').replace(/"/g, '""')}"\n`;
            csvContent += `Support Keywords,"${String(keywords.support_keywords || '').replace(/"/g, '""')}"\n`;
            csvContent += `CTR Keywords,"${String(keywords.ctr_keywords || '').replace(/"/g, '""')}"\n`;
        }

        await fs.writeFile(outputPath, csvContent, 'utf8');
        return outputPath;
    } catch (error) {
        console.error('Error exporting to CSV:', error);
        throw error;
    }
}

async function saveRawResponse(projectId, taskName, data, outputDir = 'output') {
    try {
        const fileName = `RAW_${taskName}_${projectId}_${Date.now()}.json`;
        const fullPath = path.join(outputDir, fileName);
        await fs.ensureDir(outputDir);
        await fs.writeJson(fullPath, data, { spaces: 2 });
        log.info(`💾 [Export] Đã lưu phản hồi RAW của AI: ${fileName}`);
        return fullPath;
    } catch (err) {
        console.error(`❌ Lỗi lưu phản hồi RAW:`, err.message);
    }
}

module.exports = {
    exportToDocx,
    exportToCsv,
    saveRawResponse
};
