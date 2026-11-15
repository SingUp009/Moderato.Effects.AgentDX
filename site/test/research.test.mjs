import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createHash } from 'node:crypto';

test('Agent DX build publishes matching counts and the frozen guide download', () => {
    const built = new URL('../dist/agent-dx/', import.meta.url);
    const report = JSON.parse(readFileSync(new URL('results.json', built), 'utf8'));
    const page = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
    const archive = readFileSync(new URL('guide-snapshots.zip', built));

    assert.equal(createHash('sha256').update(archive).digest('hex'),
        '25420e24c032b38eb3b778341305bbea6595f5df062c7ce238549cf6cdc78765');
    assert.match(page, /rel="canonical" href="https:\/\/moderato-effects-agent-dx\.009singup\.workers\.dev\/"/);
    assert.match(page, /href="https:\/\/[^\/"]+\/agents\/"/);
    assert.ok(page.includes('/agent-dx/results.json'));
    assert.ok(page.includes(report.guide.sha256));
    assert.ok(page.includes('/agent-dx/guide-snapshots.zip'));
    if (report.holdout.status === 'complete') {
        const completed = report.holdout.results;
        assert.equal(completed.observed, completed.planned);
        assert.equal(completed.baselineSha256, report.guide.baselineSha256);
        assert.equal(completed.frozenSha256, report.guide.sha256);
        assert.ok(page.includes('95% Wilson interval'));
        for (const model of completed.models) {
            const modelRows = completed.rows.filter(row => row.model === model.model);
            for (const condition of ['baseline', 'frozen']) {
                const rows = modelRows.filter(row => row.condition === condition);
                assert.equal(rows.reduce((sum, row) => sum + row.finalPass, 0), model[condition]);
                assert.ok(rows.every(row => row.observed === row.planned && row.finalWilson95?.length === 2));
            }
        }
    }
    for (const experiment of report.experiments) {
        assert.ok(experiment.rows.length > 0);
        for (const row of experiment.rows) {
            assert.ok(row.planned > 0);
            assert.ok(row.firstBuild >= 0 && row.firstBuild <= row.planned);
            assert.ok(row.finalPass >= 0 && row.finalPass <= row.planned);
        }
    }
});
