import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { researchEdition } from '../src/research.mjs';

// Synthetic source documents exercise the evidence gates without calling a
// provider or pretending that fixture prose is a researched historical story.
const savedResearchKey = process.env.RESEARCH_API_KEY;
const savedOpenAIKey = process.env.OPENAI_API_KEY;
beforeEach(() => {
  process.env.RESEARCH_API_KEY = 'synthetic-test-key';
  delete process.env.OPENAI_API_KEY;
});
afterEach(() => {
  if (savedResearchKey === undefined) delete process.env.RESEARCH_API_KEY;
  else process.env.RESEARCH_API_KEY = savedResearchKey;
  if (savedOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedOpenAIKey;
});

function candidate(name = 'first') {
  const quote = name === 'first' ? 'A manageable step is sufficient for today.' :
    "Rest belongs inside a day's responsible work.";
  const story1 = `The fixture founder faced a decision during the ${name} incident and chose to change the process carefully.`;
  const story2 = `A separate fixture interview confirms the ${name} decision, the revised process and the subsequent result.`;
  return {
    title: `The ${name} fixture decision`, founder: 'Fixture Founder', company: 'Fixture Company',
    event: `A documented ${name} decision and result`, eventDate: '2000',
    eventKey: `fixture-founder-${name}-decision`, industry: 'Healthcare', geography: 'Kenya',
    tradition: 'Fixture tradition',
    paragraphs: Array.from({ length: 5 }, () => Array(10).fill('Today asks for patient care and one manageable step.').join(' ')),
    invitation: 'Ask one colleague which process needs care today.',
    quote: { text: quote, author: 'Fixture Philosopher', work: 'Synthetic Test Work',
      section: 'Fixture section 1', url: 'https://classics.mit.edu/fixture/text.html' },
    sources: [
      { url: 'https://www.npr.org/fixture/interview', title: 'Fixture first interview', kind: 'story', excerpt: story1 },
      { url: 'https://www.pbs.org/fixture/oral-history', title: 'Fixture second interview', kind: 'story', excerpt: story2 },
      { url: 'https://classics.mit.edu/fixture/text.html', title: 'Fixture original text', kind: 'quote',
        excerpt: `The synthetic original text includes this complete sentence: ${quote} The fixture section ends here.` },
    ],
    pivotalClaims: [
      { claim: 'The founder chose to change the process.', sourceURLs: ['https://www.npr.org/fixture/interview', 'https://www.pbs.org/fixture/oral-history'] },
      { claim: 'The revised process had a subsequent result.', sourceURLs: ['https://www.npr.org/fixture/interview', 'https://www.pbs.org/fixture/oral-history'] },
    ],
  };
}

function modelResponse(value, webSearch = false) {
  return new Response(JSON.stringify({ output: [
    ...(webSearch ? [{ type: 'web_search_call', id: 'fixture-search', status: 'completed' }] : []),
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
  ] }), { headers: { 'content-type': 'application/json' } });
}

const approval = { approved: true, duplicateEvent: false, duplicateQuote: false, explanation: 'Synthetic evidence matches.' };

function provider({ candidates = [candidate()], audits = [approval], hasWebSearch = true,
  changeDocument = (_url, document) => document } = {}) {
  let generation = 0;
  let audit = 0;
  let sourceFetches = 0;
  const requests = [];
  const fetchImpl = async (target, options = {}) => {
    const url = String(target);
    if (url === 'https://api.openai.com/v1/responses') {
      const body = JSON.parse(options.body);
      requests.push(body);
      assert.equal(options.headers.Authorization, 'Bearer synthetic-test-key');
      if (body.text.format.name === 'researched_edition') {
        const value = candidates[generation++];
        assert.ok(value, 'unexpected extra research attempt');
        return modelResponse(value, hasWebSearch);
      }
      assert.equal(body.text.format.name, 'research_audit');
      const value = audits[audit++];
      assert.ok(value, 'unexpected extra audit attempt');
      return modelResponse(value);
    }
    sourceFetches++;
    const excerpts = candidates.flatMap(c => c.sources).filter(s => s.url === url).map(s => s.excerpt).join(' ');
    assert.ok(excerpts, `unexpected source URL ${url}`);
    const document = `<html><body><h1>Synthetic verification fixture</h1><p>${excerpts}</p></body></html>`;
    return new Response(changeDocument(url, document), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  return { fetchImpl, requests, counts: () => ({ generation, audit, sourceFetches }) };
}

test('successful research preserves actual evidence, retrieval dates and document hashes', async () => {
  const mock = provider();
  const before = Date.now();
  const reservedQuote={text:'A prior reserved thought must be excluded, including its variants.'};
  const edition = await researchEdition({ fetchImpl: mock.fetchImpl,reserveEvents:[{founder:'Another founder',company:'Another company',event:'A distinct reserved episode',eventKey:'distinct-reserve-event',quote:reservedQuote}] });
  assert.equal(edition.title, 'The first fixture decision');
  assert.match(edition.id, /^[\da-f-]{36}$/);
  assert.ok(Date.parse(edition.researchedAt) >= before);
  assert.equal(edition.sources.length, 3);
  for (const source of edition.sources) {
    assert.ok(Date.parse(source.retrievedAt) >= before);
    assert.match(source.sha256, /^[\da-f]{64}$/);
    assert.ok(source.evidence.includes(source.excerpt));
    assert.equal(source.resolvedURL, source.url);
  }
  assert.ok(edition.sources.find(s => s.kind === 'quote').evidence.includes(edition.quote.text));
  assert.equal(edition.research.audit.approved, true);
  assert.deepEqual(mock.counts(), { generation: 1, audit: 1, sourceFetches: 3 });
  assert.ok(mock.requests[0].instructions.includes(reservedQuote.text),'selection excludes unused reserve quotes');
  assert.ok(JSON.parse(mock.requests[1].input).previousQuotes.some(q=>q.text===reservedQuote.text),'semantic audit receives unused reserve quotes');
});

test('an altered philosophy quotation is rejected before editorial audit', async () => {
  const fixture = candidate();
  fixture.quote.text = 'A different sentence that the original document never contained.';
  const mock = provider({ candidates: [fixture] });
  await assert.rejects(researchEdition({ fetchImpl: mock.fetchImpl }), /Exact philosophy quote could not be verified/);
  assert.equal(mock.counts().audit, 0);
  assert.equal(mock.counts().generation, 1);
});

test('a claimed story excerpt missing from the opened document is rejected', async () => {
  const mock = provider({ changeDocument: (url, document) => url.includes('npr.org') ?
    '<p>This synthetic document contains different evidence. It has enough readable text to pass the document-length gate, but it does not support the candidate claim.</p>' : document });
  await assert.rejects(researchEdition({ fetchImpl: mock.fetchImpl }), /does not contain the claimed evidence/);
  assert.equal(mock.counts().audit, 0);
});

test('an auditor-detected semantic repeat triggers a fresh selection and preserves exclusion history', async () => {
  const mock = provider({ candidates: [candidate(), candidate('fresh')],
    audits: [ { approved: false, duplicateEvent: true, duplicateQuote: false,
      explanation: 'Same incident described with a new title and different event key.' }, approval ] });
  const edition = await researchEdition({
    ledger: [{ founder: 'Fixture Founder', company: 'Fixture Company',
      eventKey: 'different-key-for-the-original-incident', event: 'The first decision described under a different title.' }],
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(edition.eventKey, 'fixture-founder-fresh-decision');
  assert.deepEqual(mock.counts(), { generation: 2, audit: 2, sourceFetches: 6 });
  const selections = mock.requests.filter(r => r.text.format.name === 'researched_edition');
  assert.ok(selections[1].instructions.includes('fixture-founder-first-decision'));
  assert.ok(selections[1].instructions.includes('different-key-for-the-original-incident'));
});

test('a model response without a live search is rejected before source requests', async () => {
  const mock = provider({ hasWebSearch: false });
  await assert.rejects(researchEdition({ fetchImpl: mock.fetchImpl }), /did not perform live web research/);
  assert.deepEqual(mock.counts(), { generation: 1, audit: 0, sourceFetches: 0 });
});

test('missing credentials fail closed without making any request', async () => {
  delete process.env.RESEARCH_API_KEY;
  const mock = provider();
  await assert.rejects(researchEdition({ fetchImpl: mock.fetchImpl }), /set RESEARCH_API_KEY on the server/);
  assert.deepEqual(mock.counts(), { generation: 0, audit: 0, sourceFetches: 0 });
});
