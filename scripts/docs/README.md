# Documentation generators

`CONTEXT.md` says to regenerate the docs rather than edit them. These are the
generators that do it. Both read the source of truth, so neither can describe a
table or a stage the software does not have.

```bash
# database-design.html — 60 tables, ERDs, DFDs, raw schema embedded
node scripts/docs/parse-schema.js prisma/schema.prisma /tmp/schema.json
cp /tmp/schema.json scripts/docs/schema.json
node scripts/docs/build-db-html.js prisma/schema.prisma database-design.html

# 1BUY-Fulfilment-Platform.docx — problem, objectives, methodology, user guide
npx tsx scripts/docs/extract-domain.ts scripts/docs/data.json
node scripts/docs/build-platform-docx.js 1BUY-Fulfilment-Platform.docx
```

`build-platform-docx.js` needs the `docx` npm package, which is not a project
dependency — it is only used here. `npm i -D docx` before running it.

`build-db-html.js` and `build-platform-docx.js` read `schema.json` / `data.json`
from **this directory**, which is why the two-step above copies them here.
