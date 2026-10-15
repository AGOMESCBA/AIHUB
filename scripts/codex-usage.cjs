#!/usr/bin/env node
'use strict';

// Local-only accounting. Never prints prompts, source code, or tool contents.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

async function inspect(file) {
  const responses = new Map();
  const outputs = new Map();
  const models = new Set();
  const efforts = new Set();
  let meta, legacy, peakInput = 0, compactions = 0, invalidLines = 0;
  const lines = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { invalidLines++; continue; }
    const p = row.payload || {};
    if (row.type === 'session_meta' && !meta) meta = p;
    if (row.type === 'turn_context') {
      if (p.model) models.add(p.model);
      if (p.effort) efforts.add(p.effort);
    }
    if (row.type === 'compacted') compactions++;
    if (row.type === 'token_usage_record' && p.response_id && p.usage) {
      responses.set(p.response_id, p.usage);
      peakInput = Math.max(peakInput, p.usage.input_tokens || 0);
    }
    if (row.type === 'event_msg' && p.type === 'token_count' && p.info) {
      if (p.info.total_token_usage) legacy = p.info.total_token_usage;
      peakInput = Math.max(peakInput, p.info.last_token_usage?.input_tokens || 0);
    }
    if (row.type === 'response_item' &&
        ['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
      const text = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '');
      outputs.set(p.call_id || `output-${outputs.size}`, {
        chars: text.length,
        truncated: /truncated output|tokens truncated|output truncated/i.test(text),
      });
    }
  }
  const values = [...responses.values()];
  const sum = key => values.reduce((n, v) => n + (v[key] || 0), 0);
  const input = values.length ? sum('input_tokens') : (legacy?.input_tokens || 0);
  const cached = values.length ? sum('cached_input_tokens') : (legacy?.cached_input_tokens || 0);
  const output = values.length ? sum('output_tokens') : (legacy?.output_tokens || 0);
  const toolOutputs = [...outputs.values()];
  return {
    file: path.basename(file), thread_id: meta?.id || meta?.session_id || null,
    parent_thread_id: meta?.parent_thread_id || null, source: meta?.source || null,
    models: [...models], reasoning_efforts: [...efforts],
    accounting: values.length ? 'unique_response_id' : 'legacy_cumulative',
    requests: values.length || null,
    input_tokens: input, cached_input_tokens: cached,
    uncached_input_tokens: input - cached, output_tokens: output,
    reasoning_output_tokens: values.length ? sum('reasoning_output_tokens') : (legacy?.reasoning_output_tokens || 0),
    total_tokens: input + output, peak_request_input_tokens: peakInput,
    tool_outputs: outputs.size,
    tool_output_chars: toolOutputs.reduce((n, v) => n + v.chars, 0),
    largest_tool_output_chars: toolOutputs.reduce((n, v) => Math.max(n, v.chars), 0),
    truncated_tool_outputs: toolOutputs.filter(v => v.truncated).length,
    compactions, invalid_lines: invalidLines,
  };
}

async function filesAt(target) {
  const stat = await fs.promises.stat(target);
  if (stat.isFile()) return target.endsWith('.jsonl') ? [target] : [];
  const entries = await fs.promises.readdir(target, { withFileTypes: true });
  const groups = await Promise.all(entries.map(e => filesAt(path.join(target, e.name))));
  return groups.flat();
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const targets = args.filter(a => a !== '--json');
  if (!targets.length) {
    console.log('Usage: node scripts/codex-usage.cjs <session.jsonl | sessions-directory> [...] [--json]');
    return;
  }
  const files = [...new Set((await Promise.all(targets.map(filesAt))).flat())].sort();
  const sessions = [];
  for (const file of files) sessions.push(await inspect(file));
  if (json) console.log(JSON.stringify({ schema_version: 1, measured_at: new Date().toISOString(), sessions }, null, 2));
  else console.table(sessions.map(s => ({
    session: s.thread_id, role: s.parent_thread_id ? 'auxiliary' : 'main',
    model: s.models.join(', '), requests: s.requests,
    uncached: s.uncached_input_tokens, cached: s.cached_input_tokens,
    output: s.output_tokens, peak_input: s.peak_request_input_tokens,
    tool_chars: s.tool_output_chars, truncated: s.truncated_tool_outputs,
  })));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { inspect };
