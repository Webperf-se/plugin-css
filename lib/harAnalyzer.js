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
        this.rules = this.config.rules;
        const packagePath = path.resolve(libFolder, 'package.json');
        this.package = JSON.parse(readFileSync(packagePath, 'utf8'));
        this.dependencies = this.package.dependencies;
        this.version = this.package.version;
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
            styleElements.forEach((styleElement) => {
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
            elementsWithStyleAttr.forEach((element, index) => {
                const styleAttrContent = element.getAttribute('style');
                const styleAttrObj = {
                    'url': htmlObj.url,
                    // Wrap the style attribute content in a dummy #id rule
                    'content': `#dummy-style-attribute-id-${index} { ${styleAttrContent} }`,
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
            'issues': {}
        };

        if (analyzedData === undefined) {
            return knowledgeData;
        }

        if (!('htmls' in analyzedData)) {
            return knowledgeData;
        }

        if (analyzedData['htmls'].length === 0) {
            knowledgeData['issues'] = {
                'no-network': {
                    'test': 'css',
                    'rule': 'no-network',
                    'category': 'technical',
                    'severity': 'warning',
                    'subIssues': [
                        {
                            'url': url,
                            'rule': 'no-network',
                            'category': 'standard',
                            'severity': 'warning',
                            'text': `No HTML content found in the HAR file.`,
                            'line': 0,
                            'column': 0
                        }
                    ]
                }
            };
            return knowledgeData;
        }

        if (!('all-styles' in analyzedData)) {
            return knowledgeData;
        }

        // Concatenate all CSS content with line offsets for accurate mapping
        let concatenatedCSS = '';
        const lineOffsets = [];
        analyzedData['all-styles'].forEach(entry => {
            const contentLines = entry.content.split('\n').length;
            lineOffsets.push({
                url: entry.url,
                index: entry.index,
                startLine: concatenatedCSS.split('\n').length,
                lineCount: contentLines
            });
            concatenatedCSS += entry.content + '\n';
        });

        // Lint the concatenated CSS
        const lintResult = await stylelint.lint({
            code: concatenatedCSS,
            config: this.config
        });

        // Map warnings back to their original files using line offsets
        const flatResults = lintResult.results.flatMap(res =>
            res.warnings.map(warning => {
                const originalEntry = lineOffsets.find(offset =>
                    warning.line >= offset.startLine &&
                    warning.line < offset.startLine + offset.lineCount
                );

                if (!originalEntry) {
                    return {
                        ...warning, // Preserve the original warning
                        url: 'unknown', // Add a placeholder URL
                        category: 'unknown'
                    };
                }
                return {
                    url: originalEntry.url,
                    rule: warning.rule,
                    category: 'standard',
                    severity: warning.severity,
                    text: warning.text,
                    line: warning.line - originalEntry.startLine + 1,
                    column: warning.column
                };
            })
        );

        // Convert issues to a set grouped by rule
        const issuesByRule = {};
        for (const issue of flatResults) {
            if (!issuesByRule[issue.rule]) {
                issuesByRule[issue.rule] = {
                    'test': 'css',
                    rule: issue.rule,
                    category: issue.category,
                    severity: issue.severity,
                    subIssues: []
                };
            }
            issuesByRule[issue.rule].subIssues.push(issue);
        }

        // Add missing rules from securityConfig and standardConfig
        const allRules = [
            ...Object.keys(this.rules || {}).filter(rule => this.rules[rule] !== "off")
        ];

        for (const rule of allRules) {
            if (!issuesByRule[rule]) {
                issuesByRule[rule] = {
                    'test': 'css',
                    rule: rule,
                    category: 'standard',
                    severity: 'resolved', // Default severity for missing issues
                    subIssues: []
                };
            }
        }

        knowledgeData.issues = issuesByRule;

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
            'version': this.version,
            'dependencies': this.dependencies,
            'url': url,
            'analyzedData': analyzedData,
            'knowledgeData': knowledgeData
        };
    }

    getSummary() {
        return this;
    }
}