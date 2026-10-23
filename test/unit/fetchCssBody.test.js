import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarAnalyzer } from '../../lib/harAnalyzer.js';

const analyzer = new HarAnalyzer();

const responseOf = (body, { status = 200, headers = { 'content-type': 'text/css' } } = {}) =>
  new Response(body, { status, headers });
const fetchReturning = (response) => async () => response;

test('returns the body of a text/css response', async () => {
  const result = await analyzer.fetchCssBody('https://example.org/a.css', {
    fetchImpl: fetchReturning(responseOf('a { color: red }'))
  });
  assert.deepEqual(result, { url: 'https://example.org/a.css', content: 'a { color: red }' });
});

test('accepts text/css with a charset parameter', async () => {
  const result = await analyzer.fetchCssBody('https://example.org/a.css', {
    fetchImpl: fetchReturning(responseOf('a{}', { headers: { 'content-type': 'text/css; charset=utf-8' } }))
  });
  assert.equal(result.content, 'a{}');
});

test('never calls fetch for non http(s) URLs', async () => {
  for (const url of ['file:///etc/passwd', 'data:text/css,a{}', 'ftp://example.org/a.css', 'javascript:alert(1)', 'not a url']) {
    let called = false;
    const result = await analyzer.fetchCssBody(url, {
      fetchImpl: async () => { called = true; return responseOf('a{}'); }
    });
    assert.equal(result, null, url);
    assert.equal(called, false, url);
  }
});

test('ignores responses that are not text/css', async () => {
  for (const contentType of ['text/html', 'application/javascript', 'application/octet-stream', '']) {
    const result = await analyzer.fetchCssBody('https://example.org/a.css', {
      fetchImpl: fetchReturning(responseOf('a{}', { headers: contentType ? { 'content-type': contentType } : {} }))
    });
    assert.equal(result, null, contentType || '(no content-type)');
  }
});

test('ignores non-OK responses', async () => {
  const result = await analyzer.fetchCssBody('https://example.org/a.css', {
    fetchImpl: fetchReturning(responseOf('a{}', { status: 404 }))
  });
  assert.equal(result, null);
});

test('aborts when the streamed body exceeds the size limit', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(400)); },
    cancel() { cancelled = true; }
  });
  const result = await analyzer.fetchCssBody('https://example.org/a.css', {
    maxBytes: 1000,
    fetchImpl: fetchReturning(new Response(stream, { headers: { 'content-type': 'text/css' } }))
  });
  assert.equal(result, null);
  assert.equal(cancelled, true);
});

test('rejects early when content-length already exceeds the limit', async () => {
  const result = await analyzer.fetchCssBody('https://example.org/a.css', {
    maxBytes: 10,
    fetchImpl: fetchReturning(responseOf('a{}', { headers: { 'content-type': 'text/css', 'content-length': '5000' } }))
  });
  assert.equal(result, null);
});

test('a body exactly at the limit is accepted', async () => {
  const result = await analyzer.fetchCssBody('https://example.org/a.css', {
    maxBytes: 4,
    fetchImpl: fetchReturning(responseOf('a{ }'))
  });
  assert.equal(result.content, 'a{ }');
});

test('network errors and timeouts return null instead of throwing', async () => {
  const failing = await analyzer.fetchCssBody('https://example.org/a.css', {
    fetchImpl: async () => { throw new TypeError('fetch failed'); }
  });
  assert.equal(failing, null);

  const hanging = await analyzer.fetchCssBody('https://example.org/a.css', {
    timeoutMs: 20,
    fetchImpl: (url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    })
  });
  assert.equal(hanging, null);
});
