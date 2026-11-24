const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const clientId = '20000000-0000-4000-8000-000000000004';
const actorId = '20000000-0000-4000-8000-000000000001';
function load(file, { denied=false, rows=[], rpcResult='ok' }={}) {
  const calls=[]; const paths=[]; const exports={};
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,require(name){
    if(name==='server-only')return {};
    if(name==='react')return {cache:fn=>fn};
    if(name==='next/cache')return {revalidatePath:path=>paths.push(path)};
    if(name==='@/lib/email')return {emailEnabled:()=>true};
    if(name==='@/lib/prospect-email')return {dispatchProspectEmails:async()=> 'queued'};
    if(name==='@/app/admin/clientes/[id]/actions')return {adminDeleteClientAction:async()=>({ok:true})};
    if(name==='node:crypto')return require('node:crypto');
    if(name==='@/lib/authz')return {requireOwner:async()=>{if(denied)throw Error('denied');return {id:actorId};},requireStaff:async()=>{if(denied)throw Error('denied');return {id:actorId};}};
    if(name==='@/lib/chat')return {isChatId:id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)};
    if(name==='@/lib/supabase/server')return {createAdminClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:name==='leap_prospect_list'?rows:rpcResult,error:null};}})};
    throw Error(name);
  }});
  return {api:exports,calls,paths};
}
const row={client_id:clientId,full_name:'Maria Silva',completed_sessions:0,next_session_at:null};
test('list and mutation reject non-staff before accessing privileged data',async()=>{
  for(const [file,action] of [['lib/prospects.ts',api=>api.loadProspects()],['app/admin/novos-clientes/actions.ts',api=>api.setProspectPreference(clientId,'declined')]]){
    const mod=load(file,{denied:true});await assert.rejects(action(mod.api),/denied/);assert.equal(mod.calls.length,0);
  }
});
test('lookup returns only eligible client in staff-scoped result',async()=>{
  const mod=load('lib/prospects.ts',{rows:[row]});assert.equal((await mod.api.getProspect(clientId)).client_id,clientId);
  assert.equal(await mod.api.getProspect('20000000-0000-4000-8000-000000000099'),null);
  assert.equal(mod.calls[0].args.p_actor,actorId);
});
test('opening a draft performs no message or credit mutation',()=>{
  const mod=load('lib/prospects.ts');const text=mod.api.prospectDraft(row);assert.match(text,/Maria/);assert.match(text,/sessão experimental/);assert.equal(mod.calls.length,0);
});
test('scheduled experiment gets preparation message rather than another invitation',()=>{
  const {api}=load('lib/prospects.ts');assert.match(api.prospectDraft({...row,next_session_at:'2026-12-01T08:00:00Z'}),/sessão marcada/);
});
test('completed trial gets pack follow-up without invented price or automatic gift',()=>{
  const {api}=load('lib/prospects.ts');const text=api.prospectDraft({...row,completed_sessions:1});assert.match(text,/packs/);assert.doesNotMatch(text,/\[pack\]|grátis|oferecer|€/);
});
test('invalid preference and client IDs cannot reach database',async()=>{
  const mod=load('app/admin/novos-clientes/actions.ts');assert.ok((await mod.api.setProspectPreference('invalid','active')).error);assert.ok((await mod.api.setProspectPreference(clientId,'other')).error);assert.equal(mod.calls.length,0);
});
test('preference writes bind actor and invalidate list and dashboard only on success',async()=>{
  const mod=load('app/admin/novos-clientes/actions.ts');assert.equal((await mod.api.setProspectPreference(clientId,'snoozed')).ok,true);assert.deepEqual(mod.calls.map(x=>x.name),['leap_prospect_set_preference']);assert.equal(mod.calls[0].args.p_actor,actorId);assert.deepEqual(mod.paths,['/admin/dashboard','/admin/novos-clientes']);
});
test('stale eligibility reports failure without treating prospect as updated',async()=>{
  const mod=load('app/admin/novos-clientes/actions.ts',{rpcResult:'unavailable'});assert.ok((await mod.api.setProspectPreference(clientId,'declined')).error);assert.equal(mod.paths.length,0);
});
