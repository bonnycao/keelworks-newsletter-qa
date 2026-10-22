KeelWorks Newsletter QA — Content QA v2

Replace these files in your existing project:
  newsletter-test.js  -> project root
  index.html          -> public/index.html

Keep design-system/, package.json, and all other files unchanged.

Restart: Ctrl+C (Y if prompted), then npm start.
Refresh Chrome: Ctrl+Shift+R, then upload newsletter_october.html.

What is new:
- Local rules for grammar, unclear wording, hyphenation, repeated words,
  punctuation and terminology, including examples in the October newsletter.
- Mobile non-wrapping-link warning.
- Improved unsubscribe/footer identification.
- Optional locally hosted LanguageTool spelling/grammar checking.

IMPORTANT: The built-in rules are NOT a comprehensive grammar checker.
They flag selected patterns and must be reviewed by a human editor.
To enable broader dictionary and grammar detection, install and run a
LanguageTool HTTP server on your own computer and set LANGUAGETOOL_URL
(e.g. http://127.0.0.1:8081). This is optional; no text is sent to any
external grammar service by default. LanguageTool setup is separate.

All content suggestions are marked Needs Review.
