import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint'; // ES module import for stylelint

export class HarAnalyzer {
    constructor() {
        this.groups = {};

        // Read and parse the configuration file
        const libFolder = fileURLToPath(new URL('..', import.meta.url));
        this.pluginFolder = path.resolve(libFolder, '..');
        const configPath = path.resolve(libFolder, 'configurations', 'css-stylelint-standard.json');
        this.config = JSON.parse(readFileSync(configPath, 'utf8'));
    }

    transform2SimplifiedData(harData, group) {
        const data = {
            'all': [],
            'htmls': [],
            'style-elements': [],
            'style-attributes': [],
            'style-files': [],
            'script-elements': [],
            'script-attributes': [],
            'script-files': []
        };

        if ('log' in harData) {
            harData = harData['log'];
        }

        let reqIndex = 1;

        for (const entry of harData.entries) {
            const req = entry.request;
            const res = entry.response;
            const reqUrl = req.url;

            if (!res.content || !res.content.text || !res.content.mimeType || !res.content.size || res.content.size <= 0 || !res.status) {
                continue;
            }

            const obj = {
                'url': reqUrl,
                'content': res.content.text,
                'index': reqIndex
            }
            if (res.content.mimeType.includes('html')) {
                data.all.push(obj);
                data.htmls.push(obj);
            }
            else if (res.content.mimeType.includes('css')) {
                data.all.push(obj);
                data['style-files'].push(obj);
            }
            else if (res.content.mimeType.includes('javascript')) {
                data.all.push(obj);
                data['script-files'].push(obj);
            }

            reqIndex++;
        }
        return data;
    }

    async createKnowledgeFromData(analyzedData, knowledgeData, url, group) {
        if (!knowledgeData) {
            knowledgeData = {
                'issues': [],
                'resolved': [],
                'rules': {}
            };
        }

        if (analyzedData === undefined) {
            return knowledgeData;
        }

        if (!('all' in analyzedData)) {
            return knowledgeData;
        }

        knowledgeData['rules'] = this.config.rules;

        try {
            // Ensure the correct context for `this` using arrow function
            const lintPromises = analyzedData.all.map(entry => {
                return stylelint.lint({
                    code: entry.content,
                    config: this.config
                }).then(result => {
                    // Attach warnings along with the entry.url
                    return result.results.flatMap(res => 
                        res.warnings.map(warning => ({
                            url: entry.url,
                            rule: warning.rule,
                            severity: warning.severity,
                            text: warning.text
                            // warning: warning
                        }))
                    );
                });
            });
    
            // Wait for all linting promises to resolve and flatten the results
            const lintResults = await Promise.all(lintPromises);
            knowledgeData.issues = lintResults.flat();

            // Sort the warnings by severity: "error" first, then "warning"
            // const severityOrder = { error: 1, warning: 2 };
            // knowledgeData.issues.sort((a, b) => {
            //     return severityOrder[a.warning.severity] - severityOrder[b.warning.severity];
            // });
        } catch (err) {
        }

        return knowledgeData;
    }

    async analyzeData(url, harData, group) {
        if (this.groups[group] === undefined) {
            this.groups[group] = {};
        }

        const analyzedData = this.transform2SimplifiedData(harData, group);
        if (!('analyzedData' in this.groups[group])) {
            this.groups[group]['analyzedData'] = []
        }
        this.groups[group]['analyzedData'].push(analyzedData);

        const knowledgeData = await this.createKnowledgeFromData(analyzedData, this.groups[group]['knowledgeData'], url, group);
        this.groups[group]['knowledgeData'] = knowledgeData;

        return this.groups[group];
    }

    getSummary() {
        return this;
    }
}