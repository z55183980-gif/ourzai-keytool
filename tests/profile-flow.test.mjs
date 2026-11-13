import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { launchWithConfiguration } from '../src/launchFlow.ts';

// Exercise the actual component handlers with mocked IPC/state boundaries.
function handler(file, name, bindings) {
  const text = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let source;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) source = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(source, `missing handler ${name}`);
  const js = ts.transpileModule(`const handler = ${source}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return handler;`)(...Object.values(bindings));
}

for (const patch of [{codexModel: 'new-model', codexEffort: 'high'}, {claudeModel: 'new-claude'}]) {
  test(`model update preserves both custom endpoints: ${Object.keys(patch)[0]}`, async () => {
    const profile = {id:'custom',name:'relay',codexModel:'old',codexEffort:'medium',claudeModel:'old-claude',codexBaseUrl:'https://relay.example/v1',claudeBaseUrl:'https://anthropic.example'};
    let sent;
    const save = handler('../src/App.tsx', 'saveModel', {
      profiles:[profile], api:{saveProfile:async req=>{sent=req;},listProfiles:async()=>[profile]},
      setBusy:()=>{}, log:()=>{}, t:s=>s, effortLabel:s=>s, setProfiles:()=>{}, setToast:()=>{},
    });
    assert.equal(await save(profile.id, patch), true);
    assert.equal(sent.codexBaseUrl, profile.codexBaseUrl);
    assert.equal(sent.claudeBaseUrl, profile.claudeBaseUrl);
    assert.equal(sent.apiKey, '');
    for (const [key,value] of Object.entries(patch)) assert.equal(sent[key],value);
  });
}

test('current policy stays read-only even when a saved profile is recognized and its model differs', async () => {
  const serviceFor = handler('../src/Launcher.tsx', 'serviceFor', {prefs:{codexService:'current'},matchedService:()=> 'saved-key'});
  const calls=[];
  await launchWithConfiguration('codex','cli',serviceFor('codex'),'C:\\fixture', {
    profileId:'saved-key',baseUrl:'https://relay.example/v1',model:'old-preference',reasoningEffort:'medium',
  }, {
    validateLaunch:async()=>{},
    scanEnvironment:async()=>({codex:{configurationStatus:'configured',activeProfileId:'saved-key',currentModel:'manual-model'}}),
    applyConfig:async()=>{throw Error('must not write');},revertToOfficial:async()=>{throw Error('must not revert');},
    launchClient:async()=>{calls.push('launch');return {message:'fixture'};},
  },()=>{throw Error('must not configure');});
  assert.equal(serviceFor('codex'),'current');
  assert.deepEqual(calls,['launch']);
});

test('selected duplicate profile and tool scope are supplied to every launch verification', async () => {
  const scans=[];
  await launchWithConfiguration('codex','cli','duplicate-2','C:\\fixture', {
    profileId:'duplicate-2',baseUrl:'https://relay.example/v1',model:'m',reasoningEffort:'medium',
  }, {
    validateLaunch:async()=>{},
    scanEnvironment:async(...args)=>{scans.push(args);return {codex:{configurationStatus:scans.length===1?'official':'configured',activeProfileId:args[2],currentModel:'m',currentReasoningEffort:'medium'}};},
    applyConfig:async()=>({backupId:'fixture'}),revertToOfficial:async()=>'',launchClient:async()=>({message:'fixture'}),
  },()=>{});
  assert.deepEqual(scans,[['https://relay.example/v1',['codex'],'duplicate-2'],['https://relay.example/v1',['codex'],'duplicate-2']]);
});
