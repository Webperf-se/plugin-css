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
        const configPath = path.resolve(libFolder, 'configurations', 'standard.json');
        this.config = JSON.parse(readFileSync(configPath, 'utf8'));
    }

    transform2SimplifiedData(harData, url) {
        const data = {
            'url': url,
            'rules': this.config.rules,
            'htmls': [],
            'all-styles': [],
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
            styleElements.forEach((styleElement, _index) => {
                const styleElementObj = {
                    'url': htmlObj.url,
                    'content': styleElement.textContent,
                    'index': htmlObj.index
                };
                data['all-styles'].push(styleElementObj);
                data['style-elements'].push(styleElementObj);
            });

            // Extract style="" attributes from HTML content
            const elementsWithStyleAttr = dom.window.document.querySelectorAll('[style]');
            elementsWithStyleAttr.forEach((element, _index) => {
                const styleAttrContent = element.getAttribute('style');
                const styleAttrObj = {
                    'url': htmlObj.url,
                    // Wrap the style attribute content in a dummy #id rule
                    'content': `#dummy-style-attribute-id { ${styleAttrContent} }`,
                    'index': htmlObj.index
                };
                data['all-styles'].push(styleAttrObj);
                data['style-attributes'].push(styleAttrObj);
            });
        }

        return data;
    }

    async createKnowledgeFromData(analyzedData, url, group) {
        let knowledgeData = {
            'url': url,
            'group': group,
            'issues': [],
            'resolved-rules': []
        };

        if (analyzedData === undefined) {
            return knowledgeData;
        }

        if (!('all-styles' in analyzedData)) {
            return knowledgeData;
        }

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
                        category: 'standard',
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

        // Populate "resolved-rules" with rules not mentioned in "issues"
        const allRules = Object.keys(this.config.rules);
        const mentionedRules = new Set(knowledgeData.issues.map(issue => issue.rule));
        knowledgeData['resolved-rules'] = allRules.filter(rule => !mentionedRules.has(rule));

        return knowledgeData;
    }

    async analyzeData(url, harData, group) {
        if (this.groups[group] === undefined) {
            this.groups[group] = {};
        }

        const analyzedData = this.transform2SimplifiedData(harData, url);
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