import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarAnalyzer, nodeHasBrotliFix } from '../../lib/harAnalyzer.js';

test('nodeHasBrotliFix accepts the fixed releases and later', () => {
  for (const v of ['24.22.1', 'v24.22.1', '24.22.2', '24.23.0', '22.23.4', '22.24.0', '26.12.1', '26.13.0', '27.0.0']) {
    assert.equal(nodeHasBrotliFix(v), true, v);
  }
});

test('nodeHasBrotliFix rejects vulnerable and unsupported releases', () => {
  for (const v of ['24.22.0', '24.18.0', '24.9.99', '22.23.3', '22.12.0', '26.12.0', '25.9.0', '23.11.1', '20.19.2', '18.20.4', 'garbage', '', undefined]) {
    assert.equal(nodeHasBrotliFix(v), false, String(v));
  }
});

// A HAR with one HTML page and one CSS file whose body is missing, so the
// analyzer wants to refetch it.
const harWithMissingCss = () => ({
  log: {
    pages: [{ id: 'page_1' }],
    entries: [
      {
        pageref: 'page_1',
        _resourceType: 'document',
        _initiator_type: 'other',
        request: { url: 'https://example.org/' },
        response: { status: 200, content: { mimeType: 'text/html', text: '<html></html>', size: 13 } }
      },
      {
        pageref: 'page_1',
        request: { url: 'https://cdn.example.org/missing.css' },
        response: { status: 304, content: { mimeType: 'text/css', size: 0 } }
      }
    ]
  }
});

const analyzerOnNode = (nodeVersion) => {
  const analyzer = new HarAnalyzer();
  analyzer.nodeVersion = nodeVersion;
  analyzer.calls = [];
  analyzer.fetchCssBody = async (url) => {
    analyzer.calls.push(url);
    return { url, content: 'a { color: red }' };
  };
  return analyzer;
};

test('refetches missing CSS on a Node with the Brotli fix', async () => {
  const analyzer = analyzerOnNode('24.22.1');
  const data = await analyzer.transform2SimplifiedData(harWithMissingCss(), 'https://example.org/');
  assert.deepEqual(analyzer.calls, ['https://cdn.example.org/missing.css']);
  assert.equal(data['style-files'].length, 1);
});

test('skips the refetch on a vulnerable Node and still returns the page data', async () => {
  const analyzer = analyzerOnNode('24.18.0');
  const data = await analyzer.transform2SimplifiedData(harWithMissingCss(), 'https://example.org/');
  assert.deepEqual(analyzer.calls, []);
  assert.equal(data['style-files'].length, 0);
  assert.equal(data.htmls.length, 1);
});
