# SiberÇeviri

A Chrome/Edge (Manifest V3) extension that translates English cybersecurity training content
(TryHackMe, Hack The Box Academy, PortSwigger Web Security Academy, Udemy/arcX video captions) into Turkish.
Code, commands and payloads are not changed.

**Security review:** [SECURITY-REVIEW.md](SECURITY-REVIEW.md). This is a self-assessment of the LLM
integration (indirect prompt injection, output handling, cache integrity, cost controls), with before/after
test evidence for v1.3.2 → v1.4.0.

## Features

* Adds a translation under each paragraph. Inline code is protected with placeholders and restored unchanged.
* Selection translation (Alt+T), page toggle (Alt+Y) and a personal vocabulary notebook.
* Synchronised Turkish captions and a full transcript panel for Udemy and arcX (Alt+U).
* Engines: Google (free, default for pages), Claude Haiku (optional, behind a monthly budget lock), or hybrid.
* A cybersecurity glossary (`extension/glossary.js`) keeps terminology consistent. Example: "yetki yükseltme (privilege escalation)".

## Security design (v1.4.0)

* Page text is treated as untrusted data. Invisible text is not sent to the model.
* Every request uses unguessable segment markers. Marker-like text in the page is neutralised.
* The system prompt tells the model to translate embedded instructions literally, never to follow them.
* Each model output is validated (length, placeholders, new links or shell pipes, language). Failures fall back to the non-LLM engine and are never cached.
* Model output is rendered with `textContent` only.
* The monthly budget is reserved atomically before each request.

## Install (developer mode)

1. Open `chrome://extensions` or `edge://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder.
3. Optional: add an Anthropic API key in the popup. Without a key, everything runs on the free Google engine.

## Tests

Requires Node.js 22+. No dependencies, no network, no API key.

```powershell
node tests/background-harness.cjs extension        # injection/integrity harness (simulated compromised model)
node tests/guard-false-positives.cjs extension     # honest translations must pass validation
```

See SECURITY-REVIEW.md §5 for the baseline comparison and the headless DOM test.

## Notes

* Built as a personal study tool with substantial AI assistance (Claude) for code, tests and the security review. The author directed the work, ran the tests and reviewed the results.
* `tests/test-page.html` contains harmless prompt-injection canaries for testing this extension locally (`node tests/serve-test-page.js` → http://127.0.0.1:8765).

## License

MIT
