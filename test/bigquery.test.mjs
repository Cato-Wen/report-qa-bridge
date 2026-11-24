import test from "node:test";
import assert from "node:assert/strict";
import { checkReadOnlySql, buildServer, presetFor, BIGQUERY_READ_TOOLS } from "../src/mcp.mjs";
import { decide } from "../src/guard.mjs";

const ok = sql => assert.equal(checkReadOnlySql(sql), null, sql);
const bad = sql => assert.notEqual(checkReadOnlySql(sql), null, sql);

test("SELECT / WITH allowed", () => {
  ok("SELECT COUNT(*) FROM `proj.ds.orders` WHERE dt = '2026-11-01' LIMIT 10");
  ok("with t as (select 1 as x) select * from t");
  ok("(SELECT 1) UNION ALL (SELECT 2)");
  ok("SELECT * EXCEPT(a) FROM t;");                       // trailing semicolon ok
  ok("SELECT 'please delete this' AS note FROM t");        // keyword inside a string is fine
  ok("-- drop table x\nSELECT 1");                         // keyword inside a comment is fine
  ok("SELECT updated_time, created_by FROM t");            // identifiers that merely contain keywords
});

test("writes, DDL, scripts and multi-statement blocked", () => {
  bad("DELETE FROM t WHERE 1=1");
  bad("INSERT INTO t VALUES (1)");
  bad("UPDATE t SET a = 1");
  bad("MERGE t USING s ON t.id = s.id WHEN MATCHED THEN DELETE");
  bad("CREATE OR REPLACE TABLE t AS SELECT 1");
  bad("DROP TABLE t");
  bad("TRUNCATE TABLE t");
  bad("SELECT 1; DROP TABLE t");
  bad("WITH x AS (SELECT 1) SELECT * FROM x; DELETE FROM t WHERE true");
  bad("EXPORT DATA OPTIONS(uri='gs://b/*') AS SELECT 1");
  bad("DECLARE x INT64; SELECT x");
  bad("CALL proj.ds.proc()");
  bad("EXECUTE IMMEDIATE 'DROP TABLE t'");
  bad("BEGIN SELECT 1; END");
  bad("");
});

test("bigquery preset: detected, read tools only", () => {
  const catalog = { bigquery: { config: { type: "stdio", command: "F:/toolbox/toolbox.exe", args: ["--prebuilt", "bigquery", "--stdio"] } } };
  assert.equal(presetFor(catalog.bigquery.config), "bigquery");
  const s = buildServer({ name: "bigquery" }, catalog);
  assert.deepEqual(s.policy.tools, BIGQUERY_READ_TOOLS);
  assert.ok(!s.policy.tools.includes("forecast") && !s.policy.tools.includes("analyze_contribution"));
  assert.throws(() => buildServer({ name: "bigquery", tools: ["execute_sql", "forecast"] }, catalog), /not allowed/);
});

test("guard enforces SQL check on execute_sql", () => {
  const policy = { mcp: { bigquery: { preset: "bigquery", tools: BIGQUERY_READ_TOOLS } } };
  assert.equal(decide(policy, "mcp__bigquery__execute_sql", { sql: "SELECT 1" }), null);
  assert.notEqual(decide(policy, "mcp__bigquery__execute_sql", { sql: "DELETE FROM t WHERE true" }), null);
  assert.equal(decide(policy, "mcp__bigquery__get_table_info", { dataset: "d", table: "t" }), null);
  assert.notEqual(decide(policy, "mcp__bigquery__forecast", {}), null);
  assert.notEqual(decide(policy, "mcp__bigquery__ask_data_insights", {}), null);
});
