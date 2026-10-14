const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const terser = require('terser');
const obfuscator = require('javascript-obfuscator');
async function protect(source) {
  const small = await terser.minify(source, {compress:{passes:2},mangle:true,format:{comments:false},ecma:2020});
  if (small.error) throw small.error;
  return obfuscator.obfuscate(small.code, {
    compact:true,seed:150926,identifierNamesGenerator:'hexadecimal',renameGlobals:false,
    stringArray:false,controlFlowFlattening:false,deadCodeInjection:false,debugProtection:false,
    selfDefending:false,disableConsoleOutput:false,unicodeEscapeSequence:false,
    transformObjectKeys:false,renameProperties:false,simplify:true,
  }).getObfuscatedCode();
}
async function main() {
  const [input,output] = process.argv.slice(2);
  let source = fs.readFileSync(input,'utf8');
  // The material worker is serialized into the page; protect its program independently.
  const worker = /globalThis\.MaterialRenderWorkerSource=("(?:\\.|[^"\\])*");/;
  const match = source.match(worker);
  if(match) source=source.replace(match[0], 'globalThis.MaterialRenderWorkerSource='+JSON.stringify(await protect(JSON.parse(match[1])))+';');
  if(input.endsWith('.html')) {
    const scripts = [...source.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
    for(const script of scripts) {
      if(script[1] && /src=|application\/json/.test(script[1])) continue;
      source=source.replace(script[0],'<script'+(script[1]||'')+'>'+ (await protect(script[2])).replace(/<\/script/gi,'<\\/script')+'</script>');
    }
    source=source.replace(/<!--[\s\S]*?-->/g,'');
  } else source=await protect(source);
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,source);
  console.log(path.basename(output),Buffer.byteLength(source));
}
main().catch(e=>{console.error(e);process.exit(1)});
