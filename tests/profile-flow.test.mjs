import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { launchWithConfiguration, saveLaunchConfiguration } from '../src/launchFlow.ts';

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

test('a stale key selection offers an enabled service picker instead of a disabled launch', () => {
  let opened;
  const main = handler('../src/Launcher.tsx', 'main', {
    missing: false, invalidService: true, disabled: false,
    t: s => s, focusServices: () => { opened = 'service'; },
  });
  assert.equal(main.label, '重新选择服务');
  assert.equal(main.off, false);
  main.run();
  assert.equal(opened, 'service');
});

test('inline service list retains the unavailable-key wording and hides duplicate rows', () => {
  const source = fs.readFileSync(new URL('../src/Launcher.tsx', import.meta.url), 'utf8');
  assert.ok(!source.includes('所选密钥已失效'));
  assert.ok(source.includes('invalidService && !selected && option('));
});

test('pending changes retain the launch button without a save action', () => {
  const main = handler('../src/Launcher.tsx', 'main', {
    missing:false, invalidService:false, needsSave:true, blockerAction:null,
    errors:[], props:{busy:false}, t:s=>s, targetName:()=> 'Codex CLI', target:'codex-cli', mode:'cli', launchDisabled:true,
  });
  assert.equal(main.label,'启动 {name}');
  assert.equal(main.off,true);
});

for (const succeeds of [true,false]) test('row enable writes the clicked key without launching, preference success='+succeeds, async () => {
  const calls=[];
  const activate = handler('../src/Launcher.tsx','activateService',{
    prefs:{}, savingRef:{current:false}, activatingRef:{current:false}, props:{busy:false,onSaveConfiguration:async(...args)=>calls.push(['write',...args])},
    service:'old',tool:'codex',mode:'desktop',setActivating:()=>{},setRepair:()=>{},save:async patch=>{calls.push(['select',patch]);return succeeds;},
  });
  await activate('clicked-key');
  assert.deepEqual(calls,succeeds ? [['select',{codexService:'clicked-key'}],['write','codex','desktop','clicked-key']] : [['select',{codexService:'clicked-key'}]]);
});

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
  await saveLaunchConfiguration('codex','cli','duplicate-2', {
    profileId:'duplicate-2',baseUrl:'https://relay.example/v1',model:'m',reasoningEffort:'medium',
  }, {
    validateLaunch:async()=>{},
    scanEnvironment:async(...args)=>{scans.push(args);return {codex:{configurationStatus:scans.length===1?'official':'configured',activeProfileId:args[2],currentModel:'m',currentReasoningEffort:'medium'}};},
    applyConfig:async()=>({backupId:'fixture'}),revertToOfficial:async()=>'',launchClient:async()=>({message:'fixture'}),
  },()=>{});
  assert.deepEqual(scans,[['https://relay.example/v1',['codex'],'duplicate-2'],['https://relay.example/v1',['codex'],'duplicate-2']]);
});
