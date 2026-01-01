// Use dynamic import for sqlite-async since it is an ES Module
let Database;

const path = require('path');
const fs = require('fs');
const { log } = require('./colors');

const DB_PATH = path.join(__dirname, '../../database.sqlite');

class SHUDatabase {
    constructor() {
        this.db = null;
    }

    async init() {
        try {
            // Dynamically import sqlite-async
            if (!Database) {
                const sqliteAsync = await import('sqlite-async');
                Database = sqliteAsync.Database;
            }

            this.db = await Database.open(DB_PATH);
            await this.createTables();

            // Migration: Add analysis_result to projects if missing
            try {
                await this.db.run('ALTER TABLE projects ADD COLUMN analysis_result TEXT');
                log.info('✨ Database Migration: Added analysis_result column to projects');
            } catch (e) {
                // Column likely already exists, ignore
            }

            log.success('✅ SHU Database Initialized');
        } catch (err) {
            log.error(`❌ Database Init Error: ${err.message}`);
            throw err;
        }
    }

    async createTables() {
        const schema = `
            CREATE TABLE IF NOT EXISTS channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                niche TEXT,
                language TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id INTEGER,
                title_working TEXT,
                preset_type TEXT,
                status TEXT DEFAULT 'draft',
                analysis_result TEXT, -- JSON result from Step 1 & 1.5
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (channel_id) REFERENCES channels(id)
            );

            CREATE TABLE IF NOT EXISTS competitor_scripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER UNIQUE,
                source_type TEXT,
                source_url TEXT,
                raw_text TEXT,
                analyzed_data TEXT, -- JSON string
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS keyword_sets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER UNIQUE,
                core_keyword TEXT,
                support_keywords TEXT, -- JSON string array
                ctr_phrases TEXT, -- JSON string array
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS modules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                module_index INTEGER,
                module_type TEXT, -- HOOK, CONTEXT, etc.
                word_target INTEGER,
                title TEXT,
                key_points TEXT,
                role TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS module_scripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                module_id INTEGER UNIQUE,
                content_text TEXT,
                cliff_text TEXT,
                ai_prompt_version TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (module_id) REFERENCES modules(id)
            );

            CREATE TABLE IF NOT EXISTS script_finals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER UNIQUE,
                full_script_text TEXT,
                voice_markers TEXT, -- JSON string
                version TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS seo_bundles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER UNIQUE,
                titles TEXT, -- JSON array
                description_text TEXT,
                tags TEXT, -- JSON array
                thumbnail_text TEXT,
                thumbnail_prompt TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS prompt_library (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                niche_type TEXT,
                task_type TEXT,
                prompt_text TEXT,
                version TEXT,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS ai_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                task_type TEXT,
                prompt_version TEXT,
                tokens_used INTEGER,
                raw_response TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );
        `;

        const commands = schema.split(';').map(cmd => cmd.trim()).filter(Boolean);
        for (const cmd of commands) {
            await this.db.run(cmd);
        }
    }

    // --- Channel Helpers ---
    async createChannel(name, niche, language) {
        const result = await this.db.run(
            'INSERT INTO channels (name, niche, language) VALUES (?, ?, ?)',
            [name, niche, language]
        );
        return result.lastID;
    }

    // --- Project Helpers ---
    async createProject(channelId, titleWorking, presetType) {
        const result = await this.db.run(
            'INSERT INTO projects (channel_id, title_working, preset_type) VALUES (?, ?, ?)',
            [channelId, titleWorking, presetType]
        );
        return result.lastID;
    }

    async getProject(projectId) {
        return await this.db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
    }

    // --- Prompt Helpers ---
    async getPrompt(niche, task) {
        return await this.db.get(
            'SELECT * FROM prompt_library WHERE niche_type = ? AND task_type = ? AND is_active = 1 LIMIT 1',
            [niche, task]
        );
    }

    // --- Log Helpers ---
    async logAIAction(projectId, taskType, promptVersion, tokensUsed, rawResponse) {
        try {
            await this.db.run(
                'INSERT INTO ai_logs (project_id, task_type, prompt_version, tokens_used, raw_response) VALUES (?, ?, ?, ?, ?)',
                [projectId, taskType, promptVersion, tokensUsed, typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse)]
            );
        } catch (err) {
            log.error(`❌ AI Logging Error: ${err.message}`);
        }
    }

    // --- Module Plan Helpers ---
    async saveModulePlan(projectId, planData) {
        try {
            const project = await this.getProject(projectId);
            let currentAnalysis = {};
            try {
                currentAnalysis = JSON.parse(project.analysis_result || '{}');
            } catch (e) { }

            const updatedAnalysis = {
                ...currentAnalysis,
                module_plan: planData.modules,
                plan_version: planData.version || "v1.0",
                plan_hook_score: planData.hook_score,
                total_word_estimate: planData.total_word_estimate,
                planned_at: new Date().toISOString()
            };

            await this.db.run(
                'UPDATE projects SET analysis_result = ?, status = ? WHERE id = ?',
                [JSON.stringify(updatedAnalysis), 'planned', projectId]
            );
            log.info(`📊 [DB] Module Plan ${updatedAnalysis.plan_version} saved for Project ${projectId}`);
        } catch (err) {
            log.error(`❌ DB SaveModulePlan Error: ${err.message}`);
            throw err;
        }
    }
}

module.exports = new SHUDatabase();
