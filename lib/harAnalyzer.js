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

    transform2SimplifiedData(harData, url, group) {
        const data = {
            'url': url,
            'rules': this.config.rules,
            'all-styles': [],
            'htmls': [],
            'style-elements': [],
            'style-attributes': [],
            'style-files': []
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
            };
            if (res.content.mimeType.includes('html')) {
                data.htmls.push(obj);
            }
            else if (res.content.mimeType.includes('css')) {
                data['all-styles'].push(obj);
                data['style-files'].push(obj);
            }

            reqIndex++;
        }

        // Extract <style> elements from HTML content
        for (const htmlObj of data.htmls) {
            const dom = new JSDOM(htmlObj.content);
            const styleElements = dom.window.document.querySelectorAll('style');
            styleElements.forEach((styleElement, index) => {
                const styleElementObj = {
                    'url': htmlObj.url,
                    'content': styleElement.textContent,
                    'index': htmlObj.index
                };
                data['all-styles'].push(styleElementObj);
                data['style-elements'].push(styleElementObj);
            });
        }

        return data;
    }

    async createKnowledgeFromData(analyzedData, url, group) {
        let knowledgeData = {
            'url': url,
            'group': group,
            'issues': [],
            'resolved': []
        };

        if (analyzedData === undefined) {
            return knowledgeData;
        }

        if (!('all-styles' in analyzedData)) {
            return knowledgeData;
        }

        try {
            // Ensure the correct context for `this` using arrow function
            const lintPromises = analyzedData['all-styles'].map(entry => {
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
                            text: warning.text,
                            line: warning.line,
                            column: warning.column
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

        const analyzedData = this.transform2SimplifiedData(harData, url, group);
        if (!('analyzedData' in this.groups[group])) {
            this.groups[group]['analyzedData'] = []
        }
        this.groups[group]['analyzedData'].push(analyzedData);

        const knowledgeData = await this.createKnowledgeFromData(analyzedData, url, group);
        if (!('knowledgeData' in this.groups[group])) {
            this.groups[group]['knowledgeData'] = []
        }
        this.groups[group]['knowledgeData'].push(knowledgeData);

        return {
            'url': url,
            'analyzedData': analyzedData,
            'knowledgeData': knowledgeData
        };
    }

    getSummary() {
        return this;
    }
}