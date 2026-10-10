import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWorkday } from '../src/adapters/workday.js';
import { fetchGreenhouse } from '../src/adapters/greenhouse.js';
import { fetchLever } from '../src/adapters/lever.js';
import { fetchPersonio } from '../src/adapters/personio.js';
import { fetchJobsDetailed } from '../src/index.js';
import { filterJobs } from '../src/filters.js';
import { awarePublicationInstant } from '../src/publication.js';
import { disableRetries } from './helpers.js';

disableRetries();
const CTX = { config: { tenant: 'companyx', env: 'wd1', site: 'careers' }, companyName: 'Company X' };
const row = (i) => ({ title: `Position ${i}`, externalPath: `/job/Region/Position_${i}`, locationsText: 'Remote', postedOn: 'Posted Today' });
const detail = (date = '2026-10-07') => ({ jobPostingInfo: { jobDescription: '<p>Complete requirements and responsibilities.</p>', startDate: date } });
const response = (body) => ({ ok: true, status: 200, json: async () => body });

test('41 rows with total only on page zero stop at the short page, before a reset offset', async (t) => {
  const offsets = [];
  const reports = [];
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!url.endsWith('/jobs')) return response(detail());
    const { offset } = JSON.parse(opts.body);
    offsets.push(offset);
    // This server resets to its first page past the end instead of returning [].
    const start = offset >= 41 ? 0 : offset;
    const jobs = Array.from({ length: Math.min(20, 41 - start) }, (_, i) => row(start + i));
    return response({ total: offset === 0 || offset >= 41 ? 41 : 0, jobPostings: jobs });
  });
  const jobs = await fetchWorkday('companyx', { ...CTX, report: (r) => reports.push(r) });
  assert.deepEqual(offsets, [0, 20, 40]);
  assert.equal(jobs.length, 41);
  assert.equal(new Set(jobs.map(j => j.metadata.externalPath)).size, 41);
  assert.equal(reports[0].capped, false);
  assert.ok(jobs.every(j => j.content.status === 'complete'));
});

test('a reset page with unknown total ends without duplicates and exposes incomplete coverage', async (t) => {
  const offsets = [];
  let report;
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!url.endsWith('/jobs')) return response(detail());
    const { offset } = JSON.parse(opts.body);
    offsets.push(offset);
    return response({ total: 0, jobPostings: Array.from({ length: 20 }, (_, i) => row(i)) });
  });
  const jobs = await fetchWorkday('companyx', { ...CTX, report: (r) => { report = r; } });
  assert.deepEqual(offsets, [0, 20]);
  assert.equal(jobs.length, 20);
  assert.equal(report.capped, true);
});

test('a partial page failure preserves read rows but cannot certify complete coverage', async (t) => {
  let report;
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!url.endsWith('/jobs')) return response(detail());
    const { offset } = JSON.parse(opts.body);
    if (offset === 20) return { ok: false, status: 403 };
    return response({ total: 41, jobPostings: Array.from({ length: 20 }, (_, i) => row(i)) });
  });
  const jobs = await fetchWorkday('companyx', { ...CTX, report: (r) => { report = r; } });
  assert.equal(jobs.length, 20);
  assert.equal(report.capped, true);
});

test('unfiltered Workday board pages pass row 100 with bounded details, stable offsets and exact list counts', async (t) => {
  let detailCalls = [];
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!url.endsWith('/jobs')) {
      detailCalls.push(url);
      return response(detail());
    }
    const { offset } = JSON.parse(opts.body);
    return response({ total: offset === 0 ? 250 : 0,
      jobPostings: Array.from({ length: Math.min(20, 250 - offset) }, (_, i) => row(offset + i)) });
  });
  const all = [];
  for (const offset of [0, 100, 200]) {
    detailCalls = [];
    const result = await fetchJobsDetailed({ company: 'companyx', ats: 'workday', config: CTX.config,
      order: 'board', offset, limit: 100 });
    const count = Math.min(100, 250 - offset);
    assert.equal(result.jobs.length, count);
    assert.equal(detailCalls.length, count);
    assert.deepEqual(result.jobs.map(j => j.title), Array.from({ length: count }, (_, i) => `Position ${offset + i}`));
    assert.ok(result.jobs.every(j => j.content.status === 'complete'));
    assert.equal(result.total_matched, 250);
    assert.equal(result.total_before_filters, 250);
    assert.equal(result.pagination.counts_exact, true);
    assert.equal(result.pagination.next_offset, offset + count < 250 ? offset + count : null);
    assert.equal(result.pagination.snapshot_stable, false);
    all.push(...result.jobs);
  }
  assert.equal(new Set(all.map(j => j.metadata.externalPath)).size, 250);
});

test('Workday limits one inventory page to 100 details even when caller asks for 500', async (t) => {
  let details = 0;
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!url.endsWith('/jobs')) { details += 1; return response(detail()); }
    const { offset } = JSON.parse(opts.body);
    return response({ total: 120, jobPostings: Array.from({ length: Math.min(20, 120 - offset) }, (_, i) => row(offset + i)) });
  });
  const result = await fetchJobsDetailed({ company: 'companyx', ats: 'workday', config: CTX.config, order: 'board', limit: 500 });
  assert.equal(result.jobs.length, 100);
  assert.equal(details, 100);
  assert.equal(result.pagination.next_offset, 100);
  assert.equal(result.pagination.detail_limit, 100);
});

test('filtered Workday offsets retain match semantics and stay explicitly capped', async (t) => {
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!url.endsWith('/jobs')) return response(detail());
    const { offset } = JSON.parse(opts.body);
    return response({ total: 120, jobPostings: Array.from({ length: Math.min(20, 120 - offset) }, (_, i) => row(offset + i)) });
  });
  const result = await fetchJobsDetailed({ company: 'companyx', ats: 'workday', config: CTX.config,
    order: 'board', offset: 4, limit: 3, titleFilter: 'Position (?:[02468]|1[02468])$' });
  assert.deepEqual(result.jobs.map(j => j.title), ['Position 8', 'Position 10', 'Position 12']);
  assert.equal(result.pagination, undefined);
});

test('a partial Workday list page cannot make inventory counts exact', async (t) => {
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!url.endsWith('/jobs')) return response(detail());
    const { offset } = JSON.parse(opts.body);
    if (offset === 20) return { ok: false, status: 403 };
    return response({ total: 120, jobPostings: Array.from({ length: 20 }, (_, i) => row(i)) });
  });
  const result = await fetchJobsDetailed({ company: 'companyx', ats: 'workday', config: CTX.config, order: 'board' });
  assert.equal(result.jobs.length, 20);
  assert.equal(result.pagination.counts_exact, false);
  assert.equal(result.pagination.list_coverage, 'incomplete');
  assert.equal(result.boards[0].scan.capped, true);
});

test('a malformed Workday list cannot be certified as exact zero supply', async (t) => {
  t.mock.method(global, 'fetch', async () => response({ total: 120, error: 'temporarily unavailable' }));
  await assert.rejects(fetchJobsDetailed({ company: 'companyx', ats: 'workday', config: CTX.config, order: 'board' }),
    /Malformed Workday list response/);
});

test('a malformed later Workday list preserves its prefix with incomplete coverage', async (t) => {
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!url.endsWith('/jobs')) return response(detail());
    const { offset } = JSON.parse(opts.body);
    return response(offset === 0
      ? { total: 120, jobPostings: Array.from({ length: 20 }, (_, i) => row(i)) }
      : { total: 120 });
  });
  const result = await fetchJobsDetailed({ company: 'companyx', ats: 'workday', config: CTX.config, order: 'board' });
  assert.equal(result.jobs.length, 20);
  assert.equal(result.pagination.counts_exact, false);
});

test('successful Workday detail responses with no body remain missing content without losing the row', async (t) => {
  for (const body of [{}, { jobPostingInfo: {} }, { jobPostingInfo: { jobDescription: {} } }, { jobPostingInfo: { jobDescription: ' ' } },
    { jobPostingInfo: { jobDescription: '<p><br></p>' } }]) {
    t.mock.method(global, 'fetch', async (url) => response(url.endsWith('/jobs')
      ? { total: 1, jobPostings: [row(1)] } : body));
    const result = await fetchJobsDetailed({ company: 'companyx', ats: 'workday', config: CTX.config, order: 'board' });
    assert.equal(result.jobs.length, 1);
    assert.deepEqual(result.jobs[0].content, { status: 'missing', reason: 'source_empty_description' });
    assert.equal(result.content_missing, 1);
    assert.equal(result.pagination.counts_exact, true);
  }
});

test('a short page below the initial total and a mixed duplicate page are partial', async (t) => {
  let report;
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!url.endsWith('/jobs')) return response(detail());
    const { offset } = JSON.parse(opts.body);
    return response({ total: offset === 0 ? 41 : 0, jobPostings: offset === 0
      ? Array.from({ length: 20 }, (_, i) => row(i)) : [row(19), row(20)] });
  });
  const jobs = await fetchWorkday('companyx', { ...CTX, report: (r) => { report = r; } });
  assert.equal(jobs.length, 21);
  assert.equal(report.capped, true);
});

test('publication parsing requires a valid calendar timestamp and explicit timezone', () => {
  for (const value of ['', null, 1791379200000, '2026-10-07', '2026-10-07T12:00:00', 'Posted Today',
    '2026-02-30T12:00:00Z', '2026-10-07T24:00:00Z', '2026-10-07T12:00:00+99:00']) {
    assert.equal(awarePublicationInstant(value), null, String(value));
  }
  assert.equal(awarePublicationInstant('2026-10-07T12:00:00+02:00'), '2026-10-07T10:00:00.000Z');
  assert.equal(awarePublicationInstant('2028-02-29T12:00Z'), '2028-02-29T12:00:00.000Z');
});

test('Workday keeps date-only and relative source evidence without invented midnight', async (t) => {
  t.mock.method(global, 'fetch', async (url) => response(url.endsWith('/jobs')
    ? { total: 1, jobPostings: [row(1)] } : detail()));
  const [job] = await fetchWorkday('companyx', CTX);
  assert.equal(job.postedAt, null);
  assert.equal(job.metadata.publicationDateRaw, '2026-10-07');
  assert.equal(job.metadata.postedOnRaw, 'Posted Today');
  assert.equal(job.metadata.publicationDateBasis, 'calendar_or_relative_unverified');
  assert.equal(filterJobs([job], { postedWithinDays: 7 }).length, 1, 'unknown original date survives retrieval, not certified as recent');
});

test('Greenhouse edit timestamps never substitute for original publication', async (t) => {
  t.mock.method(global, 'fetch', async () => response({ jobs: [
    { id: 1, title: 'Position', updated_at: new Date().toISOString(), content: '<p>Complete brief.</p>' },
    { id: 2, title: 'Old original', first_published: '2020-01-01T12:00:00Z', updated_at: new Date().toISOString() },
    { id: 3, title: 'Naive original', first_published: '2026-10-07T12:00:00', updated_at: new Date().toISOString() },
  ] }));
  const jobs = await fetchGreenhouse('companyx');
  assert.equal(jobs[0].postedAt, null);
  assert.ok(jobs[0].metadata.updatedAt);
  assert.equal(jobs[0].metadata.publicationDateBasis, 'original_unavailable');
  assert.equal(jobs[2].postedAt, null);
  assert.equal(jobs[2].metadata.firstPublishedRaw, '2026-10-07T12:00:00');
  assert.deepEqual(filterJobs(jobs, { postedWithinDays: 7 }).map(j => j.title), ['Position', 'Naive original']);
});

test('Lever retains requirements, responsibilities, additional sections and all native locations', async (t) => {
  t.mock.method(global, 'fetch', async () => response([{
    id: 'position-1', text: 'Position', createdAt: 1791379200000, workplaceType: 'remote',
    categories: { location: 'Region A', allLocations: ['Region A', 'Region B'], commitment: 'Part-time' },
    description: '<p>Overview.</p>', lists: [
      { text: 'Responsibilities', content: '<ul><li>Deliver complete work.</li></ul>' },
      { text: 'Requirements & skills', content: '<ul><li>Required credential.</li></ul>' },
    ], additional: '<p>Pay, benefits and safeguards.</p>',
  }]));
  const [job] = await fetchLever('companyx');
  for (const text of ['Overview.', 'Responsibilities', 'Deliver complete work.', 'Requirements & skills',
    'Required credential.', 'Pay, benefits and safeguards.']) assert.ok(job.description.includes(text), text);
  assert.deepEqual(job.locations, ['Region A', 'Region B']);
  assert.equal(job.metadata.leverId, 'position-1');
  assert.equal(job.metadata.commitment, 'Part-time');
});

test('Personio retains nested sections, schedule and raw publication provenance', async (t) => {
  const xml = '<workzag-jobs><position><id>1</id><name>Position</name><office>Region A</office>' +
    '<schedule>part-time</schedule><employmentType>permanent</employmentType><createdAt>2026-10-07</createdAt>' +
    '<jobDescriptions><jobDescription><name>Responsibilities</name><value><![CDATA[<p>Complete scope.</p>]]></value></jobDescription>' +
    '<jobDescription><name>Requirements</name><value><![CDATA[<ul><li>Explicit credential.</li></ul>]]></value></jobDescription></jobDescriptions>' +
    '</position></workzag-jobs>';
  t.mock.method(global, 'fetch', async () => ({ ok: true, status: 200, text: async () => xml }));
  const [job] = await fetchPersonio('companyx');
  assert.match(job.description, /Responsibilities/);
  assert.match(job.description, /Complete scope\./);
  assert.match(job.description, /Requirements/);
  assert.match(job.description, /Explicit credential\./);
  assert.equal(job.metadata.schedule, 'part-time');
  assert.equal(job.metadata.employmentType, 'permanent');
  assert.equal(job.metadata.createdAtRaw, '2026-10-07');
  assert.equal(job.postedAt, null);
  assert.equal(job.metadata.publicationDateBasis, 'original_unavailable');
});

test('Personio reads the board default instead of forcing an empty English translation', async (t) => {
  const base = '<workzag-jobs><position><id>1</id><name>Position</name>';
  const sections = '<jobDescriptions><jobDescription><name>Aufgaben</name>' +
    '<value><![CDATA[<p>Vollständiger Inhalt.</p>]]></value></jobDescription></jobDescriptions>';
  const end = '</position></workzag-jobs>';
  t.mock.method(global, 'fetch', async (url) => ({ ok: true, status: 200,
    text: async () => base + (url.includes('language=en') ? '' : sections) + end }));
  const [job] = await fetchPersonio('companyx');
  assert.match(job.description, /Vollständiger Inhalt\./);
  assert.equal(job.content.status, 'complete');
});

test('an empty Personio description remains a visible content gap', async (t) => {
  t.mock.method(global, 'fetch', async () => ({ ok: true, status: 200,
    text: async () => '<workzag-jobs><position><id>1</id><name>Position</name>' +
      '<jobDescriptions><jobDescription><name>Requirements</name><value><![CDATA[<p></p>]]></value></jobDescription></jobDescriptions>' +
      '</position></workzag-jobs>' }));
  const [job] = await fetchPersonio('companyx');
  assert.deepEqual(job.content, { status: 'missing', reason: 'source_empty_description' });
});
