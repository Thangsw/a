/**
 * Test script for Local Voice Generator
 * Tests Edge-TTS + Faster-Whisper pipeline
 */

const { LocalVoiceGenerator } = require('./localVoiceGenerator');
const path = require('path');
const fs = require('fs-extra');
const { log } = require('./colors');

async function testLocalVoice() {
    log.info("🧪 Testing Local Voice Generator...\n");

    // Test text (German psychology content)
    const testText = `
Warum fühlen wir uns oft machtlos in Beziehungen?
Die Antwort liegt in einem psychologischen Mechanismus namens "konditionierte Hilflosigkeit".
Dieser Begriff wurde durch Experimente von Martin Seligman geprägt.
Wenn Menschen wiederholt negative Erfahrungen machen, ohne sie kontrollieren zu können,
lernen sie, dass ihre Handlungen keine Auswirkungen haben.
Dies führt zu einem Gefühl der Hilflosigkeit, selbst wenn Fluchtmöglichkeiten vorhanden sind.
    `.trim();

    // Create test output directory
    const outputDir = path.join(__dirname, 'test_output');
    await fs.ensureDir(outputDir);

    try {
        // TEST 1: Edge-TTS (RECOMMENDED)
        log.info("=".repeat(60));
        log.info("TEST 1: Edge-TTS + Faster-Whisper");
        log.info("=".repeat(60));

        const voiceGen = new LocalVoiceGenerator({
            ttsEngine: 'edge-tts',
            whisperModel: 'medium',
            language: 'de',
            voiceId: 'de-DE-ConradNeural'
        });

        const result = await voiceGen.process(
            testText,
            'test_project',
            outputDir
        );

        log.success("\n✅ TEST 1 PASSED");
        log.info(`   Audio: ${result.audio_path}`);
        log.info(`   Duration: ${result.audio_duration}s`);
        log.info(`   SRT: ${result.srt_path}`);
        log.info(`   Segments: ${result.srt_segments}`);
        log.info(`   Scenes: ${result.visual_specs.num_scenes}`);

        // TEST 2: Audio file validation
        log.info("\n" + "=".repeat(60));
        log.info("TEST 2: File Validation");
        log.info("=".repeat(60));

        const audioExists = await fs.pathExists(result.audio_path);
        const srtExists = await fs.pathExists(result.srt_path);
        const audioStats = await fs.stat(result.audio_path);
        const srtStats = await fs.stat(result.srt_path);

        log.info(`   Audio exists: ${audioExists ? '✅' : '❌'}`);
        log.info(`   Audio size: ${(audioStats.size / 1024).toFixed(1)} KB`);
        log.info(`   SRT exists: ${srtExists ? '✅' : '❌'}`);
        log.info(`   SRT size: ${(srtStats.size / 1024).toFixed(1)} KB`);

        if (audioExists && srtExists && audioStats.size > 0 && srtStats.size > 0) {
            log.success("\n✅ TEST 2 PASSED");
        } else {
            throw new Error("File validation failed");
        }

        // TEST 3: SRT content validation
        log.info("\n" + "=".repeat(60));
        log.info("TEST 3: SRT Content Validation");
        log.info("=".repeat(60));

        const srtContent = await fs.readFile(result.srt_path, 'utf-8');
        const srtLines = srtContent.split('\n').filter(line => line.trim());

        log.info(`   SRT lines: ${srtLines.length}`);
        log.info(`   First 5 lines:`);
        srtLines.slice(0, 5).forEach(line => log.info(`      ${line}`));

        if (srtLines.length > 0) {
            log.success("\n✅ TEST 3 PASSED");
        } else {
            throw new Error("SRT content is empty");
        }

        // TEST 4: Scene mapping validation
        log.info("\n" + "=".repeat(60));
        log.info("TEST 4: Scene Mapping Validation");
        log.info("=".repeat(60));

        const scenes = result.scene_mapping;
        log.info(`   Total scenes: ${scenes.length}`);

        if (scenes.length > 0) {
            log.info(`   First scene:`);
            log.info(`      Text: ${scenes[0].scene_text?.substring(0, 60)}...`);
            log.info(`      Duration: ${scenes[0].duration}s`);
            log.info(`      Image prompt: ${scenes[0].image_prompt?.substring(0, 60)}...`);
            log.success("\n✅ TEST 4 PASSED");
        } else {
            throw new Error("No scenes generated");
        }

        // Summary
        log.info("\n" + "=".repeat(60));
        log.success("🎉 ALL TESTS PASSED!");
        log.info("=".repeat(60));
        log.info(`\nGenerated files:`);
        log.info(`   📁 ${result.audio_path}`);
        log.info(`   📁 ${result.srt_path}`);
        log.info(`\nStatistics:`);
        log.info(`   ⏱️  Audio duration: ${result.audio_duration.toFixed(1)}s`);
        log.info(`   📝 SRT segments: ${result.srt_segments}`);
        log.info(`   🎬 Video scenes: ${result.visual_specs.num_scenes}`);
        log.info(`   💾 Total size: ${((audioStats.size + srtStats.size) / 1024).toFixed(1)} KB`);

    } catch (err) {
        log.error(`\n❌ TEST FAILED: ${err.message}`);
        console.error(err);
        process.exit(1);
    }
}

// Run tests
testLocalVoice().catch(err => {
    log.error(`Fatal error: ${err.message}`);
    process.exit(1);
});
