'use strict';

require('dotenv').config();
const { Pool } = require('pg');

function getIdsFromArgs() {
	const argIds = process.argv.slice(2)
		.map((value) => Number(value))
		.filter((value) => Number.isFinite(value) && value > 0);
	if (argIds.length > 0) return Array.from(new Set(argIds));
	return [1, 2, 3, 4, 6];
}

function createPool() {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		console.error('DATABASE_URL is required. Example: DATABASE_URL=postgres://user:pass@host:5432/db node scripts/clear_companies.js 1 2 3');
		process.exit(2);
	}
	const nodeEnv = process.env.NODE_ENV || 'development';
	const isProduction = nodeEnv === 'production' || process.env.RENDER === 'true';
	const useSsl = process.env.DATABASE_SSL === 'true' || (isProduction && process.env.DATABASE_SSL !== 'false');
	return new Pool({
		connectionString: databaseUrl,
		ssl: useSsl ? { rejectUnauthorized: false } : false,
		max: parseInt(process.env.PG_MAX_CONNECTIONS || '5'),
		idleTimeoutMillis: 30000,
		connectionTimeoutMillis: 10000,
	});
}

async function countByQueries(client, ids) {
	const idsBigint = ids; // will cast inside queries
	const idsInt = ids; // will cast inside queries
	const queries = {
		companies: {
			text: 'SELECT COUNT(*)::int AS c FROM companies WHERE id = ANY($1::bigint[])',
			params: [idsBigint],
		},
		users: {
			text: 'SELECT COUNT(*)::int AS c FROM users WHERE company_id = ANY($1::bigint[])',
			params: [idsBigint],
		},
		settings: {
			text: 'SELECT COUNT(*)::int AS c FROM settings WHERE company_id = ANY($1::bigint[])',
			params: [idsBigint],
		},
		message_templates: {
			text: 'SELECT COUNT(*)::int AS c FROM message_templates WHERE company_id = ANY($1::bigint[])',
			params: [idsBigint],
		},
		invoices: {
			text: 'SELECT COUNT(*)::int AS c FROM invoices WHERE company_id = ANY($1::bigint[])',
			params: [idsBigint],
		},
		invoice_followups: {
			text: 'SELECT COUNT(*)::int AS c FROM invoice_followups f JOIN invoices i ON i.id = f.invoice_id WHERE i.company_id = ANY($1::bigint[])',
			params: [idsBigint],
		},
		user_activity: {
			text: 'SELECT COUNT(*)::int AS c FROM user_activity a JOIN users u ON u.id = a.user_id WHERE u.company_id = ANY($1::bigint[])',
			params: [idsBigint],
		},
		customers: {
			text: 'SELECT COUNT(*)::int AS c FROM customers WHERE company_id = ANY($1::int[])',
			params: [idsInt],
		},
		follow_ups: {
			text: 'SELECT COUNT(*)::int AS c FROM follow_ups WHERE company_id = ANY($1::int[])',
			params: [idsInt],
		},
		company_settings: {
			text: 'SELECT COUNT(*)::int AS c FROM company_settings WHERE company_id = ANY($1::int[])',
			params: [idsInt],
		},
		analytics_daily: {
			text: 'SELECT COUNT(*)::int AS c FROM analytics_daily WHERE company_id = ANY($1::int[])',
			params: [idsInt],
		},
		payments: {
			text: 'SELECT COUNT(*)::int AS c FROM payments WHERE company_id = ANY($1::int[])',
			params: [idsInt],
		},
		qbo_tokens: {
			text: 'SELECT COUNT(*)::int AS c FROM qbo_tokens t JOIN users u ON u.id = t.user_id WHERE u.company_id = ANY($1::bigint[])',
			params: [idsBigint],
		},
	};

	const results = {};
	for (const [name, { text, params }] of Object.entries(queries)) {
		try {
			const { rows } = await client.query(text, params);
			results[name] = rows[0]?.c ?? 0;
		} catch (err) {
			results[name] = `error: ${err.message}`;
		}
	}
	return results;
}

async function main() {
	const ids = getIdsFromArgs();
	const pool = createPool();
	const client = await pool.connect();
	const startTime = Date.now();

	try {
		console.log(JSON.stringify({ step: 'pre-count', companyIds: ids }));
		const preCounts = await countByQueries(client, ids);
		console.log(JSON.stringify({ step: 'pre-count-results', counts: preCounts }));

		await client.query('BEGIN');

		const deleteFollowUps = await client.query(
			'DELETE FROM follow_ups WHERE company_id = ANY($1::int[])',
			[ids]
		);

		const deleteCompanies = await client.query(
			'DELETE FROM companies WHERE id = ANY($1::bigint[])',
			[ids]
		);

		await client.query('COMMIT');

		const postCounts = await countByQueries(client, ids);
		const durationMs = Date.now() - startTime;
		console.log(
			JSON.stringify({
				step: 'done',
				companyIds: ids,
				deleted: {
					companies: deleteCompanies.rowCount,
					follow_ups: deleteFollowUps.rowCount,
				},
				postCounts,
				durationMs,
			})
		);
	} catch (error) {
		try {
			await client.query('ROLLBACK');
		} catch (_) {}
		console.error(JSON.stringify({ step: 'error', message: error.message }));
		process.exitCode = 1;
	} finally {
		client.release();
		await pool.end();
	}
}

main();

