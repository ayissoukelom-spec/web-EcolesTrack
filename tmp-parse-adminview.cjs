const ts = require('typescript');
const fs = require('fs');
const src = fs.readFileSync('src/components/AdminView.tsx', 'utf8');
const srcFile = ts.createSourceFile('AdminView.tsx', src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
console.log('diagnostics', srcFile.parseDiagnostics.length);
for (const d of srcFile.parseDiagnostics) {
  const pos = d.start || 0;
  const { line, character } = d.file.getLineAndCharacterOfPosition(pos);
  console.log(`${line+1}:${character+1} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}
